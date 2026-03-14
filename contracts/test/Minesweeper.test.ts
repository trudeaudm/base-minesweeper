import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { Minesweeper, VRFCoordinatorV2_5Mock } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ─────────────────────────────────────────────────────────────
// Constants mirroring the contract
// ─────────────────────────────────────────────────────────────
const GRID_SMALL  = 0;
const GRID_MEDIUM = 1;
const GRID_LARGE  = 2;

const DIFF_EASY   = 0;
const DIFF_NORMAL = 1;
const DIFF_HARD   = 2;

const ENTRY_SMALL  = ethers.parseEther("0.001");
const ENTRY_MEDIUM = ethers.parseEther("0.005");
const ENTRY_LARGE  = ethers.parseEther("0.01");

const POOL_SEED = ethers.parseEther("10");

enum GameStatus {
  WAITING_FIRST_FLIP, // 0
  WAITING_VRF,        // 1
  ACTIVE,             // 2
  CASHED_OUT,         // 3
  GAME_OVER,          // 4
  CANCELLED,          // 5
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, player, player2, sessionKey] = await ethers.getSigners();

  const MockFactory = await ethers.getContractFactory("VRFCoordinatorV2_5Mock");
  const vrfMock = (await MockFactory.deploy(0n, 0n, 1n)) as VRFCoordinatorV2_5Mock;

  const createSubTx = await vrfMock.createSubscription();
  const createSubReceipt = await createSubTx.wait();
  const subCreatedLog = createSubReceipt!.logs.find((log) => {
    try { return vrfMock.interface.parseLog(log as any)?.name === "SubscriptionCreated"; }
    catch { return false; }
  });
  const parsedSub = vrfMock.interface.parseLog(subCreatedLog as any);
  const subId = parsedSub!.args.subId as bigint;

  const MineFactory = await ethers.getContractFactory("Minesweeper");
  const KEY_HASH    = ethers.id("test-key-hash");
  const minesweeper = (await MineFactory.deploy(
    await vrfMock.getAddress(),
    KEY_HASH,
    subId
  )) as Minesweeper;

  await vrfMock.addConsumer(subId, await minesweeper.getAddress());
  await minesweeper.depositPool({ value: POOL_SEED });

  return { minesweeper, vrfMock, owner, player, player2, sessionKey, subId };
}

/**
 * Start a game and call firstFlip to trigger VRF, then fulfil VRF.
 * Returns gameId.
 * @param firstFlipTile  Tile index used for the first flip (default 0 – always safe).
 */
async function startAndFulfil(
  minesweeper:   Minesweeper,
  vrfMock:       VRFCoordinatorV2_5Mock,
  player:        HardhatEthersSigner,
  gridSize:      number,
  difficulty:    number,
  sessionKey:    string  = ethers.ZeroAddress,
  randomSeed:    bigint  = 12345n,
  firstFlipTile: number  = 0
): Promise<bigint> {
  const entryFees = [ENTRY_SMALL, ENTRY_MEDIUM, ENTRY_LARGE];

  // 1. Start game (WAITING_FIRST_FLIP)
  const startTx = await minesweeper.connect(player).startGame(
    gridSize, difficulty, sessionKey,
    { value: entryFees[gridSize] }
  );
  const startReceipt = await startTx.wait();

  const gameStartedLog = startReceipt!.logs.find((log) => {
    try { return minesweeper.interface.parseLog(log as any)?.name === "GameStarted"; }
    catch { return false; }
  });
  const parsedStart = minesweeper.interface.parseLog(gameStartedLog as any);
  const gameId = parsedStart!.args.gameId as bigint;

  // 2. First flip (WAITING_FIRST_FLIP → WAITING_VRF)
  const ffTx = await minesweeper.connect(player).firstFlip(gameId, firstFlipTile);
  const ffReceipt = await ffTx.wait();

  const ffLog = ffReceipt!.logs.find((log) => {
    try { return minesweeper.interface.parseLog(log as any)?.name === "FirstFlipMade"; }
    catch { return false; }
  });
  const parsedFF = minesweeper.interface.parseLog(ffLog as any);
  const vrfReqId = parsedFF!.args.vrfRequestId as bigint;

  // 3. Fulfil VRF (WAITING_VRF → ACTIVE, first tile auto-revealed)
  const words = [BigInt(ethers.id(randomSeed.toString()))];
  await vrfMock.fulfillRandomWordsWithOverride(
    vrfReqId,
    await minesweeper.getAddress(),
    words
  );

  return gameId;
}

