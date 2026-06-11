require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const POLYGON_AMOY_RPC = process.env.POLYGON_AMOY_RPC || "";

module.exports = {
  solidity: "0.8.24",
  networks: {
    amoy: {
      url: POLYGON_AMOY_RPC,
      chainId: 80002,
      accounts: PRIVATE_KEY ? [`0x${PRIVATE_KEY}`] : [],
    },
  },
};