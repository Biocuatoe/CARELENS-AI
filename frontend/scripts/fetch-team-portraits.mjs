#!/usr/bin/env node
/**
 * Provides the original team/expert portraits to a build (A47). Runs as `prebuild`, before `tsc -b && vite build`.
 *
 * The photos are of real people and are not in git (the repository is public). A build gets them from:
 *   1. `members/` at the project root, when every file is already there with the SHA-256 in team-portraits.manifest.json
 *      (developer and owner machines): nothing is downloaded;
 *   2. otherwise the private Cloudflare R2 bucket in the manifest (endpoint, bucket), through its S3 API with a read-only
 *      token (Vercel builds): PORTRAITS_R2_ACCESS_KEY_ID, PORTRAITS_R2_SECRET_ACCESS_KEY (sensitive env vars);
 *      PORTRAITS_R2_ENDPOINT / PORTRAITS_R2_BUCKET override the manifest (tests).
 * Every file is checked against its SHA-256 and size before it is written; a mismatch is never written. Without the files
 * and without the credentials the script stops the build with a clear message. Credentials are never printed.
 * The A46 build guard (team-portraits-guard.ts) checks the result again inside `vite build`.
 *
 *   node scripts/fetch-team-portraits.mjs              provide the portraits
 *   node scripts/fetch-team-portraits.mjs --self-test  check the request signer against the AWS SigV4 test vector
 * PORTRAITS_DIR overrides the target directory (tests only).
 */
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "team-portraits.manifest.json");
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/** AWS Signature Version 4 `Authorization` header. `headers` keys are lower-case and must include `host`. */
export function sigV4Authorization({ method, path, query = "", headers, payloadHash, region, service, accessKeyId, secretAccessKey, amzDate }) {
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
  return { authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, signature };
}

function selfTest() {
  // "Example: GET Object" from the AWS S3 documentation (Signature Version 4, header-based authentication).
  const { signature } = sigV4Authorization({
    method: "GET",
    path: "/test.txt",
    headers: { host: "examplebucket.s3.amazonaws.com", range: "bytes=0-9", "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": "20130524T000000Z" },
    payloadHash: EMPTY_SHA256,
    region: "us-east-1",
    service: "s3",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    amzDate: "20130524T000000Z",
  });
  const expected = "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41";
  if (signature !== expected) {
    console.error(`portraits self-test: signature ${signature} != ${expected}`);
    process.exit(1);
  }
  console.log("portraits self-test: SigV4 test vector ok");
}

async function download(entry, manifest, env) {
  const endpoint = new URL(env.PORTRAITS_R2_ENDPOINT || manifest.endpoint);
  const bucket = env.PORTRAITS_R2_BUCKET || manifest.bucket;
  const path = `/${bucket}/${manifest.keyPrefix}${entry.sha256}.jpg`; // ASCII-only key: no URI encoding needed
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const headers = { host: endpoint.host, "x-amz-content-sha256": EMPTY_SHA256, "x-amz-date": amzDate };
  const { authorization } = sigV4Authorization({
    method: "GET", path, headers, payloadHash: EMPTY_SHA256, region: "auto", service: "s3",
    accessKeyId: env.PORTRAITS_R2_ACCESS_KEY_ID, secretAccessKey: env.PORTRAITS_R2_SECRET_ACCESS_KEY, amzDate,
  });
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(new URL(path, endpoint), { headers: { ...headers, authorization }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if (res.status === 401 || res.status === 403 || res.status === 404) break; // not transient
        continue;
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length !== entry.bytes || sha256(body) !== entry.sha256) {
        throw new Error(`downloaded "${entry.file}" does not match the manifest (size ${body.length}, expected ${entry.bytes}); not written`);
      }
      return body;
    } catch (err) {
      if (err instanceof Error && err.message.includes("does not match the manifest")) throw err;
      lastError = err instanceof Error ? err.name : "error";
    }
  }
  throw new Error(`could not download "${entry.file}" from the private bucket (${lastError})`);
}

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const dir = resolve(process.env.PORTRAITS_DIR || join(HERE, "..", "..", "members"));
  const missing = manifest.portraits.filter((e) => {
    const p = join(dir, e.file);
    return !existsSync(p) || sha256(readFileSync(p)) !== e.sha256;
  });
  if (missing.length === 0) {
    console.log(`portraits: ${manifest.portraits.length}/${manifest.portraits.length} originals present in ${dir}, nothing downloaded`);
    return;
  }
  const env = process.env;
  if (!env.PORTRAITS_R2_ACCESS_KEY_ID || !env.PORTRAITS_R2_SECRET_ACCESS_KEY) {
    console.error(
      `portraits: ${missing.length} of ${manifest.portraits.length} original portraits are missing or differ in ${dir} and ` +
        "PORTRAITS_R2_ACCESS_KEY_ID / PORTRAITS_R2_SECRET_ACCESS_KEY are not set. " +
        "Put the originals in members/ or set the read-only bucket credentials (docs/DEPLOYMENT_RUNBOOK.md §17.0c). Build stopped.",
    );
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
  for (const entry of missing) {
    const body = await download(entry, manifest, env);
    const target = join(dir, entry.file);
    writeFileSync(`${target}.part`, body);
    renameSync(`${target}.part`, target);
    console.log(`portraits: downloaded and verified ${entry.file} (${entry.bytes} bytes, sha256 ${entry.sha256.slice(0, 12)}…)`);
  }
  console.log(`portraits: ${missing.length} downloaded, ${manifest.portraits.length - missing.length} already present; all ${manifest.portraits.length} verified`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  else main().catch((err) => {
    console.error(`portraits: ${err instanceof Error ? err.message : "failed"}. Build stopped.`);
    process.exit(1);
  });
}
