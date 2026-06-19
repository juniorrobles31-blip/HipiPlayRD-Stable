const hre = require("hardhat");

async function main() {
  const HipiPlayRaces = await hre.ethers.getContractFactory("HipiPlayRaces");
  const contract = await HipiPlayRaces.deploy();

  await contract.waitForDeployment();

  console.log("HipiPlayRaces deployed to:", await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});