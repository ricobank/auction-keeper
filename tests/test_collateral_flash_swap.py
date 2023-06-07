# This file is part of Maker Keeper Framework.
#
# Copyright (C) 2018-2019 reverendus, bargst, EdNoepel
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import pytest
from typing import Optional

from auction_keeper.gas import DynamicGasPrice
from auction_keeper.main import AuctionKeeper
from auction_keeper.model import Parameters
from datetime import datetime
from pyflex import Address
from pyflex.approval import approve_safe_modification_directly
from pyflex.auctions import FixedDiscountCollateralAuctionHouse
from pyflex.deployment import GfDeployment
from pyflex.gf import Collateral
from pyflex.numeric import Wad, Ray, Rad
from pyflex.model import Token
from tests.conftest import liquidate, create_critical_safe, pop_debt_and_settle_debt, keeper_address, geb, models, \
                           reserve_system_coin, simulate_model_output, web3, set_collateral_price
from tests.conftest import is_safe_safe, other_address, our_address
from tests.conftest import get_keeper_address, get_geb, get_our_address, get_web3

from tests.helper import args, time_travel_by, wait_for_other_threads, TransactionIgnoringTest

from pyexchange.uniswapv2 import UniswapV2

bid_size = Wad.from_number(3)
bid_size_small = Wad(2000)


@pytest.fixture()
def auction_id(geb, c: Collateral, auction_income_recipient_address) -> int:
    # set to pymaker price
    set_collateral_price(geb, c, Wad.from_number(500))

    # Ensure we start with a clean safe
    safe = geb.safe_engine.safe(c.collateral_type, auction_income_recipient_address)
    assert safe.locked_collateral == Wad(0)
    assert safe.generated_debt == Wad(0)

    # liquidate SAFE
    critical_safe = create_critical_safe(geb, c, bid_size, auction_income_recipient_address)
    return liquidate(geb, c, critical_safe)

@pytest.fixture()
def auction_small(geb, c: Collateral, auction_income_recipient_address) -> int:
    critical_safe = create_critical_safe(geb, c, bid_size_small, auction_income_recipient_address)
    return liquidate(geb, c, critical_safe)


