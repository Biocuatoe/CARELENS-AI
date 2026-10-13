// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Màu landing đọc thẳng từ tokens.css để test không lệch khỏi nguồn thật. */
const css = readFileSync(resolve(process.cwd(), "src/design-system/tokens.css"), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`thiếu token ${name}`);
  return m[1]!;
};

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const over = (fg: RGB, alpha: number, bg: RGB): RGB => fg.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as RGB;
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const c = {
  midnight: toRgb(token("midnight")),
  graphite: toRgb(token("graphite")),
  tealDeep: toRgb(token("teal-deep")),
  signal: toRgb(token("signal")),
  mint: toRgb(token("mint")),
  ivory: toRgb(token("ivory")),
  paper: toRgb(token("paper")),
  ink: toRgb(token("ink")),
};

describe("bảng màu landing", () => {
  it("giữ nguyên tám giá trị người dùng đã chọn", () => {
    expect(token("midnight").toLowerCase()).toBe("#14232d");
    expect(token("graphite").toLowerCase()).toBe("#233642");
    expect(token("teal-deep").toLowerCase()).toBe("#245f5a");
    expect(token("signal").toLowerCase()).toBe("#55b9a8");
    expect(token("mint").toLowerCase()).toBe("#b0e4d8");
    expect(token("ivory").toLowerCase()).toBe("#f2f0e9");
    expect(token("paper").toLowerCase()).toBe("#fafbf8");
    expect(token("ink").toLowerCase()).toBe("#26363e");
  });

  // Các cặp chữ/nền thực sự dùng trong landing, kể cả độ mờ nhỏ nhất đã dùng cho chữ. Chữ thường cần ≥ 4,5.
  const pairs: Array<[string, RGB, number, RGB]> = [
    ["ivory trên midnight", c.ivory, 1, c.midnight],
    ["ivory/85 trên midnight", c.ivory, 0.85, c.midnight],
    ["ivory/75 trên midnight", c.ivory, 0.75, c.midnight],
    ["ivory/75 trên graphite", c.ivory, 0.75, c.graphite],
    ["ivory/80 trên graphite", c.ivory, 0.8, c.graphite],
    ["mint trên midnight", c.mint, 1, c.midnight],
    ["mint trên graphite", c.mint, 1, c.graphite],
    ["signal trên midnight", c.signal, 1, c.midnight],
    ["signal trên graphite", c.signal, 1, c.graphite],
    ["midnight trên signal (nút chính)", c.midnight, 1, c.signal],
    ["midnight trên mint (nút khi rê chuột)", c.midnight, 1, c.mint],
    ["ink trên ivory", c.ink, 1, c.ivory],
    ["ink/85 trên ivory", c.ink, 0.85, c.ivory],
    ["ink/75 trên ivory", c.ink, 0.75, c.ivory],
    ["ink/75 trên paper", c.ink, 0.75, c.paper],
    ["teal-deep trên ivory", c.tealDeep, 1, c.ivory],
    ["teal-deep trên paper", c.tealDeep, 1, c.paper],
    ["paper trên teal-deep (nút chính nền sáng)", c.paper, 1, c.tealDeep],
    ["paper trên midnight (nút khi rê chuột nền sáng)", c.paper, 1, c.midnight],
  ];
  it.each(pairs)("%s đạt tương phản 4,5:1", (_name, fg, alpha, bg) => {
    expect(ratio(over(fg, alpha, bg), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("signal và mint không đủ tương phản làm chữ trên nền sáng (nên không được dùng như vậy)", () => {
    expect(ratio(c.signal, c.ivory)).toBeLessThan(3);
    expect(ratio(c.mint, c.ivory)).toBeLessThan(3);
  });
});
