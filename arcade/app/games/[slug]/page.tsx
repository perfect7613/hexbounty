import type { Metadata } from "next";
import { GamePageClient } from "@/components/GamePageClient";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function GameSharePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  return (
    <div className="page page--narrow game-share-page">
      <GamePageClient slug={slug} />
    </div>
  );
}
