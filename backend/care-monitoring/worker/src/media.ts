/**
 * Byte-level validation of camera frames and voice audio. Only headers are parsed; pixels and samples
 * are never decoded, logged or copied into the database.
 */

/** Limits of the local Vision package (readme §8): per frame ≤ 200 000 bytes and ≤ 640×480. */
export const MAX_FRAME_BYTES = 200_000;
export const MAX_FRAME_WIDTH = 640;
export const MAX_FRAME_HEIGHT = 480;

export interface JpegInfo {
  width: number;
  height: number;
}

/** Validates SOI, walks marker segments up to the first SOF to read dimensions, and requires EOI at the
 * end (trailing zero padding tolerated). Returns null for anything that is not a well-formed baseline or
 * progressive JPEG header. */
export function inspectJpeg(bytes: Uint8Array): JpegInfo | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let end = bytes.length;
  while (end > 2 && bytes[end - 1] === 0x00) end--;
  if (bytes[end - 2] !== 0xff || bytes[end - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 4 <= end) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1] ?? 0;
    while (marker === 0xff && i + 2 < end) {
      i++;
      marker = bytes[i + 1] ?? 0;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (length < 2 || i + 2 + length > end) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 7) return null;
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      if (width === 0 || height === 0) return null;
      return { width, height };
    }
    if (marker === 0xda || marker === 0xd9) return null; // scan data before any frame header
    i += 2 + length;
  }
  return null;
}

export interface PackedFrame {
  bytes: Uint8Array;
}

/** Parses the Vision package body format: repeated [uint32 little-endian length][JPEG bytes]. */
export function unpackFrames(body: Uint8Array, maxFrames: number): Uint8Array[] | string {
  const frames: Uint8Array[] = [];
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let i = 0;
  while (i < body.length) {
    if (i + 4 > body.length) return "truncated length prefix";
    const n = view.getUint32(i, true);
    if (n === 0 || n > MAX_FRAME_BYTES) return `frame ${frames.length} length ${n} outside 1..${MAX_FRAME_BYTES}`;
    if (i + 4 + n > body.length) return `frame ${frames.length} truncated`;
    frames.push(body.subarray(i + 4, i + 4 + n));
    i += 4 + n;
    if (frames.length > maxFrames) return `more than ${maxFrames} frames`;
  }
  return frames;
}

/* ------------------------------------------------------------------ voice audio */

/** Voice message upload format (ADR-025): MP3, MPEG-1/2/2.5 Layer III, one sample rate and one channel layout for the
 * whole stream, CBR or VBR, 0.5–60 s, ≤ 2 MB. Stored, delivered and downloaded unchanged: the device decodes it itself
 * (firmware ≥ carelens-fw-0.2.0, which reports `audio_codecs` in its heartbeat). The sample rates are those the device's
 * decoder and I2S output were tested with; validation is a header walk of every frame, mirrored by the firmware
 * (firmware/carelens-esp32s3/src/mp3.cpp), so a truncated, padded or spliced file is refused here first. */
export const MP3_CONTRACT = {
  contentType: "audio/mpeg",
  codec: "mp3",
  sampleRates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000],
  channels: [1, 2],
  minDurationMs: 500,
  maxDurationMs: 60_000,
  maxBytes: 2_000_000,
} as const;

export interface Mp3Info {
  mpegVersion: 1 | 2 | 25;
  sampleRateHz: number;
  channels: 1 | 2;
  frames: number;
  pcmFrames: number;
  durationMs: number;
  minKbps: number;
  maxKbps: number;
  hasId3v2: boolean;
  hasTailTag: boolean;
  hasVbrHeader: boolean;
}

const KBPS_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const KBPS_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_RATES: Record<number, readonly number[]> = { 0: [11025, 12000, 8000], 2: [22050, 24000, 16000], 3: [44100, 48000, 32000] };

type Mp3Header = { versionBits: number; rate: number; channels: 1 | 2; kbps: number; bytes: number; samples: number; crc: boolean };

