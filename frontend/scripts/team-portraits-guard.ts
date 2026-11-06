/**
 * Build guard: `vite build` fails when a team or expert portrait named in `TEAM` is missing from `members/`, or was not
 * emitted into the bundle. Build only; the dev server and tests are unaffected (the landing unit tests check the images
 * themselves). It never changes the output, it only stops a build that would publish broken portraits.
 */
import type { Plugin } from "vite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { missingPortraits, teamPortraitFiles } from "./team-portraits";

export function teamPortraitsGuard(frontendRoot: string): Plugin {
  const contentPath = resolve(frontendRoot, "src/features/landing/content.ts");
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
            `${missing.join(", ")}. The photos are not in git (real people): build from a checkout that has members/ ` +
            `(docs/DEPLOYMENT_RUNBOOK.md, frontend deploy), never publish a build without them.`,
        );
      }
    },
    generateBundle(_options, bundle) {
      const emitted = Object.values(bundle).flatMap((c) => (c.type === "asset" ? (c.names?.length ? c.names : c.name ? [c.name] : []) : []));
      const missing = missingPortraits(required, emitted);
      if (missing.length > 0) this.error(`team-portraits-guard: portraits not emitted into the bundle: ${missing.join(", ")}.`);
    },
  };
}
