#!/bin/bash

KEEPER_ADDRESS=<KEEPER ADDRESS>
ETH_RPC_URL=<ETH RPC URL>

# Full path
KEYSTORE_DIR=<KEYSTORE DIR>

KEYSTORE_FILE=<KEYSTORE FILE>

# Full path
MODEL_DIR=<MODEL DIR>

MODEL_FILE=debt_model.py
GAS_MAXIMUM=200

docker pull reflexer/auction-keeper:latest

docker run -it \
  -v ${KEYSTORE_DIR}:/keystore \
  -v ${MODEL_DIR}:/models \
  --env KEEPER_ADDRESS=${KEEPER_ADDRESS} \
    reflexer/auction-keeper:latest \
        --type debt \
        --model /models/${MODEL_FILE} \
        --rpc-uri ${ETH_RPC_URL} \
        --eth-from ${KEEPER_ADDRESS} \
        --eth-key "key_file=/keystore/${KEYSTORE_FILE}" \
        --block-check-interval 30 \
        --bid-check-interval 30 \
	--gas-maximum ${GAS_MAXIMUM}
