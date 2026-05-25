import "./_env.ts";
import { db } from "../src/lib/db/client.ts";

db();
console.log("DB ready:", process.env.POLYMARKET_DB_PATH ?? "data/polymarket.db");
