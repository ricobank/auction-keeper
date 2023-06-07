#!/usr/bin/env python3
# Debt bidding model that reads auction state from stdin and writes a bid to stdout

import sys
import os
import json
import requests
from pyflex.deployment import GfDeployment
from pyflex.numeric import Wad, Ray, Rad
from web3 import Web3, HTTPProvider


def get_price():
    # Retrieve latest FLX price from coingecko
    resp = requests.get('https://api.coingecko.com/api/v3/simple/price', params={'ids': 'reflexer-ungovernance-token', 'vs_currencies': 'usd'})
    return resp.json()['reflexer-ungovernance-token']['usd']

"""
Sample auction input:

{'id': '1', 'bid_amount': '3.000000000000000000000000000000000000000000000', 'amount_to_sell': '439.000000000000000000', 'block_time': 1652104620, 'auction_deadline': 1652363564, 'price': '0.006833712984054669', 'bid_decrease': '1.030000000000000000', 'high_bidder': '0x6073E8FE874B53732b5DdD469a2De4047f33C64B', 'debt_auction_house': '0x6AcE594C5A421E468c13715AD62A183200C320a6'}
"""

current_flx_usd_price = get_price()

web3 = Web3(HTTPProvider(os.environ['ETH_RPC_URL']))
geb = GfDeployment.from_node(web3, 'rai')
redemption_price = geb.oracle_relayer.redemption_price()

# FLX Price to bid
MAXIMUM_FLX_MULTIPLIER = 0.90  # Buy FLX for 90% of current price

# Custom bid decrease 
# The minimum auction bid decrease can be low, setting a higher one can prevent too many bids
# If you want to always use the minimum bid decrease allowed, set this to 0
MY_BID_DECREASE = 1.03

for auction_input in sys.stdin:
    auction_state = json.loads(auction_input)

    # If we are already the high bidder, do nothing
    if auction_state['high_bidder'] == os.environ['KEEPER_ADDRESS']:
        continue

    # Ensure our custom bid increase is at least the minimum allowed
    MY_BID_DECREASE = max(Wad.from_number(MY_BID_DECREASE), Wad.from_number(auction_state['bid_decrease']))

    # Add slight amount to account for possible redemption price change between the time of model output and bid placement
    MY_BID_DECREASE += Wad.from_number(1e-4)

    # Bid price using `MY_BID_INCREASE`
    my_bid_amount = Wad.from_number(auction_state['amount_to_sell']) / MY_BID_DECREASE
    # Round up from Rad to Wad
    my_bid_price = Wad(Rad.from_number(auction_state['bid_amount']) * redemption_price / Rad(my_bid_amount)) + Wad(1)

    # Bid price using minimum bid increase allowed
    min_bid_amount = Wad.from_number(auction_state['amount_to_sell']) / Wad.from_number(auction_state['bid_decrease'])
    # Round up from Rad to Wad
    min_bid_price = Wad(Rad.from_number(auction_state['bid_amount']) * redemption_price  / Rad(min_bid_amount)) + Wad(1)

    # Try our bid increase first
    # If price is too low, then try minimum bid increase
    if my_bid_price <= Wad.from_number(MAXIMUM_FLX_MULTIPLIER * current_flx_usd_price):
        bid = {'price': str(my_bid_price)}
        print(json.dumps(bid), flush=True)
    elif min_bid_price <= Wad.from_number(MAXIMUM_FLX_MULTIPLIER * current_flx_usd_price):
        bid = {'price': str(min_bid_price)}
        print(json.dumps(bid), flush=True)
