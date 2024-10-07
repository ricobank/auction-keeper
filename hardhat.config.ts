import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-verify'

import './lib/ricobank/lib/gemfab/task/deploy-gemfab'
import './lib/ricobank/task/deploy-ricobank'
import './lib/ricobank/task/deploy-dependencies'
import './lib/ricobank/task/deploy-tokens'

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
export default {
  solidity: {
    version: "0.8.25",
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
      },
      arbitrum_sepolia: {
          url: process.env["ARB_SEPOLIA_RPC_URL"],
          accounts: {
            mnemonic: process.env["ARB_SEPOLIA_MNEMONIC"]
          },
          chainId: 421614
      },
      arbitrum: {
        url: process.env["ARB_RPC_URL"],
        accounts: {
          mnemonic: process.env["ARB_MNEMONIC"]
        },
        chainId: 42161
      }
  },
  etherscan: {
    apiKey: {
      arbitrumOne: process.env.ARBISCAN_API_KEY,
      arbitrumSepolia: process.env.ARBISCAN_API_KEY
    }
  }
};
