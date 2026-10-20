/**
 * Test-only audio for the admin UI tests (ADR-025). `mp3()` builds valid MPEG Layer III frames with a silent payload (the UI,
 * like the Worker, only walks frame headers); `LAME_16K_MONO` is a real file made by LAME (firmware/carelens-esp32s3
 * test fixture, a synthetic 440 Hz tone, no voice); `wav()` is the old format that is now refused.
 */
const RATES: Record<number, { versionBits: number; index: number }> = {
  44100: { versionBits: 3, index: 0 },
  48000: { versionBits: 3, index: 1 },
  32000: { versionBits: 3, index: 2 },
  22050: { versionBits: 2, index: 0 },
  24000: { versionBits: 2, index: 1 },
  16000: { versionBits: 2, index: 2 },
  11025: { versionBits: 0, index: 0 },
  12000: { versionBits: 0, index: 1 },
  8000: { versionBits: 0, index: 2 },
};
const V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

export function mp3Frame(rate: number, channels: 1 | 2, kbps: number, layer = 1): Uint8Array {
  const r = RATES[rate];
  if (!r) throw new Error(`no MP3 rate ${rate}`);
  const br = (r.versionBits === 3 ? V1 : V2).indexOf(kbps);
  const f = new Uint8Array(Math.floor(((r.versionBits === 3 ? 144_000 : 72_000) * kbps) / rate));
  f[0] = 0xff;
  f[1] = 0xe0 | (r.versionBits << 3) | (layer << 1) | 1;
  f[2] = (br << 4) | (r.index << 2);
  f[3] = channels === 1 ? 0xc0 : 0x40;
  return f;
}

export function mp3(opts: { seconds?: number; rate?: number; channels?: 1 | 2; kbps?: number } = {}): Uint8Array {
  const { seconds = 1, rate = 16000, channels = 1, kbps = rate >= 32000 ? 128 : 32 } = opts;
  const frame = mp3Frame(rate, channels, kbps);
  const count = Math.ceil((seconds * rate) / (rate >= 32000 ? 1152 : 576));
  const out = new Uint8Array(frame.length * count);
  for (let i = 0; i < count; i++) out.set(frame, i * frame.length);
  return out;
}

const bin = atob("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");
/** LAME, MPEG-2 Layer III, 16 kHz mono, 32 kbps, 30 frames = 1080 ms, 4320 bytes. */
export const LAME_16K_MONO = Uint8Array.from(bin, (c) => c.charCodeAt(0));

export function wav(seconds = 1, rate = 16000, channels = 1): Uint8Array {
  const data = Math.round(rate * seconds) * 2 * channels;
  const buf = new Uint8Array(44 + data);
  const v = new DataView(buf.buffer);
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  s(8, "WAVE");
  s(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2 * channels, true);
  v.setUint16(32, 2 * channels, true);
  v.setUint16(34, 16, true);
  s(36, "data");
  v.setUint32(40, data, true);
  return buf;
}

/** A File as the browser hands it to the page. `type` is what the OS reports ("" when unknown). */
export function audioFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes.slice().buffer], name, { type });
}
