import type { Metadata } from "next";
import Link from "next/link";
import { formatEther } from "viem";
import { loadCreatorLeaderboard } from "@/lib/leaderboard";
import { MONAD_EXPLORER_ORIGIN } from "@/lib/env";

export const metadata: Metadata = {
  title: "Creator leaderboard",
  description: "Rank HexBounty creators by confirmed paid game unlocks on Monad Testnet.",
};
export const revalidate = 30;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default async function LeaderboardPage() {
  let creators = [] as Awaited<ReturnType<typeof loadCreatorLeaderboard>>;
  let unavailable = false;
  try {
    creators = await loadCreatorLeaderboard();
  } catch {
    unavailable = true;
  }

  return (
    <div className="page leaderboard-page">
      <header className="page-head">
        <p className="kicker">Onchain creator rankings</p>
        <h1>Creator leaderboard</h1>
        <p>
          Ranked by confirmed paid unlocks on Monad Testnet. Each unlock is an onchain purchase,
          so refreshes and repeated link clicks do not inflate the score.
        </p>
      </header>

      {unavailable ? (
        <p className="banner" role="status">
          The leaderboard cannot reach Monad Testnet right now. Try again shortly.
        </p>
      ) : creators.length === 0 ? (
        <section className="panel leaderboard-empty">
          <p className="kicker">The first spot is open</p>
          <h2>No paid unlocks yet</h2>
          <p>Upload a game, publish it, and share its link to become the first ranked creator.</p>
          <Link className="text-link" href="/reconstruct">Upload a game →</Link>
        </section>
      ) : (
        <ol className="leaderboard-list">
          {creators.map((entry, index) => (
            <li className="leaderboard-row" key={entry.creator}>
              <span className="leaderboard-rank" aria-label={`Rank ${index + 1}`}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="leaderboard-creator">
                <span className="kicker">Creator</span>
                <a
                  className="mono text-link"
                  href={`${MONAD_EXPLORER_ORIGIN}/address/${entry.creator}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  {shortAddress(entry.creator)}
                </a>
                <div className="leaderboard-games">
                  {entry.games.map((game) =>
                    game.slug ? (
                      <Link key={game.slugHash} href={`/games/${game.slug}`}>{game.slug}</Link>
                    ) : null,
                  )}
                </div>
              </div>
              <dl className="leaderboard-stats">
                <div><dt>Paid unlocks</dt><dd>{entry.paidUnlocks}</dd></div>
                <div><dt>Games</dt><dd>{entry.games.length}</dd></div>
                <div><dt>Creator earnings</dt><dd>{formatEther(entry.earnings)} MON</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
