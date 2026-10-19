/**
 * Browser-side check of a recording before upload, so the person learns why a file will be refused without a round trip. It
 * mirrors the Worker's contract (backend/care-monitoring/worker/src/media.ts inspectWav) but the Worker stays the authority:
 * a file that passes here can still be refused there.
 */
export interface WavInfo {
  sampleRateHz: number;
  durationMs: number;
}

export interface WavLimits {
  sampleRatesHz: readonly number[];
  maxBytes: number;
  minDurationMs: number;
  maxDurationMs: number;
}

const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));

/** Returns the facts of a valid recording, or the Vietnamese reason it cannot be sent. */
export function inspectWav(bytes: Uint8Array, limits: WavLimits): WavInfo | string {
  if (bytes.byteLength > limits.maxBytes) return `Tệp quá lớn (tối đa ${(limits.maxBytes / 1_000_000).toFixed(1)} MB).`;
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return "Đây không phải tệp WAV (RIFF/WAVE).";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > bytes.byteLength) return "Tệp WAV bị cắt cụt.";
    if (id === "fmt " && size >= 16) fmt = { format: view.getUint16(body, true), channels: view.getUint16(body + 2, true), rate: view.getUint32(body + 4, true), bits: view.getUint16(body + 14, true) };
    if (id === "data") dataBytes = size;
    offset = body + size + (size % 2);
  }
  if (!fmt) return "Thiếu khối định dạng (fmt) của WAV.";
  if (dataBytes === null) return "Thiếu dữ liệu âm thanh (data).";
  if (fmt.format !== 1) return "Cần WAV PCM không nén.";
  if (fmt.channels !== 1) return "Cần âm thanh mono (1 kênh).";
  if (fmt.bits !== 16) return "Cần âm thanh 16-bit.";
  if (!limits.sampleRatesHz.includes(fmt.rate)) return `Thiết bị chỉ phát tốc độ lấy mẫu ${limits.sampleRatesHz.join(" / ")} Hz; tệp này là ${fmt.rate} Hz.`;
  const durationMs = Math.round((dataBytes / (fmt.rate * 2)) * 1000);
  if (durationMs < limits.minDurationMs) return `Âm thanh quá ngắn (tối thiểu ${limits.minDurationMs / 1000} giây).`;
  if (durationMs > limits.maxDurationMs) return `Âm thanh quá dài (tối đa ${limits.maxDurationMs / 1000} giây).`;
  return { sampleRateHz: fmt.rate, durationMs };
}

/** A new random key for one user intent (one confirm dialog, one form). Retries of that intent reuse it; a new intent gets a new one. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
