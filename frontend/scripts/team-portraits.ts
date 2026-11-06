/**
 * Team and expert portraits (landing "Đội ngũ"): the files that `TEAM` in `src/features/landing/content.ts` names and that
 * `TeamSection` loads from `members/` at the project root. Pure helpers, shared by the build guard and its unit test.
 *
 * Why this exists: `members/` holds photos of real people and is not in git. A build from a checkout without it (for example
 * Vercel's automatic build of a push, 2026-11-06) still succeeds, but every portrait silently has no `src`. The build guard
 * turns that into a failed build, so such a build can never replace a working production deployment (A46). The originals
 * are pinned by SHA-256 in `team-portraits.manifest.json`; Vercel builds fetch them from a private bucket (A47).
 */

export interface PortraitManifestEntry {
  file: string;
  sha256: string;
  bytes: number;
}

export interface PortraitManifest {
  /** S3 API endpoint of the account (not a secret). */
  endpoint: string;
  bucket: string;
  keyPrefix: string;
  portraits: PortraitManifestEntry[];
}

/** Portrait file names listed in `TEAM` (core members and experts), in source order. */
export function teamPortraitFiles(contentSource: string): string[] {
  const start = contentSource.indexOf("export const TEAM = {");
  if (start < 0) throw new Error("export const TEAM not found in content.ts");
  const end = contentSource.indexOf("} as const;", start);
  if (end < 0) throw new Error("end of TEAM not found in content.ts");
  return [...contentSource.slice(start, end).matchAll(/\bfile:\s*"([^"]+)"/g)].map((m) => m[1]!.normalize("NFC"));
}

const baseName = (n: string) => n.normalize("NFC").split(/[/\\]/).pop()!.toLowerCase();

/** Listed files with no match among `available` names, compared like `portraitFor` (NFC, case-insensitive, base name only). */
export function missingPortraits(required: readonly string[], available: readonly string[]): string[] {
  const have = new Set(available.map(baseName));
  return required.filter((f) => !have.has(baseName(f)));
}

/** Problems that make the manifest unusable for `required` (TEAM): entries missing, extra, duplicated or malformed. */
export function manifestProblems(required: readonly string[], manifest: PortraitManifest): string[] {
  const problems: string[] = [];
  const listed = manifest.portraits.map((p) => baseName(p.file));
  for (const f of required) if (!listed.includes(baseName(f))) problems.push(`not in manifest: ${f}`);
  for (const p of manifest.portraits) {
    if (!required.some((f) => baseName(f) === baseName(p.file))) problems.push(`in manifest but not in TEAM: ${p.file}`);
    if (!/^[0-9a-f]{64}$/.test(p.sha256)) problems.push(`bad sha256 for ${p.file}`);
    if (!Number.isInteger(p.bytes) || p.bytes <= 0) problems.push(`bad size for ${p.file}`);
  }
  if (new Set(listed).size !== listed.length) problems.push("duplicate file in manifest");
  return problems;
}
