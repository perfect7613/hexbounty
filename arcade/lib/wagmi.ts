import { createConfig, http } from "wagmi";
import { metaMask } from "wagmi/connectors";
import { hexBountyMonad } from "./chain";
import { getRpcUrl, MONAD_TESTNET_ID } from "./env";

if (hexBountyMonad.id !== MONAD_TESTNET_ID) {
  throw new Error(`Expected Monad Testnet id ${MONAD_TESTNET_ID}, got ${hexBountyMonad.id}`);
}

/** @metamask/connect-evm accepts http(s) origins; SSR has no window. */
type ConnectEvmUrl = `${"http://" | "https://"}${string}`;

const LOCAL_DAPP_URL = "http://localhost:3000" satisfies ConnectEvmUrl;

function isConnectEvmUrl(value: string): value is ConnectEvmUrl {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function getDappUrl(): ConnectEvmUrl {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  if (isConnectEvmUrl(configured)) return configured;
  if (typeof window !== "undefined" && isConnectEvmUrl(window.location.origin)) {
    return window.location.origin;
  }
  return LOCAL_DAPP_URL;
}

export const wagmiConfig = createConfig({
  chains: [hexBountyMonad],
  connectors: [
    metaMask({
      dapp: {
        name: "HexBounty",
        url: getDappUrl(),
      },
    }),
  ],
  transports: {
    [hexBountyMonad.id]: http(getRpcUrl()),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
