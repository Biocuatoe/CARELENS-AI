import { describe, expect, it } from "vitest";
import { activityCsv, csvCell } from "./csv";
import { inspectWav, newIdempotencyKey, type WavLimits } from "./wav";
import { localDateKey } from "../../lib/time";

const LIMITS: WavLimits = { sampleRatesHz: [16000], maxBytes: 2_200_000, minDurationMs: 500, maxDurationMs: 60_000 };

function wav(opts: { rate?: number; channels?: number; bits?: number; seconds?: number; format?: number; riff?: string } = {}): Uint8Array {
  const { rate = 16000, channels = 1, bits = 16, seconds = 1, format = 1, riff = "RIFF" } = opts;
  const data = Math.round(rate * seconds * (bits / 8) * channels);
  const buf = new Uint8Array(44 + data);
  const v = new DataView(buf.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, riff);
  v.setUint32(4, 36 + data, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, format, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * (bits / 8) * channels, true);
  v.setUint16(32, (bits / 8) * channels, true);
  v.setUint16(34, bits, true);
  s(36, "data");
  v.setUint32(40, data, true);
  return buf;
}

describe("inspectWav", () => {
  it("accepts a recording the device can play and reports its length", () => {
    expect(inspectWav(wav({ seconds: 2 }), LIMITS)).toEqual({ sampleRateHz: 16000, durationMs: 2000 });
  });

  it("explains each way a file cannot be played", () => {
    const cases: Array<[string, Uint8Array, RegExp]> = [
      ["not a wav", new TextEncoder().encode("hello world, this is not audio data at all, no way"), /không phải tệp WAV/],
      ["wrong rate", wav({ rate: 44100 }), /16000 Hz; tệp này là 44100 Hz/],
      ["stereo", wav({ channels: 2 }), /mono/],
      ["8-bit", wav({ bits: 8 }), /16-bit/],
      ["compressed", wav({ format: 3 }), /PCM không nén/],
      ["too short", wav({ seconds: 0.1 }), /quá ngắn/],
      ["too long", wav({ seconds: 61 }), /quá dài/],
      ["too large", new Uint8Array(2_300_000), /quá lớn/],
    ];
    for (const [name, bytes, message] of cases) expect(inspectWav(bytes, LIMITS), name).toMatch(message);
  });

  it("rejects a truncated file instead of reading past its end", () => {
    const full = wav();
    expect(inspectWav(full.subarray(0, 100), LIMITS)).toMatch(/cắt cụt/);
  });
});

describe("csv", () => {
  it("quotes every cell and neutralises anything a spreadsheet would run as a formula", () => {
    expect(csvCell("plain")).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    for (const evil of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"]) expect(csvCell(evil)).toBe(`"'${evil.replaceAll('"', '""')}"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell({ a: "=x" })).toBe('"{""a"":""=x""}"'); // objects are JSON, which starts with a brace
  });

  it("writes one row per entry with a header, local and UTC times, and only the report's own fields", () => {
    const csv = activityCsv([{ at: "2026-10-19T02:58:00.000Z", source: "captures", kind: "capture", refId: "cap-1", sourceMode: "simulated", status: "processed", detail: { frame_count: 24 } }]);
    const lines = csv.slice(1).split("\r\n").filter(Boolean);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]).toBe('"time_local","time_utc","source","kind","status","source_mode","ref_id","detail_json"');
    expect(lines[1]).toContain('"2026-10-19 09:58:00"'); // 02:58Z is 09:58 in Vietnam
    expect(lines[1]).toContain('"2026-10-19T02:58:00.000Z"');
    expect(lines[1]).toContain('"simulated"');
    expect(lines).toHaveLength(2);
  });
});

describe("local date", () => {
  it("is the calendar date in Vietnam whatever the browser's zone", () => {
    expect(localDateKey(new Date("2026-10-19T16:59:59.999Z"))).toBe("2026-10-19");
    expect(localDateKey(new Date("2026-10-19T17:00:00.000Z"))).toBe("2026-10-20");
    expect(localDateKey(new Date("2026-12-31T17:00:00.000Z"))).toBe("2027-01-01");
  });
});

describe("idempotency keys", () => {
  it("are long enough for the server and differ between intents", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toBe(b);
  });
});
