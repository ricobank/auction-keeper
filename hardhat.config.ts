import '@nomiclabs/hardhat-ethers'

import './lib/ricobank/lib/gemfab/task/deploy-gemfab'
import './lib/ricobank/lib/feedbase/task/deploy-feedbase'
import './lib/ricobank/lib/weth/task/deploy-mock-weth'
import './lib/ricobank/lib/uniswapv3/task/deploy-uniswapv3'

import './lib/ricobank/task/deploy-mock-gemfab'
import './lib/ricobank/task/deploy-mock-feedbase'
import './lib/ricobank/task/deploy-mock-tokens'

import './lib/ricobank/task/deploy-mock-dependencies'
import './lib/ricobank/task/deploy-ricobank'
import './task/deploy-strat'

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
export default {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
          enabled: true,
          runs: 2000
      },
      outputSelection: {
        "*": {
          "*": ["storageLayout"]
        }
      }
    }
  },
  paths: {
    sources: "./src"
  },
  networks: {
      hardhat: {
          allowUnlimitedContractSize: true,
          blockGasLimit: 10000000000000,
          forking: {
              url: process.env["RPC_URL"],
              blockNumber: 17501364,
              chainId: 1,
          },
          accounts: {
              accountsBalance: '1000000000000000000000000000000',
          }
      },
      arbitrum_goerli: {
          url: process.env["ARB_GOERLI_RPC_URL"],
          accounts: {
            mnemonic: process.env["ARB_GOERLI_MNEMONIC"]
          },
          chainId: 421613
      }
  }

};
