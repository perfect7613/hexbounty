import { getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWalletSession } from "@/components/WalletAuthStatus";

const ADDRESS = getAddress("0x1111111111111111111111111111111111111111");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("wallet session recovery", () => {
  it("verifies the connected wallet so an upload click can continue to payment", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      dispatchEvent,
      location: {
        host: "arcade.example",
        origin: "https://arcade.example",
      },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce: "abcdefghijklmnopqrstuvwxyz12" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ address: ADDRESS }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const signMessage = vi.fn(async () => `0x${"12".repeat(65)}` as `0x${string}`);

    await expect(
      createWalletSession({ walletAddress: ADDRESS, chainId: 10143, signMessage }),
    ).resolves.toBe(ADDRESS);

    expect(signMessage).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/auth/nonce", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/auth/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it("refuses verification before any request on the wrong network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWalletSession({
        walletAddress: ADDRESS,
        chainId: 1,
        signMessage: vi.fn(),
      }),
    ).rejects.toThrow("Switch to Monad Testnet");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
