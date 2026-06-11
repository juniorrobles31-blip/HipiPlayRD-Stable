const { ethers } = require("hardhat");

async function main() {
  const Registry = await ethers.getContractFactory("LocalFirstWalletRegistry");
  const registry = await Registry.deploy();

  await registry.deployed();

  console.log("LocalFirstWalletRegistry deployed to:", registry.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});