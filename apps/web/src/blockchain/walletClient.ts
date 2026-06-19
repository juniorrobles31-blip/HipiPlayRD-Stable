import { ethers } from "ethers";

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error("No se encontró wallet. Instala MetaMask o usa WalletConnect.");
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();

  return {
    provider,
    signer,
    address,
    chainId: Number(network.chainId),
    accounts,
  };
}
