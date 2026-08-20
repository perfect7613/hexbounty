import type { Metadata } from "next";
import { GameUploadForm } from "@/components/GameUploadForm";

export const metadata: Metadata = {
  title: "Upload game",
  description:
    "Pay for reconstruction and upload one Game Boy ROM in a single flow on Monad.",
};

export default function ReconstructPage() {
  return (
    <div className="page page--narrow reconstruct-page">
      <header className="page-head">
        <p className="kicker">Upload game</p>
        <h1>Upload a game</h1>
        <p>
          Connect MetaMask on Monad Testnet and sign in. The temporary upload is deleted after the
          reconstruction service accepts it. Processing begins only after your reconstruction
          payment is confirmed on-chain.
        </p>
        <ol className="workflow-steps">
          <li>
            <strong>Pay and upload</strong>
            Confirm the MON reward, then send one Game Boy ROM. The file is deleted after handoff.
          </li>
          <li>
            <strong>Reconstruct</strong>
            Automated binary analysis rebuilds the game after the upload is accepted.
          </li>
          <li>
            <strong>Accept</strong>
            Review the result and accept it to release the reconstruction reward.
          </li>
          <li>
            <strong>Publish</strong>
            Set a play price and publish the listing onchain.
          </li>
          <li>
            <strong>Play & earn</strong>
            Friends pay that price to play; the creator earns from each unlock.
          </li>
        </ol>
      </header>
      <GameUploadForm />
    </div>
  );
}
