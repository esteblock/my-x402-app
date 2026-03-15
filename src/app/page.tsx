"use client";

import { useState, useCallback, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useConfig, useSwitchChain } from "wagmi";
import { getWalletClient } from "@wagmi/core";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { x402Client } from "@x402/core/client";

// x402 configuration
const x402Config = {
  chainId: "eip155:10143" as const,
  usdcAddress: "0x534b2f3A21130d7a60830c2Df862319e593943A3", // MONAD USDC TESTNET
  facilitator: "https://x402-facilitator.molandak.org", // MONAD FACILITATOR URL
  price: "0.001", // USDC
};

export default function Home() {
  const { isConnected, address, chainId: walletChainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const [mounted, setMounted] = useState(false);
  const [message, setMessage] = useState("Pay $0.001 USDC to unlock premium content");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => { setMounted(true); }, []);

  // This function allows signing a message, and pay USDC gaslessly. 
  const handleUnlock = useCallback(async () => {
    if (!address) {
      setStatus("error");
      setMessage("Please connect your wallet first");
      return;
    }

    setStatus("loading");

    try {
      if (walletChainId !== 10143) {
        setMessage("Switching to Monad Testnet...");
        try {
          await switchChainAsync({ chainId: 10143 });
        } catch {
          // Chain not in MetaMask yet — add it, then switch
          await (window as unknown as { ethereum: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x279F",
              chainName: "Monad Testnet",
              nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
              rpcUrls: ["https://testnet-rpc.monad.xyz"],
              blockExplorerUrls: ["https://testnet.monadexplorer.com"],
            }],
          });
        }
      }

      const walletClient = await getWalletClient(config, { chainId: 10143 });
      if (!walletClient) {
        setStatus("error");
        setMessage("Please switch your wallet to Monad Testnet (chain ID: 10143)");
        return;
      }

      // Create EVM signer compatible with x402 ClientEvmSigner interface
      const evmSigner = {
        address: address as `0x${string}`,
        signTypedData: async (message: {
          domain: Record<string, unknown>;
          types: Record<string, unknown>;
          primaryType: string;
          message: Record<string, unknown>;
        }) => {
          return walletClient.signTypedData({
            domain: message.domain as Parameters<typeof walletClient.signTypedData>[0]["domain"],
            types: message.types as Parameters<typeof walletClient.signTypedData>[0]["types"],
            primaryType: message.primaryType,
            message: message.message,
          });
        },
      };

      // Create the Exact EVM scheme for signing
      const exactScheme = new ExactEvmScheme(evmSigner);

      // Create x402 client and register the scheme
      const client = new x402Client()
        .register(x402Config.chainId, exactScheme);

      console.log("x402 client configured for network:", x402Config.chainId);

      // Wrap fetch with x402 payment capability
      const paymentFetch = wrapFetchWithPayment(fetch, client);

      console.log("Making payment request to /api/article...");

      // Make request to protected endpoint
      const response = await paymentFetch("/api/premium", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        // Try to parse x402 payment-required header for detailed error
        const paymentHeader = response.headers.get("payment-required") ||
                              response.headers.get("x-payment");

        if (paymentHeader && response.status === 402) {
          try {
            const paymentData = JSON.parse(atob(paymentHeader));
            console.error("Payment error details:", paymentData);

            // Extract user-friendly error message
            if (paymentData.error?.includes("insufficient_funds")) {
              throw new Error("INSUFFICIENT_FUNDS");
            }
            if (paymentData.error?.includes("unexpected_error")) {
              throw new Error("UNEXPECTED_ERROR");
            }
            if (paymentData.error) {
              throw new Error(paymentData.error);
            }
          } catch (e) {
            if (e instanceof Error && e.message === "INSUFFICIENT_FUNDS") {
              throw e;
            }
            // Failed to parse header, continue to generic error
          }
        }

        const errorText = await response.text().catch(() => "");
        let errorData: Record<string, unknown> = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          // Not JSON
        }
        throw new Error(
          errorData.error as string ||
          errorData.details as string ||
          `Request failed: ${response.status}`
        );
      }

      const data = await response.json();

      // Cache the unlocked content in LocalStorage
      localStorage.setItem(
        "premimum_content_unlocked",
        JSON.stringify({
          content: data.content,
          timestamp: Date.now(),
        })
      );
      setStatus("success");
      setMessage(data.content || "Content unlocked!");
    } catch (err) {
      console.error("Unlock error:", err);
      const errMsg = err instanceof Error ? err.message : "Failed to unlock article";

      // Map technical errors to user-friendly messages
      setStatus("error");
      if (
        errMsg.includes("User rejected") ||
        errMsg.includes("User denied") ||
        errMsg.includes("user rejected")
      ) {
        setMessage("Transaction cancelled by user");
      } else if (errMsg === "INSUFFICIENT_FUNDS" || errMsg.includes("insufficient_funds")) {
        setMessage("Insufficient USDC balance");
      } else if (errMsg === "UNEXPECTED_ERROR" || errMsg.includes("unexpected_error")) {
        setMessage("An unexpected error occurred");
      } else {
        setMessage(errMsg);
      }
    }
  }, [address, config, walletChainId, switchChainAsync]);

  return (
    <main className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-white">x402 on Monad</h1>
          <p className="text-zinc-400 text-sm">
            Micropayments via Thirdweb facilitator.{" "}
            <a href="https://docs.monad.xyz/guides/x402-guide" className="text-violet-400 hover:underline">
              Docs
            </a>
          </p>
        </div>

        {!mounted || !isConnected ? (
          <button
            onClick={() => connect({ connector: connectors[0] })}
            className="w-full py-3 px-4 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
          >
            Connect Wallet
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-zinc-400 text-xs font-mono">{address?.slice(0, 6)}…{address?.slice(-4)}</span>
              <button onClick={() => disconnect()} className="text-zinc-500 hover:text-zinc-300 text-xs">
                Disconnect
              </button>
            </div>
            <button
              onClick={handleUnlock}
              disabled={status === "loading"}
              className="w-full py-3 px-4 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:cursor-wait text-white font-medium rounded-lg transition-colors"
            >
              {status === "loading" ? "Processing..." : "Pay & Unlock Content"}
            </button>
          </div>
        )}

        <div className={`p-4 rounded-lg text-sm ${
          status === "error" ? "bg-red-950 text-red-300" :
          status === "success" ? "bg-green-950 text-green-300" :
          "bg-zinc-900 text-zinc-300"
        }`}>
          {message}
        </div>
      </div>
    </main>
  );
}