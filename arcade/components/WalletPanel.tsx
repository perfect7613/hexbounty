"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { getMonadAddChainParams, hexBountyMonad, isUnrecognizedChainError } from "@/lib/chain";
import { METAMASK_DOWNLOAD_URL } from "@/lib/env";
import { explorerAddress, shortHash } from "@/lib/explorer";
import { formatMon } from "@/lib/bounties";
import { postAuthLogout, useWalletAuthSession } from "./WalletAuthStatus";
import { Button } from "./ui/button";

function subscribe() {
  return () => undefined;
}

function getMetaMaskSnapshot(): boolean {
  return Boolean(window.ethereum?.isMetaMask);
}

async function addMonadChain() {
  const request = window.ethereum?.request;
  if (!request) {
    throw new Error("MetaMask is not available.");
  }
  await request({
    method: "wallet_addEthereumChain",
    params: [getMonadAddChainParams()],
  });
}

function liveStatus(
  pending: "session" | "signin" | null,
  authenticated: boolean,
): string {
  if (pending === "session") return "Checking session…";
  if (pending === "signin") return "Signing in…";
  return authenticated ? "Authenticated" : "Not authenticated";
}

export function WalletPanel() {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const metaMaskInstalled = useSyncExternalStore(subscribe, getMetaMaskSnapshot, () => false);
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, error: connectError, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, error: switchError, isPending: isSwitchPending } = useSwitchChain();
  const { data: balance } = useBalance({
    address,
    chainId: hexBountyMonad.id,
    query: { enabled: Boolean(address) },
  });
  const [addError, setAddError] = useState<string>();
  const { authenticated, pending, error: authError, signIn } = useWalletAuthSession();
  const menuRef = useRef<HTMLDetailsElement>(null);

  const connector = connectors[0];
  const onMonad = chainId === hexBountyMonad.id;
  const busy = isConnecting || isReconnecting || isConnectPending;
  const canSignIn = Boolean(isConnected && address && onMonad && pending === null && !authenticated);

  if (!mounted) {
    return (
      <div className="wallet-control" aria-hidden="true">
        <span className="wallet-control__ghost">Wallet</span>
      </div>
    );
  }

  function closeMenu() {
    menuRef.current?.removeAttribute("open");
  }

  async function handleDisconnect() {
    closeMenu();
    await postAuthLogout();
    disconnect();
  }

  async function handleSwitch() {
    setAddError(undefined);
    try {
      await switchChainAsync({ chainId: hexBountyMonad.id });
      closeMenu();
    } catch (error) {
      if (!isUnrecognizedChainError(error)) return;
      try {
        await addMonadChain();
        await switchChainAsync({ chainId: hexBountyMonad.id });
        closeMenu();
      } catch (addChainError) {
        setAddError(
          addChainError instanceof Error ? addChainError.message : "Could not add Monad Testnet.",
        );
      }
    }
  }

  const alert =
    addError ||
    (switchError && !addError ? switchError.message : undefined) ||
    connectError?.message ||
    authError;

  const triggerState = !onMonad ? "Switch network" : authenticated ? "Ready" : "Verify";
  const networkStatus = !onMonad
    ? "Wrong network"
    : authenticated
      ? "Ready on Monad Testnet"
      : "Verify this wallet to continue";

  if (!metaMaskInstalled || !connector) {
    return (
      <div className="wallet-control">
        <p className="visually-hidden" role="status" aria-live="polite">
          MetaMask is not installed.
        </p>
        <Button asChild size="sm" variant="secondary">
          <a href={METAMASK_DOWNLOAD_URL} rel="noreferrer" target="_blank">
            Install MetaMask
          </a>
        </Button>
      </div>
    );
  }

  if (!isConnected || !address) {
    return (
      <div className="wallet-control">
        <p className="visually-hidden" role="status" aria-live="polite">
          {liveStatus(pending, authenticated)}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => connect({ connector, chainId: hexBountyMonad.id })}
        >
          {busy ? "Connecting…" : "Connect MetaMask"}
        </Button>
        {alert ? (
          <p className="wallet-control__alert" role="alert">
            {alert}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="wallet-control wallet-control--menu">
      <details className="wallet-menu" ref={menuRef}>
        <summary className="wallet-menu__trigger">
          <span className="mono">{shortHash(address, 4)}</span>
          <span className="wallet-menu__state">{triggerState}</span>
        </summary>
        <div className="wallet-menu__panel">
          <p className="wallet-menu__balance">{balance ? formatMon(balance.value) : "… MON"}</p>
          <a
            className="wallet-menu__addr mono"
            href={explorerAddress(address)}
            rel="noreferrer"
            target="_blank"
            title={address}
          >
            {address}
          </a>
          <p className="wallet-menu__status" role="status" aria-live="polite">
            {pending ? liveStatus(pending, authenticated) : `${networkStatus}.`}
          </p>
          <div className="wallet-menu__actions">
            {!onMonad ? (
              <Button type="button" size="sm" disabled={isSwitchPending} onClick={() => void handleSwitch()}>
                {isSwitchPending ? "Switching…" : "Switch to Monad Testnet"}
              </Button>
            ) : null}
            {onMonad && !authenticated ? (
              <Button
                type="button"
                size="sm"
                disabled={!canSignIn}
                onClick={() => {
                  closeMenu();
                  void signIn();
                }}
              >
                {pending === "signin" ? "Signing in…" : "Sign in with MetaMask"}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" type="button" onClick={() => void handleDisconnect()}>
              Disconnect wallet
            </Button>
          </div>
          {alert ? (
            <p className="wallet-control__alert" role="alert">
              {alert}
            </p>
          ) : null}
        </div>
      </details>
    </div>
  );
}
