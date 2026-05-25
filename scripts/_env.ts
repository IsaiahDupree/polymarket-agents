// Tiny .env.local loader for the standalone scripts so we don't depend on a runner flag.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

export const env = {
  RELAYER_API_KEY: process.env.POLYMARKET_RELAYER_API_KEY ?? "",
  RELAYER_API_KEY_ADDRESS: process.env.POLYMARKET_RELAYER_API_KEY_ADDRESS ?? "",
  PRIVATE_KEY: process.env.POLYMARKET_PRIVATE_KEY ?? "",
  CLOB_API_KEY: process.env.POLYMARKET_CLOB_API_KEY ?? "",
  CLOB_SECRET: process.env.POLYMARKET_CLOB_SECRET ?? "",
  CLOB_PASSPHRASE: process.env.POLYMARKET_CLOB_PASSPHRASE ?? "",
  FUNDER_ADDRESS: process.env.POLYMARKET_FUNDER_ADDRESS ?? "",
  SIGNATURE_TYPE: Number(process.env.POLYMARKET_SIGNATURE_TYPE ?? "1"),
  GAMMA: process.env.POLYMARKET_GAMMA_HOST ?? "https://gamma-api.polymarket.com",
  DATA: process.env.POLYMARKET_DATA_HOST ?? "https://data-api.polymarket.com",
  CLOB: process.env.POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com",
  RELAYER: process.env.POLYMARKET_RELAYER_HOST ?? "https://relayer-v2.polymarket.com",
  CHAIN_ID: Number(process.env.POLYMARKET_CHAIN_ID ?? "137"),
} as const;
