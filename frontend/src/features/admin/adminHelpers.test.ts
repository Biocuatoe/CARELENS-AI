import { describe, expect, it } from "vitest";
import { activityCsv, csvCell } from "./csv";
import { newIdempotencyKey } from "./idempotency";
import { DEFAULT_MP3_LIMITS, describeMp3, formatBytes, inspectMp3, mimeProblem, type Mp3FileInfo } from "./mp3";
import { LAME_16K_MONO, mp3, mp3Frame, wav } from "./testAudio";
import { localDateKey } from "../../lib/time";

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};

describe("inspectMp3 (ADR-025)", () => {
  it("reads real LAME output with the Worker's and the firmware's numbers", () => {
    expect(inspectMp3(LAME_16K_MONO)).toEqual({ mpegVersion: 2, sampleRateHz: 16000, channels: 1, frames: 30, durationMs: 1080, minKbps: 32, maxKbps: 32, hasTags: false });
  });

  it("accepts every tested rate and layout, and mixed bitrates", () => {
    for (const rate of DEFAULT_MP3_LIMITS.sampleRatesHz) {
      for (const channels of [1, 2] as const) expect(inspectMp3(mp3({ rate, channels })), `${rate}/${channels}`).toMatchObject({ sampleRateHz: rate, channels });
    }
    expect(inspectMp3(cat(mp3({ rate: 44100, kbps: 128, seconds: 0.5 }), mp3({ rate: 44100, kbps: 320, seconds: 0.5 })))).toMatchObject({ minKbps: 128, maxKbps: 320 });
  });

  it("explains each way a file cannot be sent, in Vietnamese", () => {
    const cases: Array<[string, Uint8Array, RegExp]> = [
      ["a WAV file", wav(), /tệp WAV\. Lời nhắn giờ phải là tệp MP3/],
      ["not audio", new TextEncoder().encode("hello world, this is not audio data at all, no way"), /không phải MP3/],
      ["Layer II", cat(mp3Frame(44100, 2, 128, 2), mp3Frame(44100, 2, 128, 2)), /Layer I hoặc II/],
      ["spliced", cat(mp3({ rate: 16000 }), mp3({ rate: 44100, channels: 2 })), /thay đổi giữa chừng/],
      ["truncated", LAME_16K_MONO.subarray(0, LAME_16K_MONO.length - 40), /cắt cụt/],
      ["trailing junk", cat(LAME_16K_MONO, new TextEncoder().encode("junkjunk")), /dữ liệu lạ/],
      ["too short", mp3({ seconds: 0.3 }), /quá ngắn/],
      ["too long", mp3({ seconds: 61 }), /quá dài/],
      ["too large", new Uint8Array(2_100_000), /lớn hơn giới hạn/],
    ];
    for (const [name, bytes, message] of cases) expect(inspectMp3(bytes), name).toMatch(message);
    expect(inspectMp3(mp3({ rate: 44100 }), { ...DEFAULT_MP3_LIMITS, sampleRatesHz: [16000] })).toMatch(/44100 Hz chưa được kiểm/);
  });

  it("judges the browser's MIME type only as a first hint: WAV and other types are refused, MP3 and unknown pass to the byte check", () => {
    for (const ok of ["audio/mpeg", "audio/mp3", "AUDIO/MPEG", ""]) expect(mimeProblem(ok), ok).toBeNull();
    expect(mimeProblem("audio/wav")).toMatch(/tệp WAV/);
    expect(mimeProblem("audio/x-wav")).toMatch(/tệp WAV/);
    expect(mimeProblem("audio/ogg")).toMatch(/audio\/ogg; cần tệp MP3/);
  });

  it("describes a file for the person choosing it", () => {
    const info = inspectMp3(mp3({ rate: 44100, channels: 2, kbps: 128 })) as Mp3FileInfo;
    expect(describeMp3(info)).toBe("MP3 · MPEG-1 · 44,1 kHz · stereo · 128 kbps");
    expect(describeMp3({ ...info, mpegVersion: 25, sampleRateHz: 11025, channels: 1, minKbps: 16, maxKbps: 64 })).toBe("MP3 · MPEG-2.5 · 11,025 kHz · mono · 16–64 kbps (VBR)");
    expect([formatBytes(900), formatBytes(4320), formatBytes(1_234_567)]).toEqual(["900 B", "4,3 KB", "1,23 MB"]);
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
