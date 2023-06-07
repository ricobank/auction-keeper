#!/usr/bin/env python3
# Surplus bidding model that reads auction state from stdin and write a bid to stdout

"""
Sample auction input:

{'id': '34', 'bid_amount': '0.003577998710342092', 'amount_to_sell': '5.000000000000000000000000000000000000000000000', 'block_time': 1651509840, 'auction_deadline': 1651764740, 'price': '4323.084918209392304591', 'bid_increase': '1.030000000000000000', 'high_bidder': '0x37918A209697488c3E4C25a8A7e7E21E5532ADFB', 'bid_expiry': '1651510724', 'surplus_auction_house': '0xCdaA2ec0975eD41202E1078b21a4833E414f6379'}
"""

import sys
import os
import json
import requests
from pyflex.deployment import GfDeployment
from web3 import Web3, HTTPProvider

def get_price():
    # Retrieve latest FLX price from coingecko
    resp = requests.get('https://api.coingecko.com/api/v3/simple/price', params={'ids': 'reflexer-ungovernance-token', 'vs_currencies': 'usd'})
    return resp.json()['reflexer-ungovernance-token']['usd']


current_flx_usd_price = get_price()

web3 = Web3(HTTPProvider(os.environ['ETH_RPC_URL']))
geb = GfDeployment.from_node(web3, 'rai')
redemption_price = float(geb.oracle_relayer.redemption_price())

# FLX Price to bid
STARTING_FLX_MULTIPLIER = 1.50 # Sell FLX for 150% of current price
MINIMUM_FLX_MULTIPLIER = 1.10  # Sell FLX for 110% of current price

# Custom bid increase 
# The minimum auction bid increase can be low, setting a higher one can prevent too many bids
# Example: 1.10 will have a bid increase of 10%
# If you want to always use the minimum bid increase allowed, set this to 0
MY_BID_INCREASE = 1.03

for auction_input in sys.stdin:
    auction_state = json.loads(auction_input)

    # If we are already the high bidder, do nothing
    if auction_state['high_bidder'] == os.environ['KEEPER_ADDRESS']:
        continue

    # Ensure our custom bid increase is at least the minimum allowed
    MY_BID_INCREASE = max(MY_BID_INCREASE, float(auction_state['bid_increase']))
    # No bids yet, so bid with high, starting multiplier
    if float(auction_state['bid_amount']) == 0:
        bid = {'price': str(STARTING_FLX_MULTIPLIER * current_flx_usd_price)}
        print(json.dumps(bid), flush=True)
    else:
        # Bid price using `MY_BID_INCREASE`
        my_bid_amount = float(auction_state['bid_amount']) * MY_BID_INCREASE
        my_bid_price = float(auction_state['amount_to_sell']) * redemption_price / my_bid_amount

        # Bid price using minimum bid increase allowed
        min_bid_amount = float(auction_state['bid_amount']) * float(auction_state['bid_increase'])
        min_bid_price = float(auction_state['amount_to_sell']) * redemption_price / min_bid_amount

        # Try our bid increase first
        # If price is too low, then try minimum bid increase
        if my_bid_price >= MINIMUM_FLX_MULTIPLIER * current_flx_usd_price:
            bid = {'price': str(my_bid_price)}
            print(json.dumps(bid), flush=True)
        elif min_bid_price >= MINIMUM_FLX_MULTIPLIER * current_flx_usd_price:
            bid = {'price': str(min_bid_price)}
            print(json.dumps(bid), flush=True)
