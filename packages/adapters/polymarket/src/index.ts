/**
 * @polymarket-agents/adapter-polymarket
 *
 * Exposes the VenueAdapter (`./adapter`) + the full Polymarket SDK surface
 * (CLOB client, execute, arb, signing, realtime, etc.).
 */
export * from "./adapter";
export * as arb from "./arb";
export * as category from "./category";
export * as client from "./client";
export * as dependencyInference from "./dependency-inference";
export * as deposit from "./deposit";
export * as execute from "./execute";
export * as lp from "./lp";
export * as onchain from "./onchain";
export * as proxyRouting from "./proxy-routing";
export * as proxy from "./proxy";
export * as realtime from "./realtime";
export * as sign from "./sign";
export * as signals from "./signals";
export * as ws from "./ws";