function mp3Header(b: Uint8Array, at: number): Mp3Header | string {
  const b0 = b[at] ?? 0, b1 = b[at + 1] ?? 0, b2 = b[at + 2] ?? 0, b3 = b[at + 3] ?? 0;
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return "mp3_no_frame";
  const ver = (b1 >> 3) & 3, layer = (b1 >> 1) & 3, br = b2 >> 4, sr = (b2 >> 2) & 3;
  if (ver === 1 || sr === 3 || br === 15 || layer === 0) return "mp3_bad_header";
  if (layer !== 1) return "mp3_not_layer3";
  if (br === 0) return "mp3_free_format";
  const rate = (MP3_RATES[ver] as readonly number[])[sr] as number;
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

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** Same rules and error codes as the firmware's inspectMp3: optional ID3v2 tag first, optional APEv2/ID3v1 tags last,
 * zero padding tolerated, and every other byte inside a complete Layer III frame of the first frame's version, rate and
 * channel layout. A Xing/Info/VBRI frame is metadata and not counted. Then the contract's rate and duration limits. */
export function inspectMp3(bytes: Uint8Array, allowedRates: readonly number[] = MP3_CONTRACT.sampleRates): Mp3Info | string {
  const len = bytes.length;
  if (len < 4) return "mp3_too_short";
  let pos = 0;
  let hasId3v2 = false;
  if (len >= 10 && ascii(bytes, 0, 3) === "ID3") {
    const major = bytes[3] as number, flags = bytes[5] as number;
    const s = [bytes[6], bytes[7], bytes[8], bytes[9]] as number[];
    if (major < 2 || major > 4 || s.some((x) => x & 0x80)) return "mp3_bad_id3";
    const tag = 10 + ((s[0] as number) << 21 | (s[1] as number) << 14 | (s[2] as number) << 7 | (s[3] as number)) + (flags & 0x10 ? 10 : 0);
    if (tag > len) return "mp3_bad_id3";
    pos = tag;
    hasId3v2 = true;
  }
  let end = len;
  let hasTailTag = false;
  if (end - pos >= 128 && ascii(bytes, end - 128, 3) === "TAG") {
    end -= 128;
    hasTailTag = true;
  }
  if (end - pos >= 32 && ascii(bytes, end - 32, 8) === "APETAGEX") {
    const f = end - 32;
    const size = new DataView(bytes.buffer, bytes.byteOffset + f + 12, 4).getUint32(0, true);
    const tag = size + (((bytes[f + 23] as number) & 0x80) !== 0 ? 32 : 0);
    if (tag < 32 || tag > end - pos) return "mp3_trailing_data";
    end -= tag;
    hasTailTag = true;
  }
  while (pos < end && bytes[pos] === 0) pos++;
  const allZero = (from: number) => bytes.subarray(from, end).every((x) => x === 0);
  let first: Mp3Header | null = null;
  let frames = 0, pcmFrames = 0, minKbps = 0, maxKbps = 0, hasVbrHeader = false;
  while (pos < end) {
    if (end - pos < 4) {
      if (!allZero(pos)) return first ? "mp3_trailing_data" : "mp3_no_frame";
      break;
    }
    const h = mp3Header(bytes, pos);
    if (typeof h === "string") {
      if (!first) return h;
      if (allZero(pos)) break;
      return h === "mp3_no_frame" ? "mp3_trailing_data" : h;
    }
    if (h.bytes > end - pos) return "mp3_truncated_frame";
    if (!first) {
      first = h;
      minKbps = maxKbps = h.kbps;
      const side = h.versionBits === 3 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
      const at = pos + 4 + (h.crc ? 2 : 0) + side;
      const tag = at + 4 <= pos + h.bytes ? ascii(bytes, at, 4) : "";
      if (tag === "Xing" || tag === "Info" || (40 <= h.bytes && ascii(bytes, pos + 36, 4) === "VBRI")) {
        hasVbrHeader = true;
        pos += h.bytes;
        continue;
      }
    } else if (h.versionBits !== first.versionBits || h.rate !== first.rate || h.channels !== first.channels) {
      return "mp3_format_changed";
    }
    minKbps = Math.min(minKbps, h.kbps);
    maxKbps = Math.max(maxKbps, h.kbps);
    frames++;
    pcmFrames += h.samples;
    pos += h.bytes;
  }
  if (!first || frames === 0) return "mp3_no_frame";
  if (!allowedRates.includes(first.rate)) return `sample rate ${first.rate} Hz is not one the device was tested with (${allowedRates.join(", ")} Hz)`;
  const durationMs = Math.floor((pcmFrames * 1000) / first.rate);
  if (durationMs < MP3_CONTRACT.minDurationMs || durationMs > MP3_CONTRACT.maxDurationMs) {
    return `duration ${durationMs} ms outside ${MP3_CONTRACT.minDurationMs}–${MP3_CONTRACT.maxDurationMs} ms`;
  }
  return {
    mpegVersion: first.versionBits === 3 ? 1 : first.versionBits === 2 ? 2 : 25,
    sampleRateHz: first.rate,
    channels: first.channels,
    frames,
    pcmFrames,
    durationMs,
    minKbps,
    maxKbps,
    hasId3v2,
    hasTailTag,
    hasVbrHeader,
  };
}

/** Legacy voice message format (before ADR-025): RIFF/WAVE, PCM (format 1), mono, 16-bit little-endian, 0.5–60 s,
 * ≤ 2.2 MB, a rate of the device profile DEVICE_AUDIO_SAMPLE_RATES. New uploads must be MP3; recordings stored in this
 * format stay playable (the firmware still plays pcm_s16le) and are delivered with their own codec, never as MP3. */
export const AUDIO_CONTRACT = {
  contentType: "audio/wav",
  sampleRates: [8000, 16000, 22050, 24000],
  channels: 1,
  bitsPerSample: 16,
  minDurationMs: 500,
  maxDurationMs: 60_000,
  maxBytes: 2_200_000,
} as const;

export interface WavInfo {
  sampleRateHz: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
}

export function inspectWav(bytes: Uint8Array, allowedRates: readonly number[] = AUDIO_CONTRACT.sampleRates): WavInfo | string {
  const ascii = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (bytes.length < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") return "not a RIFF/WAVE file";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number; blockAlign: number } | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= bytes.length) {
    const id = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.length) return `chunk ${id} truncated`;
    if (id === "fmt ") {
      if (size < 16) return "fmt chunk too small";
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        rate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
        blockAlign: view.getUint16(body + 12, true),
      };
    } else if (id === "data") {
      dataBytes = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!fmt) return "missing fmt chunk";
  if (dataBytes === null) return "missing data chunk";
  if (fmt.format !== 1) return "audio must be uncompressed PCM (format 1)";
  if (fmt.channels !== AUDIO_CONTRACT.channels) return "audio must be mono";
  if (fmt.bits !== AUDIO_CONTRACT.bitsPerSample) return "audio must be 16-bit";
  if (!allowedRates.includes(fmt.rate)) return `sample rate ${fmt.rate} Hz not supported by the device profile (${allowedRates.join(", ")} Hz)`;
  if (fmt.blockAlign !== 2) return "unexpected block alignment";
  const durationMs = Math.round((dataBytes / 2 / fmt.rate) * 1000);
  if (durationMs < AUDIO_CONTRACT.minDurationMs || durationMs > AUDIO_CONTRACT.maxDurationMs) {
    return `duration ${durationMs} ms outside ${AUDIO_CONTRACT.minDurationMs}–${AUDIO_CONTRACT.maxDurationMs} ms`;
  }
  return { sampleRateHz: fmt.rate, channels: fmt.channels, bitsPerSample: fmt.bits, durationMs };
}
