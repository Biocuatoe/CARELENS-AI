/**
 * Writes contracts/carelens/<name>.schema.json (JSON Schema 2020-12) from the zod contracts in
 * src/contracts.ts. With --check it only compares and exits 1 on drift.
 *   node scripts/generate-contracts.ts [--check]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PUBLISHED_CONTRACTS } from "../src/contracts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "..", "contracts", "carelens");
const check = process.argv.includes("--check");
let drift = 0;

mkdirSync(outDir, { recursive: true });
for (const [name, schema] of Object.entries(PUBLISHED_CONTRACTS)) {
  const generated = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
  const doc = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://carelens.invalid/contracts/carelens/${name}.schema.json`,
    title: name,
    "x-generated-from": "backend/care-monitoring/worker/src/contracts.ts (do not edit by hand)",
    ...generated,
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const path = join(outDir, `${name}.schema.json`);
  if (check) {
    let current = "";
    try {
      current = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    } catch {
      /* missing */
    }
    if (current !== text) {
      console.error(`drift: ${name}.schema.json differs from src/contracts.ts`);
      drift++;
    }
  } else {
    writeFileSync(path, text, "utf8");
    console.log(`wrote contracts/carelens/${name}.schema.json`);
  }
}
// A schema file without a contract in src/contracts.ts is a leftover of a retired version.
for (const file of readdirSync(outDir)) {
  if (!file.endsWith(".schema.json")) continue;
  const name = file.slice(0, -".schema.json".length);
  if (!(name in PUBLISHED_CONTRACTS)) {
    console.error(`stale: ${file} has no contract in src/contracts.ts (delete it)`);
    drift++;
  }
}
if (drift > 0) process.exit(1);
if (check) console.log("contracts up to date");
