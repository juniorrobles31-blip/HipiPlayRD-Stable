const hre = require("hardhat");

async function main() {
  const address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const contract = await hre.ethers.getContractAt("HipiPlayRaces", address);

  const serverSeed = "hipiplay-test-seed-001";
  const serverSeedHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(serverSeed));

  console.log("Contrato:", address);
  console.log("serverSeed:", serverSeed);
  console.log("serverSeedHash:", serverSeedHash);

  const tx = await contract.createRace(serverSeedHash);
  await tx.wait();

  const raceCounter = await contract.raceCounter();
  console.log("Carrera blockchain creada:", raceCounter.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
