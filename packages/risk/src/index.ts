/**
 * @polymarket-agents/risk — pre-trade risk pipeline + per-agent capsule envelope.
 * Includes the global RiskEngine + KillSwitch and the per-agent Capsule store/gate/journal.
 */
export * from "./engine";
export * from "./kill-switch";
export * from "./limits";
export * from "./types";
export * as capsules from "./capsules";
