import "server-only";

import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  getAddress,
  http,
  isAddress,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { hexBountyMonad } from "../chain";
import { getRpcUrl } from "../env";
import { hexBountyPaidPlayAbi, slugHash } from "../paid-play";

export type OnChainLookup<T> = T | "unavailable";

export type ChainPublication = {
  creator: Address;
  playPrice: bigint;
  submissionId: number;
  purchaseCount: number;
  bountyId: bigint;
  gameContentHash: Hex;
  metadataURI: string;
};

export function readPaidPlayAddress(
  env: NodeJS.Dict<string> = process.env,
): Address | null {
  const raw =
    typeof env.NEXT_PUBLIC_HEXBOUNTY_PAID_PLAY === "string"
      ? env.NEXT_PUBLIC_HEXBOUNTY_PAID_PLAY.trim()
      : "";
  if (!raw || !isAddress(raw)) return null;
  const address = getAddress(raw);
  if (address === zeroAddress) return null;
  return address;
}

export function createPaidPlayClient(rpcUrl = getRpcUrl()): PublicClient {
  return createPublicClient({
    chain: hexBountyMonad,
    transport: http(rpcUrl),
  });
}

function isPublicationNotFound(error: unknown): boolean {
  if (error instanceof BaseError) {
    const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName ?? reverted.reason;
      if (name === "PublicationNotFound") return true;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return /PublicationNotFound/i.test(message);
}

export async function readPublication(input: {
  slug: string;
  env?: NodeJS.Dict<string>;
  client?: PublicClient;
}): Promise<OnChainLookup<ChainPublication | null>> {
  const env = input.env ?? process.env;
  const address = readPaidPlayAddress(env);
  if (!address) return "unavailable";
  const client = input.client ?? createPaidPlayClient();
  try {
    const publication = await client.readContract({
      address,
      abi: hexBountyPaidPlayAbi,
      functionName: "getPublication",
      args: [slugHash(input.slug)],
    });
    if (!publication || publication.creator === zeroAddress) return null;
    return {
      creator: getAddress(publication.creator),
      playPrice: publication.playPrice,
      submissionId: Number(publication.submissionId),
      purchaseCount: Number(publication.purchaseCount),
      bountyId: publication.bountyId,
      gameContentHash: publication.gameContentHash,
      metadataURI: publication.metadataURI,
    };
  } catch (error) {
    if (isPublicationNotFound(error)) return null;
    return "unavailable";
  }
}

export async function readHasAccess(input: {
  slug: string;
  account: Address;
  env?: NodeJS.Dict<string>;
  client?: PublicClient;
}): Promise<OnChainLookup<boolean>> {
  const env = input.env ?? process.env;
  const address = readPaidPlayAddress(env);
  if (!address) return "unavailable";
  const client = input.client ?? createPaidPlayClient();
  try {
    return await client.readContract({
      address,
      abi: hexBountyPaidPlayAbi,
      functionName: "hasAccess",
      args: [slugHash(input.slug), getAddress(input.account)],
    });
  } catch (error) {
    if (isPublicationNotFound(error)) return false;
    return "unavailable";
  }
}
