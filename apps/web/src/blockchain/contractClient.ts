import { ethers } from "ethers";
import { connectWallet } from "./walletClient";

export const HIPIPLAY_CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

export const HIPIPLAY_ABI = [
  "function placeBet(uint256 raceId, uint8 horse) external payable",
  "function getHorsePool(uint256 raceId, uint8 horse) external view returns (uint256)",
  "function getBetsCount(uint256 raceId) external view returns (uint256)",
  "function claimPrize(uint256 raceId, uint256 betIndex) external",
];

export async function getHipiPlayContract() {
  const { signer } = await connectWallet();
  return new ethers.Contract(HIPIPLAY_CONTRACT_ADDRESS, HIPIPLAY_ABI, signer);
}

export async function placeBlockchainBet(
  raceId: number,
  horse: number,
  amountEth: string
) {
  const contract = await getHipiPlayContract();

  return contract.placeBet(raceId, horse, {
    value: ethers.parseEther(amountEth),
  });
}