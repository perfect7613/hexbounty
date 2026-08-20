import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { hexBountyMonad } from "./chain";
import { getRpcUrl } from "./env";
import { FEATURED_GAME_SLUG } from "./games";
import { hexBountyPaidPlayAbi, hexBountyPaidPlayAddress, slugHash } from "./paid-play";

const SLUG_PATH = /^\/api\/games\/([a-z0-9]+(?:-[a-z0-9]+)*)\/metadata$/;
const GAME_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLATFORM_FEE_BPS = 250n;
const BPS_DENOMINATOR = 10_000n;

export type PublishedGame = {
  slugHash: Hex;
  creator: Address;
  metadataURI: string;
};

export type PaidUnlock = {
  slugHash: Hex;
  creator: Address;
  creatorEarnings: bigint;
};

export type CreatorRank = {
  creator: Address;
  games: Array<{ slugHash: Hex; slug: string | null }>;
  paidUnlocks: number;
  earnings: bigint;
};

export type PublicationSnapshot = PublishedGame & {
  playPrice: bigint;
  purchaseCount: bigint;
};

export function gameSlugFromMetadataURI(metadataURI: string): string | null {
  try {
    const url = new URL(metadataURI, "https://hexbounty.invalid");
    return url.pathname.match(SLUG_PATH)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function buildCreatorLeaderboard(
  publications: PublishedGame[],
  purchases: PaidUnlock[],
): CreatorRank[] {
  const creators = new Map<string, CreatorRank>();
  const seenGames = new Set<string>();

  for (const publication of publications) {
    const creator = getAddress(publication.creator);
    const key = creator.toLowerCase();
    const gameKey = publication.slugHash.toLowerCase();
    if (seenGames.has(gameKey)) continue;
    seenGames.add(gameKey);
    const rank = creators.get(key) ?? { creator, games: [], paidUnlocks: 0, earnings: 0n };
    rank.games.push({
      slugHash: publication.slugHash,
      slug: gameSlugFromMetadataURI(publication.metadataURI),
    });
    creators.set(key, rank);
  }

  for (const purchase of purchases) {
    const creator = getAddress(purchase.creator);
    const key = creator.toLowerCase();
    const rank = creators.get(key) ?? { creator, games: [], paidUnlocks: 0, earnings: 0n };
    rank.paidUnlocks += 1;
    rank.earnings += purchase.creatorEarnings;
    creators.set(key, rank);
  }

  return [...creators.values()].sort(
    (left, right) =>
      right.paidUnlocks - left.paidUnlocks ||
      right.games.length - left.games.length ||
      left.creator.localeCompare(right.creator),
  );
}

export function leaderboardSlugs(env: NodeJS.Dict<string> = process.env): string[] {
  const configured = (env.HEXBOUNTY_LEADERBOARD_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => GAME_SLUG.test(slug));
  return [...new Set([FEATURED_GAME_SLUG, ...configured])];
}

export function buildCreatorLeaderboardFromSnapshots(
  publications: PublicationSnapshot[],
): CreatorRank[] {
  const creators = new Map<string, CreatorRank>();
  const seenGames = new Set<string>();

  for (const publication of publications) {
    const gameKey = publication.slugHash.toLowerCase();
    if (seenGames.has(gameKey)) continue;
    seenGames.add(gameKey);

    const creator = getAddress(publication.creator);
    const key = creator.toLowerCase();
    const rank = creators.get(key) ?? { creator, games: [], paidUnlocks: 0, earnings: 0n };
    const paidUnlocks = Number(publication.purchaseCount);
    if (!Number.isSafeInteger(paidUnlocks)) throw new Error("Purchase count exceeds safe range");
    const platformFee = (publication.playPrice * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;

    rank.games.push({
      slugHash: publication.slugHash,
      slug: gameSlugFromMetadataURI(publication.metadataURI),
    });
    rank.paidUnlocks += paidUnlocks;
    rank.earnings += (publication.playPrice - platformFee) * publication.purchaseCount;
    creators.set(key, rank);
  }

  return [...creators.values()].sort(
    (left, right) =>
      right.paidUnlocks - left.paidUnlocks ||
      right.games.length - left.games.length ||
      left.creator.localeCompare(right.creator),
  );
}

export async function loadCreatorLeaderboard(): Promise<CreatorRank[]> {
  if (!hexBountyPaidPlayAddress) return [];
  const paidPlayAddress = hexBountyPaidPlayAddress;

  const client = createPublicClient({
    chain: hexBountyMonad,
    transport: http(getRpcUrl()),
  });
  const publications = await Promise.all(
    leaderboardSlugs().map(async (slug): Promise<PublicationSnapshot | null> => {
      try {
        const publication = await client.readContract({
          address: paidPlayAddress,
          abi: hexBountyPaidPlayAbi,
          functionName: "getPublication",
          args: [slugHash(slug)],
        });
        return {
          slugHash: slugHash(slug),
          creator: getAddress(publication.creator),
          metadataURI: publication.metadataURI,
          playPrice: publication.playPrice,
          purchaseCount: publication.purchaseCount,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/PublicationNotFound|0x0f750ab3/i.test(message)) return null;
        throw error;
      }
    }),
  );

  return buildCreatorLeaderboardFromSnapshots(
    publications.filter((publication): publication is PublicationSnapshot => publication !== null),
  );
}
