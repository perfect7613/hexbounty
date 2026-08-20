import { MONAD_EXPLORER_ORIGIN } from "./env";

export function explorerTx(hash: string): string {
  return `${MONAD_EXPLORER_ORIGIN}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${MONAD_EXPLORER_ORIGIN}/address/${address}`;
}

export function explorerBlock(block: string | number | bigint): string {
  return `${MONAD_EXPLORER_ORIGIN}/block/${block}`;
}

export function shortHash(value: string, size = 4): string {
  if (value.length <= size * 2 + 2) return value;
  return `${value.slice(0, size + 2)}…${value.slice(-size)}`;
}
