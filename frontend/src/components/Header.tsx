import { ConnectButton } from "@rainbow-me/rainbowkit";
import { BaseLogo } from "./BaseLogo";

export function Header() {
  return (
    <header className="w-full px-4 py-3 flex items-center justify-between border-b border-gray-200">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 bg-base-blue rounded-full flex items-center justify-center">
          <BaseLogo size={18} />
        </div>
        <div>
          <div className="text-[#111111] font-bold leading-none text-sm">Base Minesweeper</div>
          <div className="text-gray-500 text-xs leading-none mt-0.5">Onchain · Provably Fair</div>
        </div>
      </div>
      <ConnectButton
        showBalance={false}
        chainStatus="icon"
        accountStatus="avatar"
      />
    </header>
  );
}
