import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BaseLogo } from "./BaseLogo";
import { usePoolHealth, useGridAvailable, useMinPoolThresholds } from "@/hooks/usePoolHealth";
import { formatEth, GRID_SMALL, GRID_MEDIUM, GRID_LARGE, DIFF_NORMAL } from "@/lib/config";
import { useGridConfigs } from "@/hooks/useGridConfigs";

export function LandingHero() {
  const { pool, isLoading } = usePoolHealth();
  const { gridInfo } = useGridConfigs();
  const availableSmall  = useGridAvailable(GRID_SMALL, DIFF_NORMAL);
  const availableMedium = useGridAvailable(GRID_MEDIUM, DIFF_NORMAL);
  const availableLarge  = useGridAvailable(GRID_LARGE, DIFF_NORMAL);
  const minPoolThresholds = useMinPoolThresholds();

  const availability = {
    [GRID_SMALL]:  availableSmall,
    [GRID_MEDIUM]: availableMedium,
    [GRID_LARGE]:  availableLarge,
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
      {/* Logo */}
      <div className="mb-8 animate-bounce-in">
        <div className="w-20 h-20 bg-base-blue rounded-full flex items-center justify-center mx-auto mb-4 shadow-cashout">
          <BaseLogo size={44} />
        </div>
        <h1 className="text-4xl font-bold text-[#111111]">Base Minesweeper</h1>
        <p className="text-gray-600 mt-2 text-lg">
          Onchain wagering · Provably fair · Base Chain
        </p>
      </div>

      {/* Feature bullets */}
      <div className="grid grid-cols-1 gap-3 mb-8 w-full max-w-xs">
        {[
          { image: "/hero/Base-Bolt.png", text: "Instant payouts via smart contract" },
          { image: "/hero/Base-Link.png", text: "Chainlink VRF randomness" },
          { image: "/hero/Base-Money.png", text: "Cash out any time — no gas popup" },
          { image: "/hero/Base-Stack.png", text: "Up to 1.9× your entry fee (by difficulty)" },
        ].map(({ image, text }) => (
          <div key={text} className="flex items-center gap-3 text-left px-4 py-3 bg-gray-50 rounded-[4px]">
            <img src={image} alt="" className="w-6 h-6 shrink-0 object-contain" />
            <span className="text-gray-700 text-sm">{text}</span>
          </div>
        ))}
      </div>

      {/* Pool status per grid — same source of truth as New Game (contract isGridAvailable), works without wallet via chainId */}
      <div className="w-full max-w-xs mb-8">
        <div className="text-xs text-gray-500 uppercase tracking-widest mb-2">Pool Balance</div>
        <div className="space-y-1.5">
          {([GRID_SMALL, GRID_MEDIUM, GRID_LARGE] as const).map(g => {
            const info       = gridInfo?.[g];
            const hasFunds   = availability[g];
            const requiredEth = formatEth(minPoolThresholds[g] ?? 0n, 4);
            if (!info) return null;
            return (
              <div key={g} className="flex flex-col gap-1 px-3 py-2 bg-gray-50 rounded-[4px]">
                <div className="flex items-center justify-between">
                  <span className="text-gray-700 text-sm">{info.label} ({info.entryLabel})</span>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${hasFunds ? "bg-accent-green" : "bg-mine"}`} />
                    <span className={`text-xs font-mono ${hasFunds ? "text-accent-green" : "text-mine"}`}>
                      {isLoading ? "…" : hasFunds ? "Available" : "Pool insufficient"}
                    </span>
                  </div>
                </div>
                {!hasFunds && !isLoading && (
                  <p className="text-xs text-amber-600">
                    needs {requiredEth} ETH in pool
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-right text-xs font-mono text-gray-500">
          Pool: {isLoading ? "…" : formatEth(pool, 4)} ETH
        </div>
      </div>

      {/* CTA */}
      <div className="space-y-3">
        <p className="text-gray-500 text-sm mb-1">Connect your wallet to play</p>
        <ConnectButton />
      </div>
    </div>
  );
}
