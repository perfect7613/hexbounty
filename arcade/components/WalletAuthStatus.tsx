"use client";

import { useEffect, useRef, useState } from "react";
import { getAddress, type Address } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useChainId, useSignMessage } from "wagmi";
import { hexBountyMonad } from "@/lib/chain";

const SIWE_STATEMENT =
  "Sign in to HexBounty Arcade to authenticate blockchain actions. This does not create an email account.";

type SessionResponse =
  | { authenticated: false }
  | { authenticated: true; address: string; chainId: number };

const AUTH_CHANGED_EVENT = "hexbounty:auth-changed";

function notifyAuthChanged() {
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export async function postAuthLogout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* client still clears local auth state */
  } finally {
    notifyAuthChanged();
  }
}

export async function createWalletSession(input: {
  walletAddress: Address;
  chainId: number;
  signMessage: (message: string) => Promise<`0x${string}`>;
}): Promise<Address> {
  if (input.chainId !== hexBountyMonad.id) {
    throw new Error("Switch to Monad Testnet before continuing.");
  }
  const nonceResponse = await fetch("/api/auth/nonce", { method: "POST" });
  if (!nonceResponse.ok) throw new Error("Could not start wallet verification.");
  const { nonce } = (await nonceResponse.json()) as { nonce: string };
  const issuedAt = new Date();
  const expirationTime = new Date(issuedAt.getTime() + 5 * 60 * 1000);
  const message = createSiweMessage({
    address: input.walletAddress,
    chainId: hexBountyMonad.id,
    domain: window.location.host,
    uri: window.location.origin,
    version: "1",
    statement: SIWE_STATEMENT,
    nonce,
    issuedAt,
    expirationTime,
  });
  const signature = await input.signMessage(message);
  const verifyResponse = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!verifyResponse.ok) throw new Error("Wallet verification failed.");
  const verified = (await verifyResponse.json()) as { address: string };
  const verifiedAddress = getAddress(verified.address);
  notifyAuthChanged();
  return verifiedAddress;
}

export function useWalletAuthSession() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const [sessionAddress, setSessionAddress] = useState<Address | null>(null);
  const [pending, setPending] = useState<"session" | "signin" | null>("session");
  const [error, setError] = useState<string>();
  const identityRef = useRef<{ address: Address; chainId: number } | null>(null);

  const walletAddress = address ? getAddress(address) : undefined;
  const authenticated = Boolean(walletAddress && sessionAddress && sessionAddress === walletAddress);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch("/api/auth/session");
        const data = (await response.json()) as SessionResponse;
        if (cancelled) return;
        if (data.authenticated && data.address) {
          setSessionAddress(getAddress(data.address));
        } else {
          setSessionAddress(null);
        }
      } catch {
        if (!cancelled) setError("Could not read session.");
      } finally {
        if (!cancelled) {
          setPending((current) => (current === "session" ? null : current));
        }
      }
    };
    void refresh();
    window.addEventListener(AUTH_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGED_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    if (!walletAddress || !sessionAddress) return;
    if (sessionAddress === walletAddress) return;
    let cancelled = false;
    void (async () => {
      await postAuthLogout();
      if (cancelled) return;
      setSessionAddress(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, sessionAddress]);

  useEffect(() => {
    if (!walletAddress) {
      identityRef.current = null;
      return;
    }
    const previous = identityRef.current;
    if (!previous) {
      identityRef.current = { address: walletAddress, chainId };
      return;
    }
    if (previous.address === walletAddress && previous.chainId === chainId) return;
    identityRef.current = { address: walletAddress, chainId };
    let cancelled = false;
    void (async () => {
      await postAuthLogout();
      if (cancelled) return;
      setSessionAddress(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, chainId]);

  async function signIn() {
    if (!walletAddress || chainId !== hexBountyMonad.id) return;
    if (!isConnected || pending !== null) return;
    setError(undefined);
    setPending("signin");
    try {
      const verifiedAddress = await createWalletSession({
        walletAddress,
        chainId,
        signMessage: (message) => signMessageAsync({ message }),
      });
      setSessionAddress(verifiedAddress);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
      setSessionAddress(null);
    } finally {
      setPending(null);
    }
  }

  return {
    authenticated,
    sessionAddress,
    pending,
    error,
    signIn,
  };
}
