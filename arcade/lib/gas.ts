import type { Address, Hex, PublicClient } from "viem";
import { hexBountyAbi } from "./abi";

const BUFFER_NUMERATOR = 11n;
const BUFFER_DENOMINATOR = 10n;

export async function estimateEscrowGas(
  publicClient: PublicClient,
  params: {
    account: Address;
    address: Address;
    functionName:
      | "createBounty"
      | "fundBounty"
      | "submitSolution"
      | "acceptSolution"
      | "refundExpiredBounty";
    args: readonly unknown[];
    value?: bigint;
  },
): Promise<bigint> {
  const estimated = await publicClient.estimateContractGas({
    account: params.account,
    address: params.address,
    abi: hexBountyAbi,
    functionName: params.functionName,
    args: params.args,
    value: params.value,
  } as never);
  return (estimated * BUFFER_NUMERATOR) / BUFFER_DENOMINATOR;
}

export function isBytes32(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}
