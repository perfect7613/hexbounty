import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChainBountyLoader } from "@/components/BountyViews";

type Params = { id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Reconstruction ${id}` };
}

export default async function BountyDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();

  return (
    <div className="page">
      <ChainBountyLoader id={BigInt(id)} />
    </div>
  );
}
