// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.19;

import "forge-std/Test.sol";

import { RicoSetUp, Guy, WethLike } from '../lib/ricobank/test/RicoHelper.sol';
import { Vat } from '../lib/ricobank/src/vat.sol';
import { Vow} from '../lib/ricobank/src/vow.sol';
import '../lib/ricobank/test/UniHelper.sol';
import { IERC721, INonfungiblePositionManager } from '../lib/ricobank/test/Univ3Interface.sol';
import { Strat } from '../src/strat.sol';

contract StratTest is Test, RicoSetUp {
    uint256 public init_join = 1000;
    uint stack = WAD * 10;
    bytes32[] ilks;
    address[] gems;
    uint256[] wads;
    address public achap;
    uint public constant flash_size = 100;
    address constant public UNI_NFT_ADDR = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    uint golddaitokid;
    uint golddaitokid2;
    uint golddaitokid3;
    uint ricodaitokid;
    uint ricorisktokid;
    Strat strat;

    function create_path(
        address[] memory tokens,
        uint24[]  memory fees
    ) internal pure returns (bytes memory fore, bytes memory rear) {
        require(tokens.length == fees.length + 1, "invalid path");

        for (uint i = 0; i < tokens.length - 1; i++) {
            fore = abi.encodePacked(fore, tokens[i], fees[i]);
        }
        fore = abi.encodePacked(fore, tokens[tokens.length - 1]);

        rear = abi.encodePacked(rear, tokens[tokens.length - 1]);
        for (uint j = tokens.length - 1; j > 0; j--) {
            rear = abi.encodePacked(rear, fees[j - 1], tokens[j - 1]);
        }
    }


    function setUp() public {
        make_bank();
        init_gold();
        init_dai();
        gold.approve(bank, UINT256_MAX);
        vm.prank(VAULT);
        dai.transfer(self, 1000000 * WAD);

        gold.mint(self, 1000000 * WAD);
        WethLike(WETH).deposit{value: 100000 * WAD}();
        uint160 onex96 = 2 ** 96;
        PoolArgs memory args = PoolArgs(
            Asset(agold, 25000 * WAD), Asset(DAI, 25000 * WAD),
            3000, onex96, onex96 * 3 / 4, onex96 * 4 / 3, 60
        );
        (golddaitokid,,,) = create_and_join_pool(args);
        (golddaitokid2,,,) = create_and_join_pool(args);
        (golddaitokid3,,,) = create_and_join_pool(args);

        rico_mint(50000 * WAD, false);

        args = PoolArgs(
            Asset(arico, 25000 * WAD), Asset(DAI, 25000 * WAD),
            500, onex96, onex96 * 3 / 4, onex96 * 4 / 3, 10
        );

        (ricodaitokid,,,) = join_pool(args);

        risk.mint(self, 100000 * WAD);
        args = PoolArgs(
            Asset(arico, 25000 * WAD), Asset(arisk, 25000 * WAD),
            3000, onex96, onex96 * 3 / 4, onex96 * 4 / 3, 60
        );
        (ricorisktokid,,,) = join_pool(args);

        strat = new Strat(bank, ball.ploker(), 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD);
        bytes memory fore; bytes memory rear;
        {
            address [] memory addr2 = new address[](2);
            uint24  [] memory fees1 = new uint24 [](1);
            addr2[0] = arisk;
            addr2[1] = arico;
            fees1[0] = 3000;
            (fore, rear) = create_path(addr2, fees1);
            strat.setPath(arisk, arico, fore, rear);
            addr2[0] = arico;
            addr2[1] = arisk;
            (fore, rear) = create_path(addr2, fees1);
            strat.setPath(arico, arisk, fore, rear);
        }

        {
            address [] memory addr3 = new address[](3);
            uint24  [] memory fees2 = new uint24 [](2);
            addr3[0] = agold;
            addr3[1] = DAI;
            addr3[2] = arico;
            fees2[0] = 3000;
            fees2[1] = 500;
            (fore, rear) = create_path(addr3, fees2);
            strat.setPath(agold, arico, fore, rear);
        }

        {
            address [] memory addr2 = new address[](2);
            uint24  [] memory fees1 = new uint24 [](1);
            addr2[0] = DAI;
            addr2[1] = arico;
            fees1[0] = 500;
            (fore, rear) = create_path(addr2, fees1);
            strat.setPath(DAI, arico, fore, rear);
        }



    }

    function test_fill_flip_gem() public {
        feedpush(grtag, bytes32(RAY * 2), UINT256_MAX);
        Vat(bank).frob(gilk, self, abi.encodePacked(int(25000 * WAD)), int(25000 * WAD));
        feedpush(grtag, bytes32(RAY / 4), UINT256_MAX);
        uint ricobefore = rico.balanceOf(self);
        uint goldbefore = gold.balanceOf(self);
        assertEq(rico.balanceOf(address(strat)), 0);
        assertEq(gold.balanceOf(address(strat)), 0);

        address[] memory srcs = new address[](0);
        bytes32[] memory tags = new bytes32[](0);
        strat.fill_flip(gilk, self, srcs, tags, Strat.FlipType.FLIP_GEM);

        assertGe(rico.balanceOf(self), ricobefore);
        assertGt(gold.balanceOf(self), goldbefore);
    }

    function test_fill_flip_uni() public {
        Vat(bank).filhi2(
            uilk, 'fsrc', uilk, bytes32(bytes20(agold)), bytes32(bytes20(self))
        );
        Vat(bank).filhi2(
            uilk, 'ftag', uilk, bytes32(bytes20(agold)), bytes32(bytes20(grtag))
        );
        Vat(bank).filhi2(
            uilk, 'fsrc', uilk, bytes32(bytes20(address(dai))), bytes32(bytes20(self))
        );
        Vat(bank).filhi2(
            uilk, 'ftag', uilk, bytes32(bytes20(address(dai))), bytes32(bytes20(drtag))
        );
        Vat(bank).filk(uilk, 'line', bytes32(100000 * RAD));
        feed.push(drtag, bytes32(RAY * 2), UINT256_MAX);
        feed.push(grtag, bytes32(RAY * 2), UINT256_MAX);
        nfpm.approve(bank, golddaitokid);
        nfpm.approve(bank, golddaitokid2);
        nfpm.approve(bank, golddaitokid3);
        Vat(bank).frob(
            uilk,
            self,
            // this is all the liquidity in the pool...will fail if it needs all 3
            abi.encodePacked(int(1), golddaitokid, golddaitokid2, golddaitokid3),
            int(25000 * WAD)
        );
        feed.push(drtag, bytes32(RAY / 6), UINT256_MAX);
        feed.push(grtag, bytes32(RAY / 6), UINT256_MAX);
        address[] memory srcs = new address[](0);
        bytes32[] memory tags = new bytes32[](0);
        strat.fill_flip(uilk, self, srcs, tags, Strat.FlipType.FLIP_UNI_NFT);

        assertEq(nfpm.ownerOf(golddaitokid), self);
        assertEq(nfpm.ownerOf(golddaitokid2), self);
        assertEq(nfpm.ownerOf(golddaitokid3), self);

        (,,,,,,,uint128 liquidity,,,,) = nfpm.positions(golddaitokid);
        assertEq(liquidity, 0);
        (,,,,,,,liquidity,,,,) = nfpm.positions(golddaitokid2);
        assertEq(liquidity, 0);
        (,,,,,,,liquidity,,,,) = nfpm.positions(golddaitokid3);
        assertGt(liquidity, 0);
    }

    function test_fill_flap() public {
        Vat(bank).frob(gilk, self, abi.encodePacked(int(25000 * WAD)), int(25000 * WAD));
        skip(BANKYEAR);
        Vat(bank).drip(gilk);

        uint ricobefore = rico.balanceOf(self);
        uint riskbefore = risk.balanceOf(self);
        assertEq(rico.balanceOf(address(strat)), 0);
        assertEq(risk.balanceOf(address(strat)), 0);
        feedpush(RICO_RISK_TAG, bytes32(RAY), UINT256_MAX);
        strat.fill_flap(new bytes32[](0));
        assertGt(rico.balanceOf(self), ricobefore);
        assertEq(risk.balanceOf(self), riskbefore);
    }

    function test_fill_flop() public {
        skip(BANKYEAR);

        feedpush(grtag, bytes32(RAY * 2), UINT256_MAX);
        Vat(bank).frob(gilk, self, abi.encodePacked(int(25000 * WAD)), int(25000 * WAD));
        feedpush(grtag, bytes32(0), UINT256_MAX);
        Vat(bank).bail(gilk, self);

        uint ricobefore = rico.balanceOf(self);
        uint riskbefore = risk.balanceOf(self);
        assertEq(rico.balanceOf(address(strat)), 0);
        assertEq(risk.balanceOf(address(strat)), 0);
        feedpush(RISK_RICO_TAG, bytes32(RAY), UINT256_MAX);
        strat.fill_flop();
        assertEq(rico.balanceOf(self), ricobefore);
        assertGt(risk.balanceOf(self), riskbefore);
    }
}
