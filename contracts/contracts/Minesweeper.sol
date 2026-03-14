// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/interfaces/IVRFCoordinatorV2Plus.sol";
import "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Minesweeper
 * @notice Onchain Minesweeper wagering game on Base Chain.
 *         Players wager ETH, flip tiles, and can cash out at any point.
 *         Mine placement is determined by Chainlink VRF v2.5 for provable fairness.
 *
 * Safe-first-click guarantee
 * ──────────────────────────
 *   startGame()  → WAITING_FIRST_FLIP  (board shown, board empty)
 *   firstFlip()  → WAITING_VRF         (VRF requested with chosen tile as seed exclusion)
 *   VRF callback → ACTIVE              (mines placed, first tile auto-revealed as safe)
 *   flipTile() / cashOut() as usual
 *
 * Grid sizes (all 5 tiles wide, portrait orientation):
 *   0 → 5×4  = 20 tiles   Entry: 0.001 ETH
 *   1 → 5×6  = 30 tiles   Entry: 0.005 ETH
 *   2 → 5×10 = 50 tiles   Entry: 0.01  ETH
 *
 * Difficulty mine counts (SMALL / MEDIUM / LARGE):
 *   EASY:   4 / 5 / 8
 *   NORMAL: 5 / 7 / 11
 *   HARD:   6 / 10 / 15
 *
 * Payout curve (linear): payout = maxPayout × (safeRevealed / totalSafe)
 *   Max payout by difficulty: EASY 1.5×, NORMAL 1.7×, HARD 1.9×
 */
