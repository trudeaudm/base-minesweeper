import { ethers } from "hardhat";

const CONTRACT =
  process.env.CONTRACT_ADDRESS ?? "0xE2e2823454e331795E044CE4D81C49B51c3805Be";
const SEED_AMOUNT = ethers.parseEther("0.05");

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Signer :", signer.address);
  console.log("Target :", CONTRACT);
  console.log("Amount :", ethers.formatEther(SEED_AMOUNT), "ETH");

  const minesweeper = await ethers.getContractAt("Minesweeper", CONTRACT, signer);

  const tx = await minesweeper.depositPool({ value: SEED_AMOUNT });
  console.log("Tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block", receipt?.blockNumber);

  const [pool, reserved, fees, contractBal] = await minesweeper.getPoolHealth();
  console.log("Pool balance after seed  :", ethers.formatEther(pool), "ETH");
  console.log("Reserved (active games)  :", ethers.formatEther(reserved), "ETH");
  console.log("Fee balance              :", ethers.formatEther(fees), "ETH");
  console.log("Contract ETH balance     :", ethers.formatEther(contractBal), "ETH");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
