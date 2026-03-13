import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const deployFile = path.join(__dirname, `../deployments/${network.name}.json`);
  if (!fs.existsSync(deployFile)) {
    throw new Error(`No deployment found for ${network.name}`);
  }

  const info = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  console.log("Verifying", info.address, "on", network.name);

  await run("verify:verify", {
    address: info.address,
    constructorArguments: [
      info.vrfCoordinator,
      info.vrfKeyHash,
      BigInt(info.vrfSubId),
    ],
  });
  console.log("✓ Verified");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
