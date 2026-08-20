import "server-only";

import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  parseEventLogs,
  parseEther,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { hexBountyAbi } from "../abi";
import { hexBountyMonad } from "../chain";
import { getContractConfig, getRpcUrl } from "../env";
import type { UploadMetadata } from "../uploads/schema";

const MAX_FUTURE_DEADLINE_SECONDS = 31 * 24 * 60 * 60;

type PaymentTransaction = {
  from: Address;
  to: Address | null;
  input: Hex;
  value: bigint;
};

type PaymentReceipt = {
  status: "success" | "reverted";
  logs: Log[];
};

export type ReconstructionPaymentDeps = {
  getTransaction: (hash: Hex) => Promise<PaymentTransaction>;
  getReceipt: (hash: Hex) => Promise<PaymentReceipt>;
  nowSeconds?: () => number;
};

export class ReconstructionPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReconstructionPaymentError";
  }
}

function defaultDeps(): ReconstructionPaymentDeps {
  const client = createPublicClient({ chain: hexBountyMonad, transport: http(getRpcUrl()) });
  return {
    getTransaction: (hash) => client.getTransaction({ hash }) as Promise<PaymentTransaction>,
    getReceipt: (hash) => client.getTransactionReceipt({ hash }) as Promise<PaymentReceipt>,
  };
}

export async function verifyReconstructionPayment(input: {
  owner: Address;
  payment: UploadMetadata;
  deps?: ReconstructionPaymentDeps;
}): Promise<void> {
  const contract = getContractConfig();
  if (contract.status !== "configured") {
    throw new ReconstructionPaymentError("Reconstruction escrow is not configured");
  }
  const deps = input.deps ?? defaultDeps();
  const hash = input.payment.bountyTxHash as Hex;
  const [transaction, receipt] = await Promise.all([
    deps.getTransaction(hash),
    deps.getReceipt(hash),
  ]);
  if (receipt.status !== "success") {
    throw new ReconstructionPaymentError("Reconstruction bounty transaction reverted");
  }
  if (!transaction.to || getAddress(transaction.to) !== getAddress(contract.address)) {
    throw new ReconstructionPaymentError("Transaction was not sent to HexBountyEscrow");
  }
  if (getAddress(transaction.from) !== getAddress(input.owner)) {
    throw new ReconstructionPaymentError("Bounty sponsor does not match the signed-in wallet");
  }
  if (transaction.value !== parseEther(input.payment.bountyMon)) {
    throw new ReconstructionPaymentError("Bounty transaction value does not match bountyMon");
  }

  let decoded: ReturnType<typeof decodeFunctionData>;
  try {
    decoded = decodeFunctionData({ abi: hexBountyAbi, data: transaction.input });
  } catch {
    throw new ReconstructionPaymentError("Bounty transaction calldata is invalid");
  }
  if (decoded.functionName !== "createBounty") {
    throw new ReconstructionPaymentError("Payment transaction did not create a bounty");
  }
  const [metadataURI, deadline] = decoded.args as readonly [string, bigint];
  if (
    metadataURI !== input.payment.bountyMetadataURI ||
    deadline !== BigInt(input.payment.bountyDeadline)
  ) {
    throw new ReconstructionPaymentError("Bounty transaction metadata does not match this upload");
  }
  const now = deps.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  if (
    input.payment.bountyDeadline <= now ||
    input.payment.bountyDeadline > now + MAX_FUTURE_DEADLINE_SECONDS
  ) {
    throw new ReconstructionPaymentError("Bounty deadline is outside the allowed window");
  }

  const events = parseEventLogs({
    abi: hexBountyAbi,
    eventName: "BountyCreated",
    logs: receipt.logs.filter(
      (log) => getAddress(log.address) === getAddress(contract.address),
    ),
    strict: true,
  });
  const expectedId = BigInt(input.payment.bountyId);
  const event = events.find(
    (log) =>
      log.args.bountyId === expectedId &&
      getAddress(log.args.sponsor) === getAddress(input.owner),
  );
  if (
    !event ||
    event.args.reward !== transaction.value ||
    event.args.deadline !== deadline ||
    event.args.metadataURI !== metadataURI
  ) {
    throw new ReconstructionPaymentError("BountyCreated event does not match this upload");
  }
}
