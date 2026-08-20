import Link from "next/link";
import { HeroMedia } from "@/components/HeroMedia";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FEATURED_GAME_HREF } from "@/lib/games";

export default function HomePage() {
  return (
    <div className="page-home">
      <section className="hero-stage">
        <HeroMedia />
        <div className="hero">
          <p className="hero__index">HEXBOUNTY · MONAD TESTNET · 10143</p>
          <h1>
            Upload a game.
            <em>Friends pay to play after it is reconstructed.</em>
          </h1>
          <p className="hero__lede">
            Upload privately and confirm one reconstruction payment. Automated analysis rebuilds
            the game, then you publish a price so friends can pay and play.
          </p>
          <div className="hero__actions">
            <Button asChild size="lg">
              <Link href={FEATURED_GAME_HREF}>Play Tetris</Link>
            </Button>
            <Button asChild size="lg">
              <Link href="/reconstruct">Upload a game</Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="home-grid">
        <ol className="beats">
          <li>
            <span>01</span>
            <h2>Upload</h2>
            <p>Send a private Game Boy ROM. The file stays off the public page.</p>
          </li>
          <li>
            <span>02</span>
            <h2>Reconstruct</h2>
            <p>Reconstruction and analysis run after the upload. Watch the game page for status.</p>
          </li>
          <li>
            <span>03</span>
            <h2>Pay</h2>
            <p>Confirm the reconstruction reward in MetaMask as part of the upload.</p>
          </li>
          <li>
            <span>04</span>
            <h2>Accept</h2>
            <p>A sponsor accepts a submission. Then you can publish a price on the contract.</p>
          </li>
          <li>
            <span>05</span>
            <h2>Play</h2>
            <p>Friends pay the listed price and play the reconstructed game.</p>
          </li>
        </ol>

        <Card className="hero-card">
          <CardHeader className="p-0">
            <p className="kicker">Recent reconstruction</p>
            <CardTitle className="text-[1.45rem] tracking-tight">Tetris</CardTitle>
            <CardDescription>
              Open the latest creator listing, check its reconstruction details, and unlock play
              with the listed MON price.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 pt-4">
            <dl className="kv">
              <div>
                <dt>Access</dt>
                <dd>Paid play onchain</dd>
              </div>
              <div>
                <dt>Identity</dt>
                <dd>MetaMask only</dd>
              </div>
              <div>
                <dt>Chain</dt>
                <dd>Monad Testnet · 10143</dd>
              </div>
            </dl>
            <p>
              <Link className="text-link" href={FEATURED_GAME_HREF}>
                Open Tetris →
              </Link>
            </p>
            <p className="note">Game analysis is available from the listing page.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
