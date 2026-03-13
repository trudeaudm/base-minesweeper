# Base Minesweeper — Onchain Wagering Game

A provably fair Minesweeper game on **Base Chain** where players wager ETH, flip tiles, and cash out winnings at any point. Hit a mine and lose your wager. Clear the whole board and pocket up to **1.9x** your entry.

## Architecture

```
base-minesweeper/
├── contracts/          # Hardhat project — Solidity smart contracts
│   ├── contracts/
│   │   └── Minesweeper.sol
│   ├── scripts/        # Deployment scripts
│   ├── test/           # Contract tests (TypeScript)
│   ├── hardhat.config.ts
│   └── package.json
├── frontend/           # Vite + React app
│   ├── src/
│   │   ├── abis/       # Contract ABI
│   │   ├── components/ # UI components
│   │   ├── hooks/      # Custom React hooks
│   │   ├── lib/        # Utilities
│   │   └── pages/      # Page components
│   └── package.json
└── README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Tailwind CSS, Viem, Wagmi v2 |
| Wallet | RainbowKit, Privy (session keys) |
| Contract | Solidity 0.8.24, OpenZeppelin |
| Randomness | Chainlink VRF v2 |
| Network | Base Sepolia (testnet) → Base Mainnet |

## Game Mechanics

### Grid Sizes
| Grid | Tiles | Normal Mines | Entry Fee | Max Payout |
|------|-------|-------------|-----------|-----------|
| 5×4  | 20    | 4           | 0.001 ETH | 1.9× entry |
| 5×7  | 35    | 7           | 0.005 ETH | 1.9× entry |
| 5×11 | 55    | 11          | 0.01 ETH  | 1.9× entry |

### Difficulty
| Difficulty | 5×4 | 5×7 | 5×11 | Max Payout |
|------------|-----|-----|------|-----------|
| Easy       | 3   | 5   | 8    | 1.9×       |
| Normal     | 4   | 7   | 11   | 1.9×       |
| Hard       | 6   | 10  | 15   | 1.95×      |

### Payout Curve (Linear)
- 0% safe tiles cleared → 0×
- 50% safe tiles cleared → ~0.95× (near break-even)
- 100% safe tiles cleared → 1.9× (or 1.95× on Hard)

### Revenue Model
- **Platform fee**: 5% taken immediately on game start
- **House edge**: 1.9× max payout (not 2×) creates mathematical edge over volume

## Quick Start

### Contracts

```bash
cd contracts
npm install
cp .env.example .env  # fill in keys
npx hardhat test
npx hardhat run scripts/deploy.ts --network baseSepolia
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env  # fill in deployed contract address
npm run dev
```

## Environment Variables

### contracts/.env
```
PRIVATE_KEY=your_deployer_private_key
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_API_KEY=your_basescan_api_key
VRF_COORDINATOR=0x...     # Chainlink VRF Coordinator (Base Sepolia)
VRF_KEYHASH=0x...         # Gas lane key hash
VRF_SUBSCRIPTION_ID=123   # Your Chainlink VRF subscription ID
```

### frontend/.env
```
VITE_CONTRACT_ADDRESS=0x...
VITE_CHAIN_ID=84532         # Base Sepolia
VITE_WALLETCONNECT_PROJECT_ID=your_wc_project_id
```

## Contract Admin Functions

```solidity
setGameConfig(gridSize, entryPriceETH, maxPayoutBPS)
setMineCount(gridSize, difficulty, mineCount)
setPlatformFee(percent)
setMaxConcurrentGames(gridSize, max)
setMinPoolThreshold(gridSize, amount)
depositPool()
withdrawFees()
withdrawPoolProfits(amount)
```

## License

MIT
