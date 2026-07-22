import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export so Go can embed the chat UI at /app/ (chat_app_dist).
  // Dockerfile copies examples/chat-app/out → internal/perplexity/chat_app_dist.
  output: "export",
  // Assets must be absolute under /app/ when served by the Go embed handler.
  basePath: "/app",
  assetPrefix: "/app",
  images: { unoptimized: true },
  // Transpile workspace packages so "use client" boundaries and TSX
  // source work correctly under the App Router.
  transpilePackages: ["@anvil/react", "@anvil/react-headless", "@anvil/client"],
  reactStrictMode: true,
};

export default nextConfig;
