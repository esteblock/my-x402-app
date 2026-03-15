import { NextRequest, NextResponse } from "next/server";
import { withX402, type RouteConfig } from "@x402/next";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { Network } from "@x402/core/types";
import { fullArticle } from "@/content/article";

// Monad Testnet configuration
const MONAD_NETWORK: Network = "eip155:10143";
const MONAD_USDC_TESTNET = "0x534b2f3A21130d7a60830c2Df862319e593943A3";

// Monad Facilitator URL
const FACILITATOR_URL = "https://x402-facilitator.molandak.org"; 

if (!process.env.PAY_TO_ADDRESS) {
  throw new Error("PAY_TO_ADDRESS environment variable is required");
}
const PAY_TO = process.env.PAY_TO_ADDRESS;

// Create facilitator client for Monad
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Create and configure x402 resource server
const server = new x402ResourceServer(facilitatorClient);

// Create Exact EVM Scheme with custom money parser for Monad USDC
const monadScheme = new ExactEvmScheme();
monadScheme.registerMoneyParser(async (amount: number, network: string) => {
  if (network === MONAD_NETWORK) {
    // Convert decimal amount to USDC smallest units (6 decimals)
    const tokenAmount = Math.floor(amount * 1_000_000).toString();
    return {
      amount: tokenAmount,
      asset: MONAD_USDC_TESTNET, // Raw address for EIP-712 verifyingContract
      extra: {
        name: "USDC",
        version: "2",
      },
    };
  }
  return null; // Use default parser for other networks
});

// Register Monad network with custom scheme
server.register(MONAD_NETWORK, monadScheme);

// Route configuration
const routeConfig: RouteConfig = {
  accepts: {
    scheme: "exact",
    network: MONAD_NETWORK,
    payTo: PAY_TO,
    price: "$0.001",
  },
  resource: "http://localhost:3000/api/premium", // Use relative path to avoid host mismatch
};

// Handler that returns full article content
async function handler(request: NextRequest) {
  return NextResponse.json({
    content: "Return premium content",
    unlockedAt: new Date().toISOString(),
  });
}

// Export GET method wrapped with x402 payment protection
export const GET = withX402(handler, routeConfig, server);