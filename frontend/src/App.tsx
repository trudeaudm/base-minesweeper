import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Header } from "@/components/Header";
import { LandingHero } from "@/components/LandingHero";
import { GameSelect } from "@/components/GameSelect";
import { GameBoard } from "@/components/GameBoard";
import { GameStatusBar } from "@/components/GameStatus";
import { LoadingTileGrid } from "@/components/LoadingTileGrid";
import { WinScreen } from "@/components/WinScreen";
import { GameOverScreen } from "@/components/GameOverScreen";
import { useGame } from "@/hooks/useGame";
import { usePoolHealth } from "@/hooks/usePoolHealth";
import { GameStatus } from "@/lib/config";

type AppView = "select" | "playing";

function GameApp() {
  const {
    gameState,
    isGameDataReady,
    isStarting,
    isCashingOut,
    isCancelling,
    error,
    cancelBlockDataReady,
    blocksUntilCancel,
    canCancel,
    cancelThresholdBlocks,
    pendingTilesRef,
    isFlipPending,
    burstRevealOrder,
    onBurstRevealComplete,
    mineHitTileIndex,
    onExplosionComplete,
    explosionComplete,
    startGame,
    flipTile,
    cashOut,
    cancelGame,
    resetGame,
  } = useGame();
  const { pool } = usePoolHealth();

  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);
  const [boardFadeComplete, setBoardFadeComplete] = useState(false);
  const [showFirstClickHint, setShowFirstClickHint] = useState(false);
  const [hintFadeIn, setHintFadeIn] = useState(false);

  // When real board data becomes ready, crossfade from loading grid to board over 300ms
  useEffect(() => {
    if (!isGameDataReady) {
      setBoardFadeComplete(false);
      return;
    }
    const id = setTimeout(() => setBoardFadeComplete(true), 300);
    return () => clearTimeout(id);
  }, [isGameDataReady]);

  // 5s delay then show "Click any tile to begin" hint; reset when leaving WAITING_FIRST_FLIP
  useEffect(() => {
    if (!gameState.isWaitingFirstFlip) {
      setShowFirstClickHint(false);
      setHintFadeIn(false);
      return;
    }
    const t = setTimeout(() => setShowFirstClickHint(true), 5000);
    return () => clearTimeout(t);
  }, [gameState.isWaitingFirstFlip]);

  // Fade-in the hint overlay over 600ms when it mounts
  useEffect(() => {
    if (!showFirstClickHint) return;
    const id = requestAnimationFrame(() => setHintFadeIn(true));
    return () => cancelAnimationFrame(id);
  }, [showFirstClickHint]);

  const hasGame = gameState.gameId !== null;
  const view: AppView = hasGame ? "playing" : "select";

  const handleCancelGame = async () => {
    const success = await cancelGame();
    if (success) {
      setCancelledMessage("Game cancelled — your ETH has been refunded");
    }
  };

  const handleFlip = (index: number) => {
    setShowFirstClickHint(false);
    flipTile(index);
  };

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-start pt-6 pb-16 px-4 overflow-y-auto">
        {/* Error banner */}
        {error && (
          <div className="w-full max-w-sm mb-4 px-4 py-3 bg-mine/15 border border-mine/40 rounded-[4px]">
            <p className="text-mine text-sm">{error}</p>
          </div>
        )}

        {view === "select" && (
          <div className="w-full max-w-sm animate-bounce-in">
            {/* Cancelled-game success banner */}
            {cancelledMessage && (
              <div className="mb-4 px-4 py-3 bg-accent-green/10 border border-accent-green/40 rounded-[4px] flex items-start justify-between gap-2">
                <p className="text-accent-green text-sm">{cancelledMessage}</p>
                <button
                  onClick={() => setCancelledMessage(null)}
                  className="text-accent-green/60 hover:text-accent-green text-lg leading-none flex-shrink-0"
                >
                  ×
                </button>
              </div>
            )}
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-[#111111]">New Game</h2>
              <p className="text-gray-500 text-sm mt-1">Choose a grid and difficulty</p>
            </div>
            <GameSelect
              onStart={(g, d) => {
                setCancelledMessage(null);
                startGame(g, d);
              }}
              isStarting={isStarting}
              poolBalance={pool}
            />
          </div>
        )}

        {view === "playing" && (
          <div className="w-full max-w-sm space-y-5">
            {/* Status bar — always when playing (includes cancel during VRF) */}
            <GameStatusBar
              gridSize={gameState.gridSize}
              difficulty={gameState.difficulty}
              entryFee={gameState.entryFee}
              maxPayout={gameState.maxPayout}
              currentPayout={gameState.currentPayout}
              multiplier={gameState.multiplier}
              safeRevealed={gameState.safeRevealed}
              totalSafe={gameState.totalSafe}
              status={gameState.status}
              onCashOut={cashOut}
              isCashingOut={isCashingOut}
              isWaitingFirstFlip={gameState.isWaitingFirstFlip}
              isWaitingVRF={gameState.status === GameStatus.WAITING_VRF}
              cancelBlockDataReady={cancelBlockDataReady}
              blocksUntilCancel={blocksUntilCancel}
              canCancel={canCancel}
              cancelThresholdBlocks={cancelThresholdBlocks}
              onCancelGame={handleCancelGame}
              isCancelling={isCancelling}
            />

            {/* Grid area: LoadingTileGrid only when data not ready; crossfade when ready */}
            {!isGameDataReady ? (
              <div className="w-full max-w-xs mx-auto relative" aria-busy="true">
                <LoadingTileGrid gridSize={gameState.gridSize as 0 | 1 | 2} />
              </div>
            ) : (
              <>
                {/* Crossfade: loading grid fades out (300ms) while real board fades in; same space, no layout shift */}
                <div className="w-full max-w-xs mx-auto relative">
                  <div
                    className={`w-full pointer-events-none transition-opacity duration-300 ${
                      boardFadeComplete ? "opacity-0" : "opacity-100"
                    }`}
                    role="presentation"
                    aria-hidden
                  >
                    <LoadingTileGrid gridSize={gameState.gridSize as 0 | 1 | 2} />
                  </div>
                  <div
                    className={`absolute inset-0 transition-opacity duration-300 ${
                      boardFadeComplete ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                    }`}
                  >
                    <GameBoard
                      gridSize={gameState.gridSize}
                      tileStates={gameState.tileStates}
                      mineBitmask={gameState.mineBitmask}
                      revealedAdjacency={gameState.revealedAdjacency}
                      status={gameState.status}
                      onFlip={handleFlip}
                      isCashout={gameState.safeRevealed > 0 && gameState.isActive}
                      pendingTilesRef={pendingTilesRef}
                      isFlipPending={isFlipPending}
                      burstRevealOrder={burstRevealOrder}
                      onBurstRevealComplete={onBurstRevealComplete}
                      mineHitTileIndex={mineHitTileIndex}
                      onExplosionComplete={onExplosionComplete}
                      explosionComplete={explosionComplete}
                    />
                  </div>

                  {/* Hint overlay: "Click any tile to begin" after 5s in WAITING_FIRST_FLIP; pointer-events-none so tiles stay clickable */}
                  {isGameDataReady &&
                    boardFadeComplete &&
                    gameState.isWaitingFirstFlip &&
                    showFirstClickHint && (
                      <div
                        className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-[600ms] ${
                          hintFadeIn ? "opacity-100" : "opacity-0"
                        }`}
                        aria-hidden
                      >
                        <p
                          className="text-center font-bold text-lg px-4 animate-pulse"
                          style={{ color: "#06D6A0" }}
                        >
                          Click any tile to begin — your first click is always safe!
                        </p>
                      </div>
                    )}
                </div>

                {/* Back to new game — when game is over */}
                {gameState.isGameOver && (
                  <button
                    type="button"
                    onClick={resetGame}
                    className="w-full py-3.5 rounded-[6px] font-bold text-base bg-base-blue text-white hover:bg-blue-500 active:scale-[0.98] transition-colors"
                  >
                    New Game
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* Win overlay */}
      {gameState.isCashedOut && (
        <WinScreen
          payout={gameState.currentPayout > 0n ? gameState.currentPayout : gameState.maxPayout}
          entryFee={gameState.entryFee}
          gridSize={gameState.gridSize}
          difficulty={gameState.difficulty}
          onPlayAgain={resetGame}
        />
      )}

      {/* Game over (RUGGED) overlay */}
      {gameState.isGameOver && !gameState.isCashedOut && (
        <GameOverScreen
          gridSize={gameState.gridSize}
          difficulty={gameState.difficulty}
          onPlayAgain={resetGame}
        />
      )}

    </div>
  );
}

export default function App() {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return (
      <div className="flex flex-col min-h-screen bg-white">
        <Header />
        <LandingHero />
      </div>
    );
  }

  return <GameApp />;
}
