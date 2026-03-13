import { useState } from "react";
import { useAccount } from "wagmi";
import { Header } from "@/components/Header";
import { LandingHero } from "@/components/LandingHero";
import { GameSelect } from "@/components/GameSelect";
import { GameBoard } from "@/components/GameBoard";
import { GameStatusBar } from "@/components/GameStatus";
import { WinScreen } from "@/components/WinScreen";
import { GameOverScreen } from "@/components/GameOverScreen";
import { useGame } from "@/hooks/useGame";
import { usePoolHealth } from "@/hooks/usePoolHealth";
import { GameStatus } from "@/lib/config";

type AppView = "select" | "playing";

function GameApp() {
  const {
    gameState,
    isStarting,
    isCashingOut,
    isCancelling,
    error,
    vrfStartedAt,
    startGame,
    flipTile,
    cashOut,
    cancelGame,
    resetGame,
  } = useGame();
  const { pool } = usePoolHealth();

  const [cancelledMessage, setCancelledMessage] = useState<string | null>(null);

  const hasActiveGame =
    gameState.gameId !== null &&
    (gameState.isWaitingFirstFlip || gameState.isWaitingVRF || gameState.isActive);

  const view: AppView = hasActiveGame ? "playing" : "select";

  const handleCancelGame = async () => {
    const success = await cancelGame();
    if (success) {
      setCancelledMessage("Game cancelled — your ETH has been refunded");
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-black">
      <Header />

      <main className="flex-1 flex flex-col items-center justify-start pt-6 pb-16 px-4 overflow-y-auto">
        {/* Error banner */}
        {error && (
          <div className="w-full max-w-sm mb-4 px-4 py-3 bg-mine/20 border border-mine/40 rounded-lg">
            <p className="text-mine text-sm">{error}</p>
          </div>
        )}

        {view === "select" && (
          <div className="w-full max-w-sm animate-bounce-in">
            {/* Cancelled-game success banner */}
            {cancelledMessage && (
              <div className="mb-4 px-4 py-3 bg-accent-green/10 border border-accent-green/40 rounded-lg flex items-start justify-between gap-2">
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
              <h2 className="text-2xl font-bold text-white">New Game</h2>
              <p className="text-white/50 text-sm mt-1">Choose a grid and difficulty</p>
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
            {/* Status bar */}
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
              isWaitingVRF={gameState.isWaitingVRF}
              vrfStartedAt={vrfStartedAt}
              onCancelGame={handleCancelGame}
              isCancelling={isCancelling}
            />

            {/* Game grid */}
            <GameBoard
              gridSize={gameState.gridSize}
              tileStates={gameState.tileStates}
              mineBitmask={gameState.mineBitmask}
              status={gameState.status}
              onFlip={flipTile}
              isCashout={gameState.safeRevealed > 0 && gameState.isActive}
            />

            {/* Session key indicator */}
            {gameState.sessionKeyAddr && (
              <div className="px-3 py-2 bg-white/5 rounded-lg flex items-center justify-between">
                <span className="text-xs text-white/40">Session key active</span>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-accent-green rounded-full animate-pulse" />
                  <span className="text-xs font-mono text-white/40 truncate max-w-[140px]">
                    {gameState.sessionKeyAddr}
                  </span>
                </div>
              </div>
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

      {/* Game over overlay */}
      {gameState.isGameOver && (
        <GameOverScreen
          entryFee={gameState.entryFee}
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
      <div className="flex flex-col min-h-screen bg-black">
        <Header />
        <LandingHero />
      </div>
    );
  }

  return <GameApp />;
}
