/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Real type checking happens via `npx tsc --noEmit` at the workspace root
  // and the vitest suite (2000+ tests); ignoreBuildErrors removes a
  // duplicated worker pool that sometimes races on Windows.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Server-only packages that webpack should NOT bundle. Native modules
  // (better-sqlite3) and heavy SDKs that drag in many deps go here so the
  // worker-thread chunk emission doesn't race.
  serverExternalPackages: [
    "better-sqlite3",
    "@anthropic-ai/sdk",
    "@polymarket/clob-client",
    "@polymarket/clob-client-v2",
    "@polymarket/real-time-data-client",
    "ethers",
    "viem",
    "ws",
    "isomorphic-ws",
    "jose",
    "glpk.js",
  ],
  // The Turbopack compiler walks up looking for tsconfig — pin its root to
  // the workspace root so it finds path aliases (@/*, @core/*, etc.) from
  // the shared tsconfig.json there instead of guessing.
  turbopack: {
    root: "../..",
  },
};

export default nextConfig;