@pytest.mark.timeout(500)
class TestAuctionKeeperCollateralFlashSwap(TransactionIgnoringTest):
    def teardown_method(self, test_method):
        pass
    def setup_class(self):
        """ I'm excluding initialization of a specific collateral perchance we use multiple collaterals
        to improve test speeds.  This prevents us from instantiating the keeper as a class member. """
        self.web3 = get_web3()
        self.geb = get_geb(self.web3)
        self.keeper_address = get_keeper_address(self.web3)
        self.collateral = self.geb.collaterals['ETH-B']
        self.min_auction = self.collateral.collateral_auction_house.auctions_started() + 1
        self.keeper = AuctionKeeper(args=args(f"--eth-from {self.keeper_address.address} "
                                     f"--type collateral "
                                     f"--flash-swap "
                                     f"--from-block {self.geb.starting_block_number} "
                                     f"--min-auction {self.min_auction} "
                                     f"--model ../models/collateral_model.sh "
                                     f"--collateral-type {self.collateral.collateral_type.name}"), web3=self.geb.web3)
        self.keeper.approve()

        #flash-swap should disable rebalance
        assert self.keeper.rebalance_system_coin() == Wad(0)

        assert isinstance(self.keeper.gas_price, DynamicGasPrice)
        self.default_gas_price = self.keeper.gas_price.get_gas_price(0)

    @staticmethod
    def collateral_balance(address: Address, c: Collateral) -> Wad:
        assert (isinstance(address, Address))
        assert (isinstance(c, Collateral))
        return Wad(c.collateral.balance_of(address))

    @staticmethod
    def buy_collateral(collateral_auction_house: FixedDiscountCollateralAuctionHouse, id: int, address: Address,
                       bid_amount: Wad):
        assert (isinstance(collateral_auction_house, FixedDiscountCollateralAuctionHouse))
        assert (isinstance(id, int))
        assert (isinstance(bid_amount, Wad))

        current_bid = collateral_auction_house.bids(id)
        assert current_bid.auction_deadline > datetime.now().timestamp()

        assert bid_amount <= Wad(current_bid.amount_to_raise)

        assert collateral_auction_house.buy_collateral(id, bid_amount).transact(from_address=address)

    @staticmethod
    def buy_collateral_with_system_coin(geb: GfDeployment, c: Collateral, collateral_auction_house: FixedDiscountCollateralAuctionHouse,
                                        id: int, address: Address, bid_amount: Wad):
        assert (isinstance(geb, GfDeployment))
        assert (isinstance(c, Collateral))
        assert (isinstance(collateral_auction_house, FixedDiscountCollateralAuctionHouse))
        assert (isinstance(id, int))
        assert (isinstance(bid_amount, Wad))

        collateral_auction_house.approve(collateral_auction_house.safe_engine(),
                                         approval_function=approve_safe_modification_directly(from_address=address))

        previous_bid = collateral_auction_house.bids(id)
        c.approve(address)
        reserve_system_coin(geb, c, address, bid_amount, extra_collateral=Wad.from_number(2))
        TestAuctionKeeperCollateralFlashSwap.buy_collateral(collateral_auction_house, id, address, bid_amount)


    def simulate_model_bid(self, geb: GfDeployment, c: Collateral, model: object,
                          gas_price: Optional[int] = None):
        assert (isinstance(geb, GfDeployment))
        assert (isinstance(c, Collateral))
        assert (isinstance(gas_price, int)) or gas_price is None

        collateral_auction_house = c.collateral_auction_house
        initial_bid = collateral_auction_house.bids(model.id)
        assert initial_bid.amount_to_sell > Wad(0)
        our_bid = Wad.from_number(500) * initial_bid.amount_to_sell
        reserve_system_coin(geb, c, self.keeper_address, our_bid, extra_collateral=Wad.from_number(2))
        simulate_model_output(model=model, price=Wad.from_number(500), gas_price=gas_price)

    def test_collateral_auction_house_address(self):
        assert self.keeper.collateral_auction_house.address == self.collateral.collateral_auction_house.address

    def test_flash_proxy_settle_auction(self, c: Collateral, web3, geb, auction_id, other_address):
        # given
        collateral_auction_house = self.collateral.collateral_auction_house
        if not isinstance(collateral_auction_house, FixedDiscountCollateralAuctionHouse):
            return

        set_collateral_price(geb, c, Wad.from_number(100))
        eth_before = self.web3.eth.getBalance(self.keeper_address.address)

        # when
        self.keeper.check_all_auctions()
        wait_for_other_threads()

        assert self.web3.eth.getBalance(self.keeper_address.address) > eth_before

        current_status = collateral_auction_house.bids(auction_id)
        assert current_status.raised_amount == Rad(0)
        assert current_status.sold_amount == Wad(0)
        assert current_status.amount_to_raise == Rad(0)
        assert current_status.amount_to_sell == Wad(0)
        assert current_status.auction_deadline == 0
        assert current_status.raised_amount == Rad(0)

    def test_flash_proxy_liquidate_and_settle_auction(self, c: Collateral, web3, geb, auction_id, other_address):
        # given
        collateral_auction_house = self.collateral.collateral_auction_house
        if not isinstance(collateral_auction_house, FixedDiscountCollateralAuctionHouse):
            return

        set_collateral_price(geb, c, Wad.from_number(100))
        eth_before = self.web3.eth.getBalance(self.keeper_address.address)
        auctions_started = collateral_auction_house.auctions_started()

        # when
        critical_safe = create_critical_safe(geb, c, bid_size, other_address)
        self.keeper.check_safes()
        wait_for_other_threads()
        assert self.web3.eth.getBalance(self.keeper_address.address) > eth_before
        assert collateral_auction_house.auctions_started() == auctions_started + 1

        auction_status = collateral_auction_house.bids(auctions_started + 1)
        assert auction_status.raised_amount == Rad(0)
        assert auction_status.sold_amount == Wad(0)
        assert auction_status.amount_to_raise == Rad(0)
        assert auction_status.amount_to_sell == Wad(0)
        assert auction_status.auction_deadline == 0
        assert auction_status.raised_amount == Rad(0)
