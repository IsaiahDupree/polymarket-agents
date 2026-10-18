// Emergency cancel-all for arb runner positions. Always allowed.
import "./_env.ts";
import { killSwitch } from "@adapters/polymarket/execute";

const r = await killSwitch();
console.log(r);
process.exit(r.ok ? 0 : 1);
