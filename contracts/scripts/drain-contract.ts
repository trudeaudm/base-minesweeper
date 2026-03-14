import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  if (!CONTRACT_ADDRESS) {
    throw new Error("CONTRACT_ADDRESS environment variable is not set");
  }

  console.log("Network:", network.name);
  console.log("Contract:", CONTRACT_ADDRESS);

  const [owner] = await ethers.getSigners();
  const contract = await ethers.getContractAt("Minesweeper", CONTRACT_ADDRESS);

  const ownerAddress = await contract.owner();
  if (ownerAddress.toLowerCase() !== owner.address.toLowerCase()) {
    throw new Error(`Signer ${owner.address} is not the contract owner ${ownerAddress}`);
  }

  const [pool, reserved, fees, contractBalance] = await contract.getPoolHealth();
  const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

  console.log("\n── Before ─────────────────────────────────────");
  console.log("Contract pool:      ", ethers.formatEther(pool), "ETH");
  console.log("Contract reserved: ", ethers.formatEther(reserved), "ETH");
  console.log("Contract fees:     ", ethers.formatEther(fees), "ETH");
  console.log("Contract balance:  ", ethers.formatEther(contractBalance), "ETH");
  console.log("Owner balance:     ", ethers.formatEther(ownerBalanceBefore), "ETH");

  const safeFloor = await contract.safeReserveFloor();
  const withdrawablePool = pool > safeFloor ? pool - safeFloor : 0n;

  if (withdrawablePool > 0n) {
    console.log("\nWithdrawing pool profits:", ethers.formatEther(withdrawablePool), "ETH");
    const tx1 = await contract.withdrawPoolProfits(withdrawablePool);
    await tx1.wait();
    console.log("  tx:", tx1.hash);
  } else {
    console.log("\nNo withdrawable pool profits (pool <= safe reserve floor)");
  }

  if (fees > 0n) {
    console.log("\nWithdrawing fees:", ethers.formatEther(fees), "ETH");
    const tx2 = await contract.withdrawFees();
    await tx2.wait();
    console.log("  tx:", tx2.hash);
  } else {
    console.log("\nNo fees to withdraw");
  }

  const [poolAfter, reservedAfter, feesAfter, contractBalanceAfter] = await contract.getPoolHealth();
  const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

  console.log("\n── After ──────────────────────────────────────");
  console.log("Contract pool:      ", ethers.formatEther(poolAfter), "ETH");
  console.log("Contract reserved: ", ethers.formatEther(reservedAfter), "ETH");
  console.log("Contract fees:     ", ethers.formatEther(feesAfter), "ETH");
  console.log("Contract balance:  ", ethers.formatEther(contractBalanceAfter), "ETH");
  console.log("Owner balance:     ", ethers.formatEther(ownerBalanceAfter), "ETH");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
