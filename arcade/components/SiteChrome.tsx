import Link from "next/link";
import { getContractConfig, MONAD_EXPLORER_ORIGIN } from "@/lib/env";
import { WalletPanel } from "./WalletPanel";

const NAV = [
  { href: "/games/tetris-amey", label: "Play Tetris" },
  { href: "/reconstruct", label: "Upload game" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__brand">
        <Link className="wordmark" href="/">
          <span className="wordmark__case">Arcade</span>
          HexBounty
        </Link>
        <p className="site-header__tag">Reconstruction marketplace · Monad Testnet</p>
      </div>
      <nav className="site-nav" aria-label="Primary">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="site-header__wallet">
        <WalletPanel />
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        Wallet connection plus a signature authenticates blockchain actions. There is no email
        account. Monad Testnet only. Differential evaluation produces behavioral evidence — not
        formal verification.
      </p>
      <p>
        Explorer:{" "}
        <a href={MONAD_EXPLORER_ORIGIN} rel="noreferrer" target="_blank">
          testnet.monadexplorer.com
        </a>
      </p>
    </footer>
  );
}

export function DemoPreviewBanner() {
  const contract = getContractConfig();
  if (contract.status !== "demo-preview") return null;
  return (
    <aside className="banner" role="status" aria-live="polite">
      {contract.reason}
    </aside>
  );
}
