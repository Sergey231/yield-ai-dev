import { readFileSync } from "fs";
let KEY;
try {
  KEY = readFileSync(".env.local", "utf8")
    .match(/APTOS_API_KEY=(.*)/)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
} catch {}

const SAFE =
  process.argv[2] ??
  "0x2822696e70a22d2a4bd8aa12444a8293b9a84839122632e162a22da41f18b203";

const res = await fetch("https://indexer.mainnet.aptoslabs.com/v1/graphql", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
  },
  body: JSON.stringify({
    query: `query B($o: String!) {
      current_fungible_asset_balances(where: { owner_address: { _eq: $o }, amount: { _gt: "0" } }) {
        asset_type
        amount
        metadata { symbol decimals }
      }
    }`,
    variables: { o: SAFE },
  }),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
