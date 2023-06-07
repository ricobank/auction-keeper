#!/bin/bash

#CONFIG="testchain-value-english-governance-median-multisig-basic"
#CONFIG="testchain-value-fixed-discount-governance-median-multisig-basic"
export TESTCHAIN="rai-testchain-value-fixed-discount-uniswap-multisig-safe"
while getopts :c:f: option
do
case "${option}"
in
c) export TESTCHAIN=${OPTARG};;
f) TEST_FILE=${OPTARG};;
esac
done

# Pull the docker image
docker pull reflexer/${TESTCHAIN}

pushd ./lib/pyflex

# Stop any existing containers
docker-compose -f config/${TESTCHAIN}.yml down

# Start the docker image and wait for parity to initialize
docker-compose -f config/${TESTCHAIN}.yml up -d
sleep 2
popd

PYTHONPATH=$PYTHONPATH:./lib/pygasprice-client:./lib/pyflex:./lib/pyexchange py.test \
  --cov=auction_keeper --cov-report=term --cov-append \
  --log-format="%(asctime)s %(levelname)s %(message)s" --log-date-format="%H:%M:%S" \
  tests/${TEST_FILE}
TEST_RESULT=$?

echo Stopping container
pushd ./lib/pyflex
docker-compose -f config/${TESTCHAIN}.yml down
popd

exit $TEST_RESULT
