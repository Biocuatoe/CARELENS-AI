/**
 * Build guard: `vite build` fails when a team or expert portrait named in `TEAM` is missing from `members/`, is not the
 * original (SHA-256 in team-portraits.manifest.json, A47), or was not emitted into the bundle. Build only; the dev server
 * and tests are unaffected (the landing unit tests check the images themselves). It never changes the output, it only stops
 * a build that would publish broken or substituted portraits.
 */
import type { Plugin } from "vite";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { manifestProblems, missingPortraits, teamPortraitFiles, type PortraitManifest } from "./team-portraits";

export function teamPortraitsGuard(frontendRoot: string): Plugin {
  const contentPath = resolve(frontendRoot, "src/features/landing/content.ts");
  const manifestPath = resolve(frontendRoot, "scripts/team-portraits.manifest.json");
  const membersDir = resolve(frontendRoot, "../members");
  let required: string[] = [];
  return {
    name: "team-portraits-guard",
    apply: "build",
    buildStart() {
      required = teamPortraitFiles(readFileSync(contentPath, "utf8"));
      if (required.length === 0) this.error("team-portraits-guard: TEAM in content.ts lists no portrait files.");
      const available = existsSync(membersDir) ? readdirSync(membersDir) : [];
      const missing = missingPortraits(required, available);
      if (missing.length > 0) {
        this.error(
          `team-portraits-guard: ${missing.length} of ${required.length} team/expert portraits are missing from ${membersDir}: ` +
            `${missing.join(", ")}. The photos are not in git (real people): \`npm run build\` provides them first ` +
            `(scripts/fetch-team-portraits.mjs, docs/DEPLOYMENT_RUNBOOK.md §17.0c); never publish a build without them.`,
        );
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PortraitManifest;
      const problems = manifestProblems(required, manifest);
      if (problems.length > 0) this.error(`team-portraits-guard: team-portraits.manifest.json does not match TEAM: ${problems.join("; ")}.`);
      const byName = new Map(available.map((n) => [n.normalize("NFC").toLowerCase(), n]));
      const differ = manifest.portraits.filter((p) => {
        const actual = byName.get(p.file.normalize("NFC").toLowerCase());
        return !actual || createHash("sha256").update(readFileSync(join(membersDir, actual))).digest("hex") !== p.sha256;
      });
      if (differ.length > 0) {
        this.error(`team-portraits-guard: not the original photo (SHA-256 differs from team-portraits.manifest.json): ${differ.map((p) => p.file).join(", ")}.`);
      }
    },
    generateBundle(_options, bundle) {
      const emitted = Object.values(bundle).flatMap((c) => (c.type === "asset" ? (c.names?.length ? c.names : c.name ? [c.name] : []) : []));
      const missing = missingPortraits(required, emitted);
      if (missing.length > 0) this.error(`team-portraits-guard: portraits not emitted into the bundle: ${missing.join(", ")}.`);
    },
  };
}