contract Minesweeper is VRFConsumerBaseV2Plus, ReentrancyGuard {

    // ─────────────────────────────────────────────
    // Enums & Constants
    // ─────────────────────────────────────────────

    uint8 public constant GRID_SMALL  = 0; // 5×4  = 20 tiles
    uint8 public constant GRID_MEDIUM = 1; // 5×6  = 30 tiles
    uint8 public constant GRID_LARGE  = 2; // 5×10 = 50 tiles

    uint8 public constant DIFF_EASY   = 0;
    uint8 public constant DIFF_NORMAL = 1;
    uint8 public constant DIFF_HARD   = 2;

    // Max payout as multiple of entry (by difficulty)
    uint16 public constant MAX_PAYOUT_BPS_EASY   = 15000; // 1.5×
    uint16 public constant MAX_PAYOUT_BPS_NORMAL = 17000; // 1.7×
    uint16 public constant MAX_PAYOUT_BPS_HARD   = 19000; // 1.9×
    uint16 public constant BPS_DENOMINATOR        = 10000;

    // Block-based cancellation thresholds (~3.3 min and ~24h on Base at 2s/block)
    uint256 public constant CANCEL_BLOCKS_WAITING_FIRST_FLIP = 100;
    uint256 public constant CANCEL_BLOCKS_WAITING_VRF        = 43200;

    // ─────────────────────────────────────────────
    // Grid & Difficulty Config
    // ─────────────────────────────────────────────

    struct GridConfig {
        uint8   totalTiles;
        uint256 entryFee;          // in wei
        uint16  maxPayoutBPS;      // legacy; payout uses difficulty-based BPS
        uint32  maxConcurrent;     // cap active games for this grid
        uint256 minPoolThreshold;  // pool must have >= this to open grid
        bool    active;
    }

    // gridSize => GridConfig
    mapping(uint8 => GridConfig) public gridConfigs;

    // gridSize => difficulty => mineCount
    mapping(uint8 => mapping(uint8 => uint8)) public mineCounts;

    // ─────────────────────────────────────────────
    // Game State
    // ─────────────────────────────────────────────

    enum GameStatus {
        WAITING_FIRST_FLIP, // 0 – startGame done; player must click a tile to trigger VRF
        WAITING_VRF,        // 1 – VRF request in-flight; mines not yet placed
        ACTIVE,             // 2 – mines placed; player can flip tiles
        CASHED_OUT,         // 3 – player cashed out
        GAME_OVER,          // 4 – player hit a mine
        CANCELLED           // 5 – VRF / first-flip never arrived (safety escape)
    }

    struct Game {
        address  player;
        address  sessionKey;      // authorized to call firstFlip / flipTile / cashOut on player's behalf
        uint8    gridSize;
        uint8    difficulty;
        uint256  entryFee;
        uint256  maxPayout;       // reserved amount (entryFee × maxPayoutBPS / BPS_DENOM)
        uint8    safeTileIndex;   // tile chosen by the player on first click (guaranteed safe)
        uint64   mineBitmask;     // bit i = 1 means tile i is a mine (set after VRF)
        uint64   revealedBitmask; // bit i = 1 means tile i was revealed
        uint8    safeRevealed;    // count of safe tiles revealed
        uint8    totalSafe;       // totalTiles - mineCount
        GameStatus status;
        uint256  vrfRequestId;
        uint256  startBlock;      // block number when startGame() was called (for cancellation thresholds)
        uint256  startedAt;
        uint256  endedAt;
    }

    uint256 public nextGameId = 1;
    mapping(uint256 => Game) public games;

    // vrfRequestId → gameId
    mapping(uint256 => uint256) public vrfRequestToGame;

    // player → active gameId (0 = none)
    mapping(address => uint256) public playerActiveGame;

    // active game count per gridSize
    mapping(uint8 => uint32) public activeGameCount;

    // ─────────────────────────────────────────────
    // Pool Accounting
    // ─────────────────────────────────────────────

    uint256 public poolBalance;      // unallocated ETH available for new games / withdrawal
    uint256 public reservedBalance;  // ETH locked for active game max-payouts
    uint256 public feeBalance;       // accumulated platform fees (withdrawable by owner)

    uint16 public platformFeeBPS = 500; // 5% (500 / 10000)

    // ─────────────────────────────────────────────
    // Chainlink VRF v2.5
    // ─────────────────────────────────────────────

    bytes32 public vrfKeyHash;
    uint256 public vrfSubscriptionId;
    uint32  public vrfCallbackGasLimit = 500_000;
    uint16  public vrfRequestConfirmations = 3;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    event GameStarted(
        uint256 indexed gameId,
        address indexed player,
        address  sessionKey,
        uint8    gridSize,
        uint8    difficulty,
        uint256  entryFee,
        uint256  maxPayout
    );
    event FirstFlipMade(
        uint256 indexed gameId,
        uint8    tileIndex,
        uint256  vrfRequestId
    );
    event TileRevealed(
        uint256 indexed gameId,
        address indexed caller,
        uint8    tileIndex,
        bool     isMine,
        uint8    safeRevealed,
        uint256  currentPayout
    );
    event GameCashedOut(
        uint256 indexed gameId,
        address indexed player,
        uint256  payout,
        uint8    safeRevealed,
        uint8    totalSafe
    );
    event GameOver(
        uint256 indexed gameId,
        address indexed player,
        uint8    mineTile,
        uint64   mineBitmask
    );
    event FeeWithdrawn(address indexed owner, uint256 amount);
    event ProfitWithdrawn(address indexed owner, uint256 amount);
    event PoolDeposited(address indexed sender, uint256 amount);
    event SessionKeySet(uint256 indexed gameId, address indexed sessionKey);
    event VRFConfigUpdated(bytes32 keyHash, uint256 subscriptionId, uint32 callbackGasLimit);

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    constructor(
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint256 _subscriptionId
    )
        VRFConsumerBaseV2Plus(_vrfCoordinator)
    {
        vrfKeyHash        = _keyHash;
        vrfSubscriptionId = _subscriptionId;

        // ── Grid configs ──
        gridConfigs[GRID_SMALL] = GridConfig({
            totalTiles:       20,
            entryFee:         0.001 ether,
            maxPayoutBPS:     MAX_PAYOUT_BPS_NORMAL,
            maxConcurrent:    50,
            minPoolThreshold: 0.01 ether,
            active:           true
        });
        gridConfigs[GRID_MEDIUM] = GridConfig({
            totalTiles:       30,
            entryFee:         0.005 ether,
            maxPayoutBPS:     MAX_PAYOUT_BPS_NORMAL,
            maxConcurrent:    20,
            minPoolThreshold: 0.05 ether,
            active:           true
        });
        gridConfigs[GRID_LARGE] = GridConfig({
            totalTiles:       50,
            entryFee:         0.01 ether,
            maxPayoutBPS:     MAX_PAYOUT_BPS_NORMAL,
            maxConcurrent:    10,
            minPoolThreshold: 0.1 ether,
            active:           true
        });

        // ── Mine counts ──
        // SMALL (5×4 = 20 tiles)
        mineCounts[GRID_SMALL][DIFF_EASY]   = 4;
        mineCounts[GRID_SMALL][DIFF_NORMAL] = 5;
        mineCounts[GRID_SMALL][DIFF_HARD]   = 6;
        // MEDIUM (5×6 = 30 tiles)
        mineCounts[GRID_MEDIUM][DIFF_EASY]   = 5;
        mineCounts[GRID_MEDIUM][DIFF_NORMAL] = 7;
        mineCounts[GRID_MEDIUM][DIFF_HARD]   = 10;
        // LARGE (5×10 = 50 tiles)
        mineCounts[GRID_LARGE][DIFF_EASY]   = 8;
        mineCounts[GRID_LARGE][DIFF_NORMAL] = 11;
        mineCounts[GRID_LARGE][DIFF_HARD]   = 15;
    }

    // ─────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────

    modifier onlyPlayerOrSession(uint256 gameId) {
        Game storage g = games[gameId];
        require(
            msg.sender == g.player ||
            (g.sessionKey != address(0) && msg.sender == g.sessionKey),
            "Not authorised"
        );
        _;
    }

    // ─────────────────────────────────────────────
    // Core Game Functions
    // ─────────────────────────────────────────────

    /**
     * @notice Start a new game. Player sends exactly the entry fee.
     *         The board is shown immediately but mines are not yet placed.
     *         The player must call firstFlip() to choose their opening tile
     *         and trigger the VRF randomness request.
     * @param gridSize   0 = 5×4, 1 = 5×7, 2 = 5×11
     * @param difficulty 0 = Easy, 1 = Normal, 2 = Hard
     * @param sessionKey Address authorised to flip tiles on player's behalf (0x0 = none)
     */
    function startGame(
        uint8   gridSize,
        uint8   difficulty,
        address sessionKey
    ) external payable nonReentrant returns (uint256 gameId) {
        GridConfig storage cfg = gridConfigs[gridSize];
        require(cfg.active, "Grid not active");
        require(difficulty <= DIFF_HARD, "Invalid difficulty");
        require(msg.value == cfg.entryFee, "Wrong entry fee");
        require(playerActiveGame[msg.sender] == 0, "Active game exists");
        require(activeGameCount[gridSize] < cfg.maxConcurrent, "Grid at capacity");

        // Pool availability check (payout by difficulty)
        uint16 payoutBPS = difficulty == DIFF_EASY ? MAX_PAYOUT_BPS_EASY
            : (difficulty == DIFF_NORMAL ? MAX_PAYOUT_BPS_NORMAL : MAX_PAYOUT_BPS_HARD);
        uint256 maxPayout = (cfg.entryFee * payoutBPS) / BPS_DENOMINATOR;
        uint256 fee = (cfg.entryFee * platformFeeBPS) / BPS_DENOMINATOR;
        uint256 netBet = cfg.entryFee - fee;
        // Risk drawn from pool = maxPayout - netBet
        uint256 poolRisk = maxPayout > netBet ? maxPayout - netBet : 0;

        require(poolBalance >= poolRisk, "Insufficient pool");
        require(poolBalance >= cfg.minPoolThreshold, "Pool below threshold");

        // Accounting
        feeBalance  += fee;
        poolBalance -= poolRisk;
        poolBalance += netBet;
        poolBalance -= netBet;
        reservedBalance += maxPayout;

        activeGameCount[gridSize]++;

        // Determine mine count & safe tile count
        uint8 mineCount  = mineCounts[gridSize][difficulty];
        uint8 totalTiles = cfg.totalTiles;
        uint8 totalSafe  = totalTiles - mineCount;

        // Create game record – mines not yet placed; VRF not yet requested
        gameId = nextGameId++;
        games[gameId] = Game({
            player:           msg.sender,
            sessionKey:       sessionKey,
            gridSize:         gridSize,
            difficulty:       difficulty,
            entryFee:         cfg.entryFee,
            maxPayout:        maxPayout,
            safeTileIndex:    0,
            mineBitmask:      0,
            revealedBitmask:  0,
            safeRevealed:     0,
            totalSafe:        totalSafe,
            status:           GameStatus.WAITING_FIRST_FLIP,
            vrfRequestId:     0,
            startBlock:       block.number,
            startedAt:        block.timestamp,
            endedAt:          0
        });

        playerActiveGame[msg.sender] = gameId;

        emit GameStarted(
            gameId,
            msg.sender,
            sessionKey,
            gridSize,
            difficulty,
            cfg.entryFee,
            maxPayout
        );
    }

    /**
     * @notice Player (or session key) chooses their first tile.
     *         This triggers the VRF randomness request and guarantees the
     *         chosen tile will never be a mine.
     *
     *         After VRF fulfils the game transitions to ACTIVE and the chosen
     *         tile is automatically revealed as safe (safeRevealed = 1).
     *
     * @param gameId    The game to play
     * @param tileIndex The tile the player wants to reveal first (0-based)
     */
    function firstFlip(uint256 gameId, uint8 tileIndex)
        external
        nonReentrant
        onlyPlayerOrSession(gameId)
    {
        Game storage g = games[gameId];
        require(g.status == GameStatus.WAITING_FIRST_FLIP, "Not waiting for first flip");
        require(tileIndex < gridConfigs[g.gridSize].totalTiles, "Tile out of range");

        g.safeTileIndex = tileIndex;
        g.status        = GameStatus.WAITING_VRF;

        // Request randomness via VRF v2.5
        uint256 reqId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash:              vrfKeyHash,
                subId:                vrfSubscriptionId,
                requestConfirmations: vrfRequestConfirmations,
                callbackGasLimit:     vrfCallbackGasLimit,
                numWords:             1,
                extraArgs:            VRFV2PlusClient._argsToBytes(
                                          VRFV2PlusClient.ExtraArgsV1({ nativePayment: false })
                                      )
            })
        );
        g.vrfRequestId     = reqId;
        vrfRequestToGame[reqId] = gameId;

        emit FirstFlipMade(gameId, tileIndex, reqId);
    }

    /**
     * @notice Reveal a tile. Callable by the player or their session key.
     *         Reverts if VRF hasn't returned yet or game is not ACTIVE.
     * @param gameId     The game to play
     * @param tileIndex  0-based tile index (must be < totalTiles)
     */
    function flipTile(uint256 gameId, uint8 tileIndex)
        external
        nonReentrant
        onlyPlayerOrSession(gameId)
    {
        Game storage g = games[gameId];
        require(g.status == GameStatus.ACTIVE, "Game not active");
        require(tileIndex < gridConfigs[g.gridSize].totalTiles, "Tile out of range");
        require((g.revealedBitmask >> tileIndex) & 1 == 0, "Tile already revealed");

        bool isMine = (g.mineBitmask >> tileIndex) & 1 == 1;

        if (isMine) {
            _endGame(gameId, tileIndex, GameStatus.GAME_OVER);
        } else {
            g.revealedBitmask |= uint64(1) << tileIndex;
            g.safeRevealed++;

            uint256 currentPayout = _calculatePayout(g);

            emit TileRevealed(
                gameId,
                msg.sender,
                tileIndex,
                false,
                g.safeRevealed,
                currentPayout
            );

            // Auto-cashout if all safe tiles cleared
            if (g.safeRevealed == g.totalSafe) {
                _cashOut(gameId, g.player);
            }
        }
    }

    /**
     * @notice Cash out current winnings. Callable by player or session key.
     * @param gameId The active game to cash out
     */
    function cashOut(uint256 gameId)
        external
        nonReentrant
        onlyPlayerOrSession(gameId)
    {
        Game storage g = games[gameId];
        require(g.status == GameStatus.ACTIVE, "Game not active");
        require(g.safeRevealed > 0, "No tiles revealed");
        _cashOut(gameId, g.player);
    }

    // ─────────────────────────────────────────────
    // Internal Game Logic
    // ─────────────────────────────────────────────

    function _cashOut(uint256 gameId, address player) internal {
        Game storage g = games[gameId];
        uint256 payout = _calculatePayout(g);

        g.status  = GameStatus.CASHED_OUT;
        g.endedAt = block.timestamp;

        _releaseGame(gameId, g.gridSize, g.maxPayout, payout, player);

        emit GameCashedOut(gameId, player, payout, g.safeRevealed, g.totalSafe);
    }

    function _endGame(uint256 gameId, uint8 mineTile, GameStatus status) internal {
        Game storage g = games[gameId];
        g.status  = status;
        g.endedAt = block.timestamp;

        g.revealedBitmask |= uint64(1) << mineTile;

        _releaseGame(gameId, g.gridSize, g.maxPayout, 0, g.player);

        emit TileRevealed(gameId, msg.sender, mineTile, true, g.safeRevealed, 0);
        emit GameOver(gameId, g.player, mineTile, g.mineBitmask);
    }

    function _releaseGame(
        uint256, // gameId – unused, kept for event logging clarity
        uint8   gridSize,
        uint256 maxPayout,
        uint256 payout,
        address player
    ) internal {
        reservedBalance -= maxPayout;
        poolBalance     += (maxPayout - payout);

        activeGameCount[gridSize]--;
        playerActiveGame[player] = 0;

        if (payout > 0) {
            (bool ok, ) = player.call{value: payout}("");
            require(ok, "ETH transfer failed");
        }
    }

    function _calculatePayout(Game storage g) internal view returns (uint256) {
        if (g.safeRevealed == 0) return 0;
        return (g.maxPayout * g.safeRevealed) / g.totalSafe;
    }

    // ─────────────────────────────────────────────
    // Chainlink VRF v2.5 Callback
    // ─────────────────────────────────────────────

    /**
     * @dev Called by the VRF coordinator after firstFlip() requests randomness.
     *      Places mines on every tile except the player's chosen safe tile,
     *      then auto-reveals that tile so the player starts with safeRevealed = 1.
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override {
        uint256 gameId = vrfRequestToGame[requestId];
        require(gameId != 0, "Unknown request");

        Game storage g = games[gameId];
        require(g.status == GameStatus.WAITING_VRF, "Not waiting for VRF");

        uint8 gridSize   = g.gridSize;
        uint8 totalTiles = gridConfigs[gridSize].totalTiles;
        uint8 mineCount  = mineCounts[gridSize][g.difficulty];

        // Place mines, guaranteeing the player's first tile is safe
        g.mineBitmask = _generateMines(randomWords[0], totalTiles, mineCount, g.safeTileIndex);

        // Auto-reveal the first (guaranteed safe) tile
        g.revealedBitmask = uint64(1) << g.safeTileIndex;
        g.safeRevealed    = 1;
        g.status          = GameStatus.ACTIVE;

        uint256 currentPayout = _calculatePayout(g);
        // address(0) as caller signals this reveal was done by the VRF callback
        emit TileRevealed(gameId, address(0), g.safeTileIndex, false, 1, currentPayout);
    }

    /**
     * @dev Mine placement with safe-tile exclusion via partial Fisher-Yates shuffle.
     *      Builds an index pool of all tiles except `safeTile`, then selects
     *      `mineCount` positions from that pool.
     *
     * @param seed       Random seed from Chainlink VRF
     * @param totalTiles Total number of tiles on this grid
     * @param mineCount  Number of mines to place
     * @param safeTile   Tile index that must NOT be a mine
     */
    function _generateMines(
        uint256 seed,
        uint8   totalTiles,
        uint8   mineCount,
        uint8   safeTile
    ) internal pure returns (uint64 mineBitmask) {
        // Build array of every tile index except safeTile
        uint8 available = totalTiles - 1;
        uint8[] memory tiles = new uint8[](available);
        uint8 idx = 0;
        for (uint8 i = 0; i < totalTiles; i++) {
            if (i != safeTile) {
                tiles[idx] = i;
                idx++;
            }
        }

        // Partial Fisher-Yates: select mineCount positions
        for (uint8 i = 0; i < mineCount; i++) {
            uint8 remaining = available - i;
            uint8 j = i + uint8(
                uint256(keccak256(abi.encode(seed, i))) % remaining
            );
            uint8 tmp = tiles[i];
            tiles[i]  = tiles[j];
            tiles[j]  = tmp;
        }

        // Set bits for mine positions
        for (uint8 i = 0; i < mineCount; i++) {
            mineBitmask |= uint64(1) << tiles[i];
        }
    }

    // ─────────────────────────────────────────────
    // View Helpers
    // ─────────────────────────────────────────────

    function getCurrentPayout(uint256 gameId) external view returns (uint256) {
        return _calculatePayout(games[gameId]);
    }

    function isGridAvailable(uint8 gridSize, uint8 difficulty) external view returns (bool) {
        GridConfig storage cfg = gridConfigs[gridSize];
        if (!cfg.active) return false;
        if (activeGameCount[gridSize] >= cfg.maxConcurrent) return false;

        uint16 payoutBPS  = difficulty == DIFF_EASY ? MAX_PAYOUT_BPS_EASY
            : (difficulty == DIFF_NORMAL ? MAX_PAYOUT_BPS_NORMAL : MAX_PAYOUT_BPS_HARD);
        uint256 maxPayout = (cfg.entryFee * payoutBPS) / BPS_DENOMINATOR;
        uint256 fee       = (cfg.entryFee * platformFeeBPS) / BPS_DENOMINATOR;
        uint256 netBet    = cfg.entryFee - fee;
        uint256 poolRisk  = maxPayout > netBet ? maxPayout - netBet : 0;

        if (poolBalance < poolRisk) return false;
        if (poolBalance < cfg.minPoolThreshold) return false;
        return true;
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            address  player,
            address  sessionKey,
            uint8    gridSize,
            uint8    difficulty,
            uint256  entryFee,
            uint256  maxPayout,
            uint64   mineBitmask,
            uint64   revealedBitmask,
            uint8    safeRevealed,
            uint8    totalSafe,
            GameStatus status,
            uint256  startBlock,
            uint256  startedAt,
            uint256  endedAt
        )
    {
        Game storage g = games[gameId];
        return (
            g.player,
            g.sessionKey,
            g.gridSize,
            g.difficulty,
            g.entryFee,
            g.maxPayout,
            g.mineBitmask,
            g.revealedBitmask,
            g.safeRevealed,
            g.totalSafe,
            g.status,
            g.startBlock,
            g.startedAt,
            g.endedAt
        );
    }

    function getPoolHealth()
        external
        view
        returns (
            uint256 pool,
            uint256 reserved,
            uint256 fees,
            uint256 contractBalance
        )
    {
        return (
            poolBalance,
            reservedBalance,
            feeBalance,
            address(this).balance
        );
    }

    // ─────────────────────────────────────────────
    // Admin — Config
    // ─────────────────────────────────────────────

    function setGameConfig(
        uint8   gridSize,
        uint256 entryFeeWei,
        uint16  maxPayoutBPS
    ) external onlyOwner {
        require(maxPayoutBPS <= 20000, "Payout too high");
        gridConfigs[gridSize].entryFee    = entryFeeWei;
        gridConfigs[gridSize].maxPayoutBPS = maxPayoutBPS;
    }

    function setGridActive(uint8 gridSize, bool active) external onlyOwner {
        gridConfigs[gridSize].active = active;
    }

    function setMineCount(
        uint8 gridSize,
        uint8 difficulty,
        uint8 mineCount
    ) external onlyOwner {
        uint8 totalTiles = gridConfigs[gridSize].totalTiles;
        require(mineCount > 0 && mineCount < totalTiles, "Invalid mine count");
        mineCounts[gridSize][difficulty] = mineCount;
    }

    function setPlatformFee(uint16 feeBPS) external onlyOwner {
        require(feeBPS <= 1000, "Fee too high");
        platformFeeBPS = feeBPS;
    }

    function setMaxConcurrentGames(uint8 gridSize, uint32 max) external onlyOwner {
        gridConfigs[gridSize].maxConcurrent = max;
    }

    function setMinPoolThreshold(uint8 gridSize, uint256 amount) external onlyOwner {
        gridConfigs[gridSize].minPoolThreshold = amount;
    }

    function setVRFConfig(
        bytes32 keyHash,
        uint256 subscriptionId,
        uint32  callbackGasLimit
    ) external onlyOwner {
        vrfKeyHash          = keyHash;
        vrfSubscriptionId   = subscriptionId;
        vrfCallbackGasLimit = callbackGasLimit;
        emit VRFConfigUpdated(keyHash, subscriptionId, callbackGasLimit);
    }

    // ─────────────────────────────────────────────
    // Admin — Pool & Fees
    // ─────────────────────────────────────────────

    function depositPool() external payable {
        require(msg.value > 0, "Zero deposit");
        poolBalance += msg.value;
        emit PoolDeposited(msg.sender, msg.value);
    }

    function withdrawFees() external onlyOwner nonReentrant {
        uint256 amount = feeBalance;
        require(amount > 0, "No fees");
        feeBalance = 0;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Transfer failed");
        emit FeeWithdrawn(owner(), amount);
    }

    function withdrawPoolProfits(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Zero amount");
        uint256 safeFloor = _safeReserveFloor();
        require(
            poolBalance >= amount + safeFloor,
            "Would breach safe floor"
        );
        poolBalance -= amount;
        (bool ok, ) = owner().call{value: amount}("");
        require(ok, "Transfer failed");
        emit ProfitWithdrawn(owner(), amount);
    }

    function _safeReserveFloor() internal view returns (uint256 floor) {
        uint8[3] memory grids = [GRID_SMALL, GRID_MEDIUM, GRID_LARGE];
        for (uint256 i = 0; i < grids.length; i++) {
            GridConfig storage cfg = gridConfigs[grids[i]];
            uint256 worstPayout = (cfg.entryFee * MAX_PAYOUT_BPS_HARD) / BPS_DENOMINATOR;
            floor += worstPayout * cfg.maxConcurrent;
        }
    }

    function safeReserveFloor() external view returns (uint256) {
        return _safeReserveFloor();
    }

    // ─────────────────────────────────────────────
    // Session Key Management
    // ─────────────────────────────────────────────

    function setSessionKey(uint256 gameId, address newSessionKey)
        external
    {
        Game storage g = games[gameId];
        require(msg.sender == g.player, "Not player");
        require(
            g.status == GameStatus.WAITING_FIRST_FLIP ||
            g.status == GameStatus.WAITING_VRF ||
            g.status == GameStatus.ACTIVE,
            "Game ended"
        );
        g.sessionKey = newSessionKey;
        emit SessionKeySet(gameId, newSessionKey);
    }

    // ─────────────────────────────────────────────
    // Emergency
    // ─────────────────────────────────────────────

    /**
     * @notice Cancel a stuck game (player never made first flip, or VRF never
     *         returned) after block-based thresholds. Refunds the net bet; fee is non-refundable.
     *         WAITING_FIRST_FLIP: cancellable after 100 blocks (~3.3 min on Base).
     *         WAITING_VRF: cancellable after 43200 blocks (~24h on Base).
     */
    function cancelStuckGame(uint256 gameId) external nonReentrant {
        Game storage g = games[gameId];
        require(
            g.status == GameStatus.WAITING_FIRST_FLIP ||
            g.status == GameStatus.WAITING_VRF,
            "Not cancellable"
        );
        uint256 requiredBlocks = g.status == GameStatus.WAITING_FIRST_FLIP
            ? CANCEL_BLOCKS_WAITING_FIRST_FLIP
            : CANCEL_BLOCKS_WAITING_VRF;
        require(
            block.number > g.startBlock + requiredBlocks,
            "Cancel available after block threshold"
        );
        require(msg.sender == g.player || msg.sender == owner(), "Not authorised");

        g.status  = GameStatus.CANCELLED;
        g.endedAt = block.timestamp;

        uint256 refund = g.maxPayout;
        reservedBalance -= refund;
        poolBalance     += refund;

        uint256 netBet = g.entryFee - (g.entryFee * platformFeeBPS / BPS_DENOMINATOR);

        activeGameCount[g.gridSize]--;
        playerActiveGame[g.player] = 0;

        if (netBet > 0 && poolBalance >= netBet) {
            poolBalance -= netBet;
            (bool ok, ) = g.player.call{value: netBet}("");
            require(ok, "Refund failed");
        }
    }

    // Accept direct ETH deposits (treated as pool contribution)
    receive() external payable {
        poolBalance += msg.value;
        emit PoolDeposited(msg.sender, msg.value);
    }
}
