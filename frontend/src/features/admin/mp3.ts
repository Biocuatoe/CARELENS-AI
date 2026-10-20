/**
 * Browser-side check of an MP3 before upload (ADR-025), so the person learns why a file will be refused without a round trip
 * and sees what will actually be sent. The bytes decide, not the file name: every frame header is walked with the same rules
 * as the Worker (backend/care-monitoring/worker/src/media.ts inspectMp3) and the firmware (src/mp3.cpp). The Worker stays the
 * authority: a file that passes here can still be refused there. Nothing is decoded or converted in the browser; the file is
 * uploaded byte for byte and the device decodes it.
 */
export interface Mp3Limits {
  sampleRatesHz: readonly number[];
  maxBytes: number;
  minDurationMs: number;
  maxDurationMs: number;
}

export interface Mp3FileInfo {
  mpegVersion: 1 | 2 | 25;
  sampleRateHz: number;
  channels: 1 | 2;
  frames: number;
  durationMs: number;
  minKbps: number;
  maxKbps: number;
  hasTags: boolean;
}

/** MIME types browsers report for .mp3 files. An empty type (unknown to the OS) is left to the byte check. */
export const MP3_MIME_TYPES = ["audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3"] as const;

export const DEFAULT_MP3_LIMITS: Mp3Limits = {
  sampleRatesHz: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
  maxBytes: 2_000_000,
  minDurationMs: 500,
  maxDurationMs: 60_000,
};

const KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const RATES: Record<number, readonly number[]> = { 0: [11025, 12000, 8000], 2: [22050, 24000, 16000], 3: [44100, 48000, 32000] };

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const mb = (n: number) => `${(n / 1_000_000).toFixed(1).replace(".", ",")} MB`;

type Header = { versionBits: number; rate: number; channels: 1 | 2; kbps: number; bytes: number; samples: number; crc: boolean };

function header(b: Uint8Array, at: number): Header | string {
  const b0 = b[at] ?? 0, b1 = b[at + 1] ?? 0, b2 = b[at + 2] ?? 0, b3 = b[at + 3] ?? 0;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return "no_frame";
  const ver = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, br = b2 >> 4, sr = (b2 >> 2) & 3;
  if (ver === 1 || sr === 3 || br === 15 || layer === 0) return "Tệp có khung MP3 với giá trị không hợp lệ.";
  if (layer !== 1) return "Cần MP3 (MPEG Layer III); tệp này là MPEG Layer I hoặc II.";
  if (br === 0) return "Tệp dùng bitrate tự do (free format), thiết bị không phát loại này.";
  const rate = (RATES[ver] as readonly number[])[sr] as number;
  const kbps = (ver === 3 ? KBPS_V1 : KBPS_V2)[br] as number;
  return {
    versionBits: ver,
    rate,
    channels: b3 >> 6 === 3 ? 1 : 2,
    kbps,
    bytes: Math.floor(((ver === 3 ? 144_000 : 72_000) * kbps) / rate) + ((b2 >> 1) & 1),
    samples: ver === 3 ? 1152 : 576,
    crc: (b1 & 1) === 0,
  };
}

