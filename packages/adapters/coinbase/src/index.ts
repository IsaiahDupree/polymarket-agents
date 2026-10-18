/**
 * @polymarket-agents/adapter-coinbase
 *
 * Exposes the VenueAdapter (`./adapter`) + the Coinbase Advanced Trade SDK
 * (auth, REST client, execute, WS).
 */
export * from "./adapter";
export * as auth from "./auth";
export * as client from "./client";
export * as execute from "./execute";
export * as ws from "./ws";
