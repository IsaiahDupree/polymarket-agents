/**
 * Run the Neg Risk Adapter probe against live Polygon. Read-only.
 *
 *   npm run probe:neg-risk    # uses POLYGON_RPC_URL or viem default
 */
import "./_env.ts";
import { probeNegRiskAdapter, formatReport } from "../src/lib/arb/neg-risk-adapter-probe.ts";

const report = await probeNegRiskAdapter();
console.log(formatReport(report));
