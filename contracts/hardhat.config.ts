import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    monadTestnet: {
      type: "http",
      chainId: 10143,
      url: configVariable("MONAD_RPC_URL"),
      accounts: [configVariable("MONAD_DEPLOYER_PRIVATE_KEY")],
    },
  },
  chainDescriptors: {
    10143: {
      name: "Monad Testnet",
      blockExplorers: {
        etherscan: {
          name: "Monadscan Testnet",
          url: "https://testnet.monadscan.com",
          apiUrl: "https://api-testnet.monadscan.com/api",
        },
      },
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("MONAD_EXPLORER_API_KEY"),
    },
  },
});
