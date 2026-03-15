import { ethers, network, run } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("Deploying Minesweeper to:", network.name);

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance: ", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // ── VRF Config ────────────────────────────────────────────────
  // Base Sepolia Chainlink VRF v2.5
  // See: https://docs.chain.link/vrf/v2-5/supported-networks
  const VRF_COORDINATOR = process.env.VRF_COORDINATOR ||
    "0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE"; // Base Sepolia VRF v2.5

  const VRF_KEYHASH = process.env.VRF_KEYHASH ||
    "0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71"; // 30 gwei lane

  const VRF_SUBSCRIPTION_ID = BigInt(process.env.VRF_SUBSCRIPTION_ID || "0");

  if (VRF_SUBSCRIPTION_ID === 0n) {
    console.warn("⚠  VRF_SUBSCRIPTION_ID not set — you must fund and configure VRF after deployment");
  }

  // ── Deploy ────────────────────────────────────────────────────
  const Factory = await ethers.getContractFactory("Minesweeper");
  const contract = await Factory.deploy(
    VRF_COORDINATOR,
    VRF_KEYHASH,
    VRF_SUBSCRIPTION_ID
  );
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✓ Minesweeper deployed to:", address);

  // ── Seed Pool (optional; set SEED_AMOUNT_ETH=0 to skip) ───────
  const seedEth = process.env.SEED_AMOUNT_ETH ?? "0.1";
  const SEED_AMOUNT = ethers.parseEther(seedEth);
  if (SEED_AMOUNT > 0n) {
    console.log("Seeding pool with", ethers.formatEther(SEED_AMOUNT), "ETH...");
    const seedTx = await contract.depositPool({ value: SEED_AMOUNT });
    await seedTx.wait();
    console.log("✓ Pool seeded");
  } else {
    console.log("Skipping pool seed (SEED_AMOUNT_ETH=0). Seed later via admin page.");
  }

  // ── Post-deployment Checklist ─────────────────────────────────
  console.log("\n────────────────────────────────────────────────");
  console.log("POST-DEPLOYMENT CHECKLIST:");
  console.log("1. Add contract as a VRF consumer on subscription", VRF_SUBSCRIPTION_ID.toString());
  console.log("   Coordinator:", VRF_COORDINATOR);
  console.log("2. Fund the VRF subscription with LINK");
  console.log("3. Update frontend VITE_CONTRACT_ADDRESS =", address);
  console.log("4. Verify contract:");
  console.log(`   npx hardhat verify --network ${network.name} ${address} "${VRF_COORDINATOR}" "${VRF_KEYHASH}" ${VRF_SUBSCRIPTION_ID}`);
  console.log("────────────────────────────────────────────────\n");

  // Save deployment info
  const deployInfo = {
    network:    network.name,
    chainId:    (await ethers.provider.getNetwork()).chainId.toString(),
    address,
    vrfCoordinator: VRF_COORDINATOR,
    vrfKeyHash:     VRF_KEYHASH,
    vrfSubId:       VRF_SUBSCRIPTION_ID.toString(),
    deployer:       deployer.address,
    deployedAt:     new Date().toISOString(),
  };

  const fs = await import("fs");
  const path = await import("path");
  const outDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deployInfo, null, 2));
  console.log("Deployment info saved to:", outFile);

  // Attempt verification (non-fatal if API key not set)
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("\nAttempting contract verification...");
    try {
      await run("verify:verify", {
        address,
        constructorArguments: [VRF_COORDINATOR, VRF_KEYHASH, VRF_SUBSCRIPTION_ID],
      });
      console.log("✓ Contract verified");
    } catch (e: any) {
      console.warn("Verification failed (non-fatal):", e.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
