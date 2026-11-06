/**
 * Team and expert portraits (landing "Đội ngũ"): the files that `TEAM` in `src/features/landing/content.ts` names and that
 * `TeamSection` loads from `members/` at the project root. Pure helpers, shared by the build guard and its unit test.
 *
 * Why this exists: `members/` holds photos of real people and is not in git. A build from a checkout without it (for example
 * Vercel's automatic build of a push, 2026-11-06) still succeeds, but every portrait silently has no `src`. The build guard
 * turns that into a failed build, so such a build can never replace a working production deployment.
 */

/** Portrait file names listed in `TEAM` (core members and experts), in source order. */
export function teamPortraitFiles(contentSource: string): string[] {
  const start = contentSource.indexOf("export const TEAM = {");
  if (start < 0) throw new Error("export const TEAM not found in content.ts");
  const end = contentSource.indexOf("} as const;", start);
  if (end < 0) throw new Error("end of TEAM not found in content.ts");
  return [...contentSource.slice(start, end).matchAll(/\bfile:\s*"([^"]+)"/g)].map((m) => m[1]!.normalize("NFC"));
}

/** Listed files with no match among `available` names, compared like `portraitFor` (NFC, case-insensitive, base name only). */
export function missingPortraits(required: readonly string[], available: readonly string[]): string[] {
  const base = (n: string) => n.normalize("NFC").split(/[/\\]/).pop()!.toLowerCase();
  const have = new Set(available.map(base));
  return required.filter((f) => !have.has(base(f)));
}
