/// <reference types="vite/client" />
/** Published contracts: every valid fixture parses, every invalid one is rejected, schemas match zod. */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PUBLISHED_CONTRACTS } from "../src/contracts";

const fixtures = import.meta.glob("../../../../contracts/carelens/fixtures/*/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const schemas = import.meta.glob("../../../../contracts/carelens/*.schema.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;

function contractOf(path: string): keyof typeof PUBLISHED_CONTRACTS {
  const file = path.split("/").pop() as string;
  return file.split(".").slice(0, 2).join(".") as keyof typeof PUBLISHED_CONTRACTS;
}

describe("contract fixtures", () => {
  const entries = Object.entries(fixtures);
  it("has fixtures to check", () => expect(entries.length).toBeGreaterThan(10));
  for (const [path, value] of entries) {
    const valid = path.includes("/valid/");
    it(`${valid ? "accepts" : "rejects"} ${path.split("/fixtures/")[1]}`, () => {
      const schema = PUBLISHED_CONTRACTS[contractOf(path)];
      expect(schema, path).toBeDefined();
      expect(schema.safeParse(value).success).toBe(valid);
    });
  }
});

describe("committed JSON Schemas", () => {
  for (const [name, schema] of Object.entries(PUBLISHED_CONTRACTS)) {
    it(`${name}.schema.json matches src/contracts.ts`, () => {
      const file = Object.entries(schemas).find(([p]) => p.endsWith(`/${name}.schema.json`))?.[1];
      expect(file, `${name}.schema.json missing: run npm run contracts:generate`).toBeDefined();
      const { $schema: _s, $id: _i, title: _t, "x-generated-from": _x, ...body } = file as Record<string, unknown>;
      const { $schema: _g, ...generated } = z.toJSONSchema(schema, { target: "draft-2020-12" }) as Record<string, unknown>;
      expect(body).toEqual(generated);
    });
  }
});
