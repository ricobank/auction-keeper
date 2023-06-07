#!/bin/bash

export KEEPER_ADDRESS=<KEEPER ADDRESS>
ETH_RPC_URL=<ETH RPC URL>
KEYSTORE_FILE=<KEYSTORE FILE>
GAS_MAXIMUM=200

bin/auction-keeper \
     --type debt \
     --model models/debt_model.py \
     --rpc-uri ${ETH_RPC_URL} \
     --eth-from ${KEEPER_ADDRESS} \
     --eth-key "key_file=${KEYSTORE_FILE}" \
     --block-check-interval 90 \
     --bid-check-interval 30 \
     --gas-maximum ${GAS_MAXIMUM}