/** Returns the facts of a playable MP3, or the Vietnamese reason it cannot be sent. */
export function inspectMp3(bytes: Uint8Array, limits: Mp3Limits = DEFAULT_MP3_LIMITS): Mp3FileInfo | string {
  const len = bytes.byteLength;
  if (len > limits.maxBytes) return `Tệp ${mb(len)} lớn hơn giới hạn ${mb(limits.maxBytes)}.`;
  if (len >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return "Đây là tệp WAV. Lời nhắn giờ phải là tệp MP3.";
  if (len < 4) return "Tệp quá ngắn, không phải MP3.";
  let pos = 0;
  let hasTags = false;
  if (len >= 10 && ascii(bytes, 0, 3) === "ID3") {
    const s = [bytes[6], bytes[7], bytes[8], bytes[9]] as number[];
    const major = bytes[3] as number;
    const size = 10 + (((s[0] as number) << 21) | ((s[1] as number) << 14) | ((s[2] as number) << 7) | (s[3] as number)) + (((bytes[5] as number) & 0x10) ? 10 : 0);
    if (major < 2 || major > 4 || s.some((x) => x & 0x80) || size > len) return "Thẻ ID3 ở đầu tệp bị hỏng.";
    pos = size;
    hasTags = true;
  }
  let end = len;
  if (end - pos >= 128 && ascii(bytes, end - 128, 3) === "TAG") {
    end -= 128;
    hasTags = true;
  }
  if (end - pos >= 32 && ascii(bytes, end - 32, 8) === "APETAGEX") {
    const f = end - 32;
    const tag = new DataView(bytes.buffer, bytes.byteOffset + f + 12, 4).getUint32(0, true) + (((bytes[f + 23] as number) & 0x80) !== 0 ? 32 : 0);
    if (tag < 32 || tag > end - pos) return "Cuối tệp có dữ liệu lạ, không phải MP3.";
    end -= tag;
    hasTags = true;
  }
  while (pos < end && bytes[pos] === 0) pos++;
  const allZero = (from: number) => bytes.subarray(from, end).every((x) => x === 0);
  let first: Header | null = null;
  let frames = 0, pcm = 0, minKbps = 0, maxKbps = 0;
  while (pos < end) {
    if (end - pos < 4) {
      if (!allZero(pos)) return first ? "Cuối tệp có dữ liệu lạ, không phải MP3." : "Không tìm thấy khung MP3 nào. Tệp này không phải MP3.";
      break;
    }
    const h = header(bytes, pos);
    if (typeof h === "string") {
      if (!first) return h === "no_frame" ? "Không tìm thấy khung MP3 nào. Tệp này không phải MP3." : h;
      if (allZero(pos)) break;
      return h === "no_frame" ? "Cuối tệp có dữ liệu lạ, không phải MP3 (tệp ghép hoặc hỏng)." : h;
    }
    if (h.bytes > end - pos) return "Tệp MP3 bị cắt cụt (khung cuối không đủ).";
    if (!first) {
      first = h;
      minKbps = maxKbps = h.kbps;
      const side = h.versionBits === 3 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
      const at = pos + 4 + (h.crc ? 2 : 0) + side;
      const tag = at + 4 <= pos + h.bytes ? ascii(bytes, at, 4) : "";
      if (tag === "Xing" || tag === "Info" || (h.bytes >= 40 && ascii(bytes, pos + 36, 4) === "VBRI")) {
        pos += h.bytes;
        continue;
      }
    } else if (h.versionBits !== first.versionBits || h.rate !== first.rate || h.channels !== first.channels) {
      return "Tốc độ lấy mẫu hoặc số kênh thay đổi giữa chừng (tệp ghép). Hãy xuất lại thành một tệp MP3 liền.";
    }
    minKbps = Math.min(minKbps, h.kbps);
    maxKbps = Math.max(maxKbps, h.kbps);
    frames++;
    pcm += h.samples;
    pos += h.bytes;
  }
  if (!first || frames === 0) return "Không tìm thấy khung MP3 nào. Tệp này không phải MP3.";
  if (!limits.sampleRatesHz.includes(first.rate)) return `Tốc độ lấy mẫu ${first.rate} Hz chưa được kiểm trên thiết bị (được: ${limits.sampleRatesHz.join(" / ")} Hz).`;
  const durationMs = Math.floor((pcm * 1000) / first.rate);
  if (durationMs < limits.minDurationMs) return `Âm thanh quá ngắn (tối thiểu ${limits.minDurationMs / 1000} giây).`;
  if (durationMs > limits.maxDurationMs) return `Âm thanh quá dài (tối đa ${limits.maxDurationMs / 1000} giây).`;
  return { mpegVersion: first.versionBits === 3 ? 1 : first.versionBits === 2 ? 2 : 25, sampleRateHz: first.rate, channels: first.channels, frames, durationMs, minKbps, maxKbps, hasTags };
}

/** The MIME type the browser reports is a hint only, but a file it calls WAV or anything else non-MP3 is refused up front. */
export function mimeProblem(type: string): string | null {
  const t = type.toLowerCase();
  if (t === "" || (MP3_MIME_TYPES as readonly string[]).includes(t)) return null;
  if (t.includes("wav")) return "Đây là tệp WAV. Lời nhắn giờ phải là tệp MP3.";
  return `Tệp này có kiểu ${t}; cần tệp MP3 (audio/mpeg).`;
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(".", ",")} KB`;
  return `${(n / 1_000_000).toFixed(2).replace(".", ",")} MB`;
}

/** "MP3 · MPEG-2 · 16 kHz · mono · 32 kbps" */
export function describeMp3(i: Mp3FileInfo): string {
  const khz = `${(i.sampleRateHz / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 3 })} kHz`;
  const kbps = i.minKbps === i.maxKbps ? `${i.minKbps} kbps` : `${i.minKbps}–${i.maxKbps} kbps (VBR)`;
  return `MP3 · MPEG-${i.mpegVersion === 25 ? "2.5" : i.mpegVersion} · ${khz} · ${i.channels === 1 ? "mono" : "stereo"} · ${kbps}`;
}