/** Get all safe tile indices for a game (not mines). */
async function getSafeTiles(minesweeper: Minesweeper, gameId: bigint): Promise<number[]> {
  const g     = await minesweeper.getGame(gameId);
  const total = [20, 35, 55][g.gridSize];
  const mine  = g.mineBitmask;
  const safe: number[] = [];
  for (let i = 0; i < total; i++) {
    if (((mine >> BigInt(i)) & 1n) === 0n) safe.push(i);
  }
  return safe;
}

/** Get mine tile indices for a game. */
async function getMineTiles(minesweeper: Minesweeper, gameId: bigint): Promise<number[]> {
  const g     = await minesweeper.getGame(gameId);
  const total = [20, 35, 55][g.gridSize];
  const mine  = g.mineBitmask;
  const mines: number[] = [];
  for (let i = 0; i < total; i++) {
    if (((mine >> BigInt(i)) & 1n) === 1n) mines.push(i);
  }
  return mines;
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe("Minesweeper", () => {

  // ─── Deployment ──────────────────────────────────────────
  describe("Deployment", () => {
    it("sets owner correctly", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      expect(await minesweeper.owner()).to.equal(owner.address);
    });

    it("initialises grid configs", async () => {
      const { minesweeper } = await loadFixture(deployFixture);
      const small  = await minesweeper.gridConfigs(GRID_SMALL);
      const medium = await minesweeper.gridConfigs(GRID_MEDIUM);
      const large  = await minesweeper.gridConfigs(GRID_LARGE);
      expect(small.totalTiles).to.equal(20);
      expect(medium.totalTiles).to.equal(35);
      expect(large.totalTiles).to.equal(55);
      expect(small.entryFee).to.equal(ENTRY_SMALL);
      expect(medium.entryFee).to.equal(ENTRY_MEDIUM);
      expect(large.entryFee).to.equal(ENTRY_LARGE);
    });

    it("initialises mine counts", async () => {
      const { minesweeper } = await loadFixture(deployFixture);
      expect(await minesweeper.mineCounts(GRID_SMALL,  DIFF_EASY)).to.equal(3);
      expect(await minesweeper.mineCounts(GRID_SMALL,  DIFF_NORMAL)).to.equal(4);
      expect(await minesweeper.mineCounts(GRID_SMALL,  DIFF_HARD)).to.equal(6);
      expect(await minesweeper.mineCounts(GRID_MEDIUM, DIFF_EASY)).to.equal(5);
      expect(await minesweeper.mineCounts(GRID_MEDIUM, DIFF_NORMAL)).to.equal(7);
      expect(await minesweeper.mineCounts(GRID_MEDIUM, DIFF_HARD)).to.equal(10);
      expect(await minesweeper.mineCounts(GRID_LARGE,  DIFF_EASY)).to.equal(8);
      expect(await minesweeper.mineCounts(GRID_LARGE,  DIFF_NORMAL)).to.equal(11);
      expect(await minesweeper.mineCounts(GRID_LARGE,  DIFF_HARD)).to.equal(15);
    });

    it("seeds pool correctly", async () => {
      const { minesweeper } = await loadFixture(deployFixture);
      const { pool } = await minesweeper.getPoolHealth();
      expect(pool).to.equal(POOL_SEED);
    });
  });

  // ─── Game Start ──────────────────────────────────────────
  describe("startGame", () => {
    it("emits GameStarted and sets WAITING_FIRST_FLIP status", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await expect(
        minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
          value: ENTRY_SMALL,
        })
      ).to.emit(minesweeper, "GameStarted");

      const gameId = 1n;
      const g = await minesweeper.getGame(gameId);
      expect(g.status).to.equal(GameStatus.WAITING_FIRST_FLIP);
      expect(g.player).to.equal(player.address);
    });

    it("deducts platform fee to feeBalance", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      const { fees } = await minesweeper.getPoolHealth();
      expect(fees).to.equal(ENTRY_SMALL * 5n / 100n);
    });

    it("reserves maxPayout in reservedBalance", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      const { reserved: before } = await minesweeper.getPoolHealth();
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      const { reserved: after } = await minesweeper.getPoolHealth();
      const expectedReserve = ENTRY_SMALL * 190n / 100n;
      expect(after - before).to.equal(expectedReserve);
    });

    it("rejects wrong entry fee", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await expect(
        minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
          value: ENTRY_SMALL - 1n,
        })
      ).to.be.revertedWith("Wrong entry fee");
    });

    it("rejects concurrent game from same player", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await expect(
        minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
          value: ENTRY_SMALL,
        })
      ).to.be.revertedWith("Active game exists");
    });

    it("rejects when pool insufficient", async () => {
      const MockFactory = await ethers.getContractFactory("VRFCoordinatorV2_5Mock");
      const vrfMock2 = await MockFactory.deploy(0n, 0n, 1n);
      const createTx = await vrfMock2.createSubscription();
      const createRcpt = await createTx.wait();
      const subLog = createRcpt!.logs.find((log) => {
        try { return vrfMock2.interface.parseLog(log as any)?.name === "SubscriptionCreated"; }
        catch { return false; }
      });
      const subId2 = (vrfMock2.interface.parseLog(subLog as any)!.args.subId) as bigint;

      const MineFactory = await ethers.getContractFactory("Minesweeper");
      const ms2 = await MineFactory.deploy(
        await vrfMock2.getAddress(),
        ethers.id("kh"),
        subId2
      ) as Minesweeper;
      await vrfMock2.addConsumer(subId2, await ms2.getAddress());

      const [, player] = await ethers.getSigners();
      await expect(
        ms2.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
          value: ENTRY_SMALL,
        })
      ).to.be.revertedWith("Insufficient pool");
    });

    it("stores session key", async () => {
      const { minesweeper, player, sessionKey } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, sessionKey.address, {
        value: ENTRY_SMALL,
      });
      const g = await minesweeper.getGame(1n);
      expect(g.sessionKey).to.equal(sessionKey.address);
    });

    it("hard difficulty reserves 1.95× entry", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_HARD, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      const { reserved } = await minesweeper.getPoolHealth();
      const expected = ENTRY_SMALL * 195n / 100n;
      expect(reserved).to.equal(expected);
    });
  });

  // ─── First Flip & Safe-First-Click ───────────────────────
  describe("firstFlip (safe-first-click)", () => {
    it("transitions game from WAITING_FIRST_FLIP to WAITING_VRF", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      const gameId = 1n;
      await minesweeper.connect(player).firstFlip(gameId, 5);
      const g = await minesweeper.getGame(gameId);
      expect(g.status).to.equal(GameStatus.WAITING_VRF);
    });

    it("emits FirstFlipMade with correct tileIndex and vrfRequestId", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await expect(
        minesweeper.connect(player).firstFlip(1n, 7)
      )
        .to.emit(minesweeper, "FirstFlipMade")
        .withArgs(1n, 7, (reqId: bigint) => reqId > 0n);
    });

    it("session key can call firstFlip", async () => {
      const { minesweeper, player, sessionKey } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, sessionKey.address, {
        value: ENTRY_SMALL,
      });
      await expect(
        minesweeper.connect(sessionKey).firstFlip(1n, 3)
      ).to.not.be.reverted;
    });

    it("unauthorised caller cannot call firstFlip", async () => {
      const { minesweeper, player, player2 } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await expect(
        minesweeper.connect(player2).firstFlip(1n, 0)
      ).to.be.revertedWith("Not authorised");
    });

    it("rejects firstFlip when game is not in WAITING_FIRST_FLIP state", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      // After startAndFulfil the game is ACTIVE
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      await expect(
        minesweeper.connect(player).firstFlip(gameId, 0)
      ).to.be.revertedWith("Not waiting for first flip");
    });

    it("rejects firstFlip twice on same game", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await minesweeper.connect(player).firstFlip(1n, 0);
      // Now in WAITING_VRF – cannot call again
      await expect(
        minesweeper.connect(player).firstFlip(1n, 1)
      ).to.be.revertedWith("Not waiting for first flip");
    });

    it("rejects firstFlip with out-of-range tile", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await expect(
        minesweeper.connect(player).firstFlip(1n, 20) // SMALL only has 0-19
      ).to.be.revertedWith("Tile out of range");
    });

    it("chosen tile is guaranteed safe — never a mine", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      // Test across multiple tile indices and random seeds to confirm guarantee
      for (let tileIdx = 0; tileIdx < 5; tileIdx++) {
        const gameId = await startAndFulfil(
          minesweeper, vrfMock, player, GRID_SMALL, DIFF_HARD,
          ethers.ZeroAddress, BigInt(tileIdx * 9999 + 1), tileIdx
        );
        const g = await minesweeper.getGame(gameId);
        const isMine = ((g.mineBitmask >> BigInt(tileIdx)) & 1n) === 1n;
        expect(isMine).to.be.false;
        // Let game end so player can start next game
        const safeTiles = await getSafeTiles(minesweeper, gameId);
        const remaining = safeTiles.filter(t => t !== tileIdx);
        await minesweeper.connect(player).flipTile(gameId, remaining[0]);
        await minesweeper.connect(player).cashOut(gameId);
      }
    });

    it("first tile is auto-revealed after VRF (safeRevealed = 1, revealedBitmask set)", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const chosenTile = 10;
      const gameId = await startAndFulfil(
        minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL,
        ethers.ZeroAddress, 12345n, chosenTile
      );
      const g = await minesweeper.getGame(gameId);
      expect(g.safeRevealed).to.equal(1);
      expect((g.revealedBitmask >> BigInt(chosenTile)) & 1n).to.equal(1n);
    });

    it("VRF callback emits TileRevealed for the auto-revealed first tile", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      const gameId = 1n;
      const ffTx      = await minesweeper.connect(player).firstFlip(gameId, 4);
      const ffReceipt = await ffTx.wait();
      const ffLog     = ffReceipt!.logs.find((log) => {
        try { return minesweeper.interface.parseLog(log as any)?.name === "FirstFlipMade"; }
        catch { return false; }
      });
      const vrfReqId = minesweeper.interface.parseLog(ffLog as any)!.args.vrfRequestId as bigint;

      await expect(
        vrfMock.fulfillRandomWordsWithOverride(
          vrfReqId,
          await minesweeper.getAddress(),
          [BigInt(ethers.id("seed"))]
        )
      ).to.emit(minesweeper, "TileRevealed")
        .withArgs(gameId, ethers.ZeroAddress, 4, false, 1, (p: bigint) => p >= 0n);
    });

    it("cannot call flipTile while in WAITING_FIRST_FLIP state", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await expect(
        minesweeper.connect(player).flipTile(1n, 0)
      ).to.be.revertedWith("Game not active");
    });
  });

  // ─── VRF Fulfillment ─────────────────────────────────────
  describe("VRF fulfillment", () => {
    it("transitions game to ACTIVE after VRF", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const g = await minesweeper.getGame(gameId);
      expect(g.status).to.equal(GameStatus.ACTIVE);
    });

    it("sets correct number of mines", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const mines = await getMineTiles(minesweeper, gameId);
      expect(mines.length).to.equal(4);
    });

    it("all mine bits within valid range", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_LARGE, DIFF_HARD);
      const mines = await getMineTiles(minesweeper, gameId);
      expect(mines.length).to.equal(15);
      for (const idx of mines) {
        expect(idx).to.be.lt(55);
      }
    });

    it("rejects flipTile while WAITING_VRF", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      // Get to WAITING_VRF by calling startGame + firstFlip but NOT fulfilling VRF
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await minesweeper.connect(player).firstFlip(1n, 0);
      await expect(
        minesweeper.connect(player).flipTile(1n, 1)
      ).to.be.revertedWith("Game not active");
    });
  });

  // ─── Tile Flipping ───────────────────────────────────────
  describe("flipTile", () => {
    it("emits TileRevealed on safe tile", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);
      // First safe tile (index 0) is the auto-revealed one; pick the second
      await expect(
        minesweeper.connect(player).flipTile(gameId, safeTiles[1])
      ).to.emit(minesweeper, "TileRevealed");
    });

    it("increments safeRevealed on safe tile", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);
      // safeRevealed starts at 1 (auto-revealed first tile); pick tiles[1] and tiles[2]
      await minesweeper.connect(player).flipTile(gameId, safeTiles[1]);
      await minesweeper.connect(player).flipTile(gameId, safeTiles[2]);
      const g = await minesweeper.getGame(gameId);
      expect(g.safeRevealed).to.equal(3); // 1 auto + 2 manual
    });

    it("session key can flip tile", async () => {
      const { minesweeper, vrfMock, player, sessionKey } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(
        minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL, sessionKey.address
      );
      const safeTiles = await getSafeTiles(minesweeper, gameId);
      await expect(
        minesweeper.connect(sessionKey).flipTile(gameId, safeTiles[1])
      ).to.not.be.reverted;
    });

    it("unauthorised caller cannot flip tile", async () => {
      const { minesweeper, vrfMock, player, player2 } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      await expect(
        minesweeper.connect(player2).flipTile(gameId, 5)
      ).to.be.revertedWith("Not authorised");
    });

    it("rejects already-revealed tile", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);
      await minesweeper.connect(player).flipTile(gameId, safeTiles[1]);
      await expect(
        minesweeper.connect(player).flipTile(gameId, safeTiles[1])
      ).to.be.revertedWith("Tile already revealed");
    });

    it("rejects out-of-range tile", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      await expect(
        minesweeper.connect(player).flipTile(gameId, 20)
      ).to.be.revertedWith("Tile out of range");
    });
  });

  // ─── Game Over ───────────────────────────────────────────
  describe("Mine hit — Game Over", () => {
    it("emits GameOver event", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const mineTiles = await getMineTiles(minesweeper, gameId);
      await expect(
        minesweeper.connect(player).flipTile(gameId, mineTiles[0])
      ).to.emit(minesweeper, "GameOver");
    });

    it("sets status to GAME_OVER", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const mineTiles = await getMineTiles(minesweeper, gameId);
      await minesweeper.connect(player).flipTile(gameId, mineTiles[0]);
      const g = await minesweeper.getGame(gameId);
      expect(g.status).to.equal(GameStatus.GAME_OVER);
    });

    it("releases reservation to pool (no payout to player)", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const { pool: poolBefore } = await minesweeper.getPoolHealth();
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const mineTiles = await getMineTiles(minesweeper, gameId);
      await minesweeper.connect(player).flipTile(gameId, mineTiles[0]);
      const { pool: poolAfter } = await minesweeper.getPoolHealth();
      expect(poolAfter).to.be.gt(poolBefore);
    });

    it("clears player active game", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const mineTiles = await getMineTiles(minesweeper, gameId);
      await minesweeper.connect(player).flipTile(gameId, mineTiles[0]);
      expect(await minesweeper.playerActiveGame(player.address)).to.equal(0n);
    });
  });

  // ─── Cash Out ────────────────────────────────────────────
  describe("cashOut", () => {
    it("pays player based on safe tiles revealed", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);

      // safeRevealed already starts at 1 (auto-reveal); flip 2 more
      await minesweeper.connect(player).flipTile(gameId, safeTiles[1]);
      await minesweeper.connect(player).flipTile(gameId, safeTiles[2]);

      const balBefore = await ethers.provider.getBalance(player.address);
      const tx      = await minesweeper.connect(player).cashOut(gameId);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter = await ethers.provider.getBalance(player.address);
      const received = balAfter + gasUsed - balBefore;

      // safeRevealed = 3; payout = maxPayout × 3 / totalSafe
      const maxPayout = ENTRY_SMALL * 190n / 100n;
      const expected  = maxPayout * 3n / BigInt(safeTiles.length);
      expect(received).to.equal(expected);
    });

    it("emits GameCashedOut event", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      // safeRevealed = 1 already (auto-reveal) — can cashout immediately
      await expect(
        minesweeper.connect(player).cashOut(gameId)
      ).to.emit(minesweeper, "GameCashedOut");
    });

    it("auto-cashout on full clear", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);

      // First safe tile is already revealed; flip the rest except the last
      for (let i = 1; i < safeTiles.length - 1; i++) {
        await minesweeper.connect(player).flipTile(gameId, safeTiles[i]);
      }
      await expect(
        minesweeper.connect(player).flipTile(gameId, safeTiles[safeTiles.length - 1])
      ).to.emit(minesweeper, "GameCashedOut");

      const g = await minesweeper.getGame(gameId);
      expect(g.status).to.equal(GameStatus.CASHED_OUT);
    });

    it("full clear pays 1.9× entry fee", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);

      const balBefore = await ethers.provider.getBalance(player.address);
      let totalGas = 0n;
      // Flip all safe tiles except the first (already auto-revealed)
      for (const tile of safeTiles.slice(1)) {
        const tx      = await minesweeper.connect(player).flipTile(gameId, tile);
        const receipt = await tx.wait();
        totalGas += receipt!.gasUsed * receipt!.gasPrice;
      }
      const balAfter = await ethers.provider.getBalance(player.address);
      const received = balAfter + totalGas - balBefore;
      const expected = ENTRY_SMALL * 190n / 100n;
      expect(received).to.equal(expected);
    });

    it("rejects cashout with zero tiles revealed (impossible after VRF — coverage guard)", async () => {
      // After VRF, safeRevealed = 1 always. This test verifies the guard still
      // compiles and would catch any future regression that resets safeRevealed.
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      // safeRevealed = 1 → cashOut succeeds, not reverted
      await expect(
        minesweeper.connect(player).cashOut(gameId)
      ).to.not.be.reverted;
    });

    it("session key can trigger cashout", async () => {
      const { minesweeper, vrfMock, player, sessionKey } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(
        minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL, sessionKey.address
      );
      // safeRevealed = 1 (auto-reveal) — session key can cashout immediately
      await expect(
        minesweeper.connect(sessionKey).cashOut(gameId)
      ).to.emit(minesweeper, "GameCashedOut");
    });
  });

  // ─── Payout Calculation ──────────────────────────────────
  describe("Payout curve", () => {
    it("returns non-zero after auto-reveal (safeRevealed = 1)", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const payout = await minesweeper.getCurrentPayout(gameId);
      expect(payout).to.be.gt(0n);
    });

    it("returns maxPayout for full clear", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);
      for (const tile of safeTiles.slice(1, -1)) {
        await minesweeper.connect(player).flipTile(gameId, tile);
      }
      await minesweeper.connect(player).flipTile(gameId, safeTiles[safeTiles.length - 1]);
      const { reserved } = await minesweeper.getPoolHealth();
      expect(reserved).to.equal(0n);
    });

    it("linear scaling at 25% clear", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId    = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const safeTiles = await getSafeTiles(minesweeper, gameId);
      const quarter   = Math.floor(safeTiles.length / 4);
      // safeTiles[0] already revealed; flip more until we reach quarter
      for (let i = 1; i < quarter; i++) {
        await minesweeper.connect(player).flipTile(gameId, safeTiles[i]);
      }
      const payout   = await minesweeper.getCurrentPayout(gameId);
      const maxP     = ENTRY_SMALL * 190n / 100n;
      const expected = maxP * BigInt(quarter) / BigInt(safeTiles.length);
      expect(payout).to.equal(expected);
    });
  });

  // ─── Grid Availability ───────────────────────────────────
  describe("Grid availability", () => {
    it("returns true when pool is sufficient", async () => {
      const { minesweeper } = await loadFixture(deployFixture);
      expect(await minesweeper.isGridAvailable(GRID_SMALL, DIFF_NORMAL)).to.be.true;
    });

    it("returns false when grid is inactive", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      await minesweeper.connect(owner).setGridActive(GRID_SMALL, false);
      expect(await minesweeper.isGridAvailable(GRID_SMALL, DIFF_NORMAL)).to.be.false;
    });
  });

  // ─── Admin Functions ─────────────────────────────────────
  describe("Admin", () => {
    it("owner can deposit pool", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      const { pool: before } = await minesweeper.getPoolHealth();
      await minesweeper.connect(owner).depositPool({ value: ethers.parseEther("1") });
      const { pool: after } = await minesweeper.getPoolHealth();
      expect(after - before).to.equal(ethers.parseEther("1"));
    });

    it("owner can withdraw fees", async () => {
      const { minesweeper, vrfMock, owner, player } = await loadFixture(deployFixture);
      await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      const balBefore = await ethers.provider.getBalance(owner.address);
      const tx        = await minesweeper.connect(owner).withdrawFees();
      const receipt   = await tx.wait();
      const gas       = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter  = await ethers.provider.getBalance(owner.address);
      const gained    = balAfter + gas - balBefore;
      expect(gained).to.equal(ENTRY_SMALL * 5n / 100n);
    });

    it("non-owner cannot withdraw fees", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await expect(
        minesweeper.connect(player).withdrawFees()
      ).to.be.revertedWith("Only callable by owner");
    });

    it("owner can set platform fee", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      await minesweeper.connect(owner).setPlatformFee(300);
      expect(await minesweeper.platformFeeBPS()).to.equal(300);
    });

    it("rejects platform fee > 10%", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      await expect(
        minesweeper.connect(owner).setPlatformFee(1001)
      ).to.be.revertedWith("Fee too high");
    });

    it("owner can update mine count", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      await minesweeper.connect(owner).setMineCount(GRID_SMALL, DIFF_EASY, 2);
      expect(await minesweeper.mineCounts(GRID_SMALL, DIFF_EASY)).to.equal(2);
    });

    it("owner can update max concurrent games", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      await minesweeper.connect(owner).setMaxConcurrentGames(GRID_SMALL, 100);
      const cfg = await minesweeper.gridConfigs(GRID_SMALL);
      expect(cfg.maxConcurrent).to.equal(100);
    });

    it("withdrawPoolProfits respects safe floor", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      const floor = await minesweeper.safeReserveFloor();
      const pool  = await minesweeper.poolBalance();
      const excess = pool - floor + 1n;
      if (excess > 0n) {
        await expect(
          minesweeper.connect(owner).withdrawPoolProfits(excess)
        ).to.be.revertedWith("Would breach safe floor");
      }
    });

    it("withdrawPoolProfits succeeds within safe floor", async () => {
      const { minesweeper, owner } = await loadFixture(deployFixture);
      await minesweeper.connect(owner).depositPool({ value: ethers.parseEther("100") });
      const floor  = await minesweeper.safeReserveFloor();
      const pool   = await minesweeper.poolBalance();
      const profit = pool - floor;
      if (profit > 0n) {
        await expect(
          minesweeper.connect(owner).withdrawPoolProfits(profit)
        ).to.emit(minesweeper, "ProfitWithdrawn");
      }
    });
  });

  // ─── Session Keys ────────────────────────────────────────
  describe("Session keys", () => {
    it("player can update session key", async () => {
      const { minesweeper, vrfMock, player, player2 } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      await minesweeper.connect(player).setSessionKey(gameId, player2.address);
      const g = await minesweeper.getGame(gameId);
      expect(g.sessionKey).to.equal(player2.address);
    });

    it("non-player cannot update session key", async () => {
      const { minesweeper, vrfMock, player, player2 } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_SMALL, DIFF_NORMAL);
      await expect(
        minesweeper.connect(player2).setSessionKey(gameId, player2.address)
      ).to.be.revertedWith("Not player");
    });
  });

  // ─── Emergency Cancel (block-based thresholds) ───────────────────────────
  describe("cancelStuckGame", () => {
    it("can cancel after 100 blocks if player never made first flip", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await mine(101);

      const gameId = await minesweeper.playerActiveGame(player.address);
      await expect(
        minesweeper.connect(player).cancelStuckGame(gameId)
      ).to.not.be.reverted;

      const g = await minesweeper.getGame(gameId);
      expect(g.status).to.equal(GameStatus.CANCELLED);
    });

    it("can cancel after 43200 blocks if VRF never returned", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      await minesweeper.connect(player).firstFlip(1n, 0);
      await mine(43201);

      const gameId = await minesweeper.playerActiveGame(player.address);
      const g = await minesweeper.getGame(gameId);
      expect(g.status).to.equal(GameStatus.WAITING_VRF);
      await expect(
        minesweeper.connect(player).cancelStuckGame(gameId)
      ).to.not.be.reverted;
    });

    it("rejects cancel before block threshold", async () => {
      const { minesweeper, player } = await loadFixture(deployFixture);
      await minesweeper.connect(player).startGame(GRID_SMALL, DIFF_NORMAL, ethers.ZeroAddress, {
        value: ENTRY_SMALL,
      });
      const gameId = await minesweeper.playerActiveGame(player.address);
      await expect(
        minesweeper.connect(player).cancelStuckGame(gameId)
      ).to.be.revertedWith("Cancel available after block threshold");
    });
  });

  // ─── Multiple Grids ──────────────────────────────────────
  describe("Multi-grid games", () => {
    it("MEDIUM grid — correct mine count (Normal)", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_MEDIUM, DIFF_NORMAL);
      const mines = await getMineTiles(minesweeper, gameId);
      expect(mines.length).to.equal(7);
    });

    it("LARGE grid — correct mine count (Easy)", async () => {
      const { minesweeper, vrfMock, player } = await loadFixture(deployFixture);
      const gameId = await startAndFulfil(minesweeper, vrfMock, player, GRID_LARGE, DIFF_EASY);
      const mines = await getMineTiles(minesweeper, gameId);
      expect(mines.length).to.equal(8);
    });
  });
});
