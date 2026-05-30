import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", ".next", "tests/ui/**"],
    // E2E tests hit live network — opt-in via RUN_E2E=1.
    testTimeout: process.env.RUN_E2E === "1" ? 120_000 : 10_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
      exclude: ["src/app/**", "**/*.d.ts", "tests/**"],
    },
    pool: "forks", // better-sqlite3 + native modules play nicer with forks
  },
  resolve: {
    alias: {
      // After apps/web carve, the @/ alias resolves into BOTH locations —
      // src/lib stays at root, but components + app + middleware moved to
      // apps/web/src. vite resolves by first match found at runtime.
      "@/lib": path.resolve(__dirname, "./src/lib"),
      "@/components": path.resolve(__dirname, "./apps/web/src/components"),
      "@/app": path.resolve(__dirname, "./apps/web/src/app"),
      "@/middleware": path.resolve(__dirname, "./apps/web/src/middleware"),
      "@": path.resolve(__dirname, "./src"),
      "@core": path.resolve(__dirname, "./packages/core/src"),
      "@adapters/polymarket": path.resolve(__dirname, "./packages/adapters/polymarket/src"),
      "@adapters/coinbase": path.resolve(__dirname, "./packages/adapters/coinbase/src"),
      "@adapters/aave": path.resolve(__dirname, "./packages/adapters/aave/src"),
      "@adapters/sim": path.resolve(__dirname, "./packages/adapters/sim/src"),
      "@strategy": path.resolve(__dirname, "./packages/strategy/src"),
      "@risk": path.resolve(__dirname, "./packages/risk/src"),
      "@oms": path.resolve(__dirname, "./packages/oms/src"),
      "@data": path.resolve(__dirname, "./packages/data/src"),
      "@quant": path.resolve(__dirname, "./packages/quant/src"),
      "@wallet": path.resolve(__dirname, "./packages/wallet/src"),
      "@agent": path.resolve(__dirname, "./packages/agent/src"),
    },
  },
});
