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

/** Voice message format contract: RIFF/WAVE, PCM (format 1), mono, 16-bit little-endian, 0.5–60 s,
 * ≤ 2.2 MB. Chosen so the future firmware can stream it to an I2S DAC without decoding. The sample rates
 * accepted for upload are the device profile DEVICE_AUDIO_SAMPLE_RATES (default 16000 only), a subset of
 * `sampleRates`: a recording the device cannot play is refused at upload, never accepted silently. */
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
