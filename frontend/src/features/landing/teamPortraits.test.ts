import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { manifestProblems, missingPortraits, teamPortraitFiles, type PortraitManifest } from "../../../scripts/team-portraits";
import manifestJson from "../../../scripts/team-portraits.manifest.json";
import contentSource from "./content.ts?raw";
import { TEAM } from "./content";

const manifest = manifestJson as PortraitManifest;
const SCRIPT = join(process.cwd(), "scripts", "fetch-team-portraits.mjs");
/** The same files TeamSection loads (members/ at the project root). */
const membersFiles = Object.keys(import.meta.glob("../../../../members/*.{jpg,JPG,jpeg,JPEG}", { query: "?url", import: "default" }));
const MEMBERS_DIR = join(process.cwd(), "..", "members");

function run(env: Record<string, string>, args: string[] = []): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH ?? "", ...env } });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => done({ code, out }));
  });
}

let tmp: string | null = null;
let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("team portrait build guard", () => {
  it("reads every core member and expert portrait from TEAM, in order", () => {
    expect(teamPortraitFiles(contentSource)).toEqual([...TEAM.core.map((m) => m.file), ...TEAM.experts.map((e) => e.file)].map((f) => f.normalize("NFC")));
    expect(teamPortraitFiles(contentSource)).toHaveLength(7);
  });

  it("reports each missing file by name, matching like portraitFor (NFC, case-insensitive, base name)", () => {
    const required = ["Lê Đức Hùng - CEO.jpg", "Nguyễn Hải Yến - CMO.JPG", "ThS Chu Huy Anh - Chuyên gia.jpg"];
    expect(missingPortraits(required, [])).toEqual(required);
    expect(missingPortraits(required, ["../members/lê đức hùng - ceo.JPG".normalize("NFD"), "x/Nguyễn Hải Yến - CMO.jpg"])).toEqual(["ThS Chu Huy Anh - Chuyên gia.jpg"]);
    expect(missingPortraits(required, required)).toEqual([]);
  });

  it("every portrait named in TEAM exists in members/ (a checkout without the photos fails here and in vite build)", () => {
    expect(missingPortraits(teamPortraitFiles(contentSource), membersFiles)).toEqual([]);
  });

  it("the manifest lists exactly the TEAM portraits, and members/ holds the originals it pins", () => {
    expect(manifestProblems(teamPortraitFiles(contentSource), manifest)).toEqual([]);
    for (const p of manifest.portraits) {
      const bytes = readFileSync(join(MEMBERS_DIR, p.file));
      expect([bytes.length, createHash("sha256").update(bytes).digest("hex")], p.file).toEqual([p.bytes, p.sha256]);
    }
    const broken = { ...manifest, portraits: [...manifest.portraits.slice(1), { file: "Người Khác.jpg", sha256: "x", bytes: 0 }] };
    expect(manifestProblems(teamPortraitFiles(contentSource), broken)).toEqual(
      expect.arrayContaining([`not in manifest: ${manifest.portraits[0]!.file}`, "in manifest but not in TEAM: Người Khác.jpg", "bad sha256 for Người Khác.jpg"]),
    );
  });
});

describe("fetch-team-portraits.mjs (prebuild)", () => {
  it("signs requests exactly like the AWS SigV4 test vector", async () => {
    const r = await run({}, ["--self-test"]);
    expect([r.code, r.out.trim()]).toEqual([0, "portraits self-test: SigV4 test vector ok"]);
  });

  it("downloads nothing when every original is already present", async () => {
    const r = await run({ PORTRAITS_DIR: MEMBERS_DIR });
    expect(r.code).toBe(0);
    expect(r.out).toContain("7/7 originals present");
  });

  it("stops the build when the photos are missing and no bucket credentials are set", async () => {
    tmp = mkdtempSync(join(tmpdir(), "portraits-"));
    const r = await run({ PORTRAITS_DIR: tmp });
    expect(r.code).toBe(1);
    expect(r.out).toContain("7 of 7 original portraits are missing");
    expect(readdirSync(tmp)).toEqual([]);
  });

  it("downloads from the bucket with a signed request, verifies every file, and never writes or prints a wrong one", async () => {
    tmp = mkdtempSync(join(tmpdir(), "portraits-"));
    const byKey = new Map(manifest.portraits.map((p) => [`/carelens-site-portraits/portraits/${p.sha256}.jpg`, readFileSync(join(MEMBERS_DIR, p.file))]));
    const tampered = manifest.portraits[2]!;
    const seen: string[] = [];
    server = createServer((req, res) => {
      const auth = String(req.headers.authorization ?? "");
      seen.push(auth);
      if (!/^AWS4-HMAC-SHA256 Credential=TESTKEYID\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(auth)) {
        res.writeHead(403).end();
        return;
      }
      const body = byKey.get(req.url ?? "");
      if (!body) return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "image/jpeg" }).end(process.env.__TAMPER === "1" && req.url!.includes(tampered.sha256) ? Buffer.from("not the photo") : body);
    });
    await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", () => ok()));
    const port = (server.address() as { port: number }).port;
    const env = { PORTRAITS_DIR: tmp, PORTRAITS_R2_ENDPOINT: `http://127.0.0.1:${port}`, PORTRAITS_R2_ACCESS_KEY_ID: "TESTKEYID", PORTRAITS_R2_SECRET_ACCESS_KEY: "test-secret-value-never-printed" };

    const ok = await run(env);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("7 downloaded, 0 already present; all 7 verified");
    expect(ok.out).not.toContain("test-secret-value-never-printed");
    for (const p of manifest.portraits) expect(createHash("sha256").update(readFileSync(join(tmp, p.file))).digest("hex")).toBe(p.sha256);
    expect(seen).toHaveLength(7);

    // A wrong file from the bucket is refused and not written.
    rmSync(join(tmp, tampered.file));
    process.env.__TAMPER = "1";
    try {
      const bad = await run(env);
      expect(bad.code).toBe(1);
      expect(bad.out).toContain(`downloaded "${tampered.file}" does not match the manifest`);
      expect(readdirSync(tmp)).not.toContain(tampered.file);
      expect(readdirSync(tmp).some((n) => n.endsWith(".part"))).toBe(false);
    } finally {
      delete process.env.__TAMPER;
    }

    // Wrong credentials: refused by the bucket, build stopped, nothing printed but the status.
    writeFileSync(join(tmp, "placeholder.txt"), "");
    const denied = await run({ ...env, PORTRAITS_R2_ACCESS_KEY_ID: "WRONG" });
    expect(denied.code).toBe(1);
    expect(denied.out).toContain("HTTP 403");
    expect(denied.out).not.toContain("test-secret-value-never-printed");
  });
});
