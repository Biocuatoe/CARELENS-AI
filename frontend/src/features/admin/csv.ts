/**
 * CSV for the daily activity report. Every cell is quoted, and a cell that a spreadsheet could read as a formula (leading = + - @,
 * tab or carriage return) is prefixed with an apostrophe, so a value that came from the device or the database can never execute
 * when the file is opened. The file holds exactly the fields the report API returned: no media, no credentials.
 */
import type { ActivityEntry } from "../../data/admin/adminClient";
import { DISPLAY_TIMEZONE } from "../../lib/time";

const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const localFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: DISPLAY_TIMEZONE, dateStyle: "short", timeStyle: "medium" });

export const CSV_HEADER = ["time_local", "time_utc", "source", "kind", "status", "source_mode", "ref_id", "detail_json"] as const;

export function activityCsv(entries: ActivityEntry[]): string {
  const lines = [CSV_HEADER.map(csvCell).join(",")];
  for (const e of entries) {
    lines.push([localFmt.format(new Date(e.at)), e.at, e.source, e.kind, e.status, e.sourceMode, e.refId, e.detail].map(csvCell).join(","));
  }
  // CRLF and a BOM so Excel reads the Vietnamese text as UTF-8.
  return `${BOM}${lines.join("\r\n")}\r\n`;
}
