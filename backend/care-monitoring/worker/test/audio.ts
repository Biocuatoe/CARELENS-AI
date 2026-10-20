/**
 * Test audio for the voice-message and command tests (ADR-025). The backend never decodes audio, it walks MP3 frame
 * headers, so `mp3()` builds valid Layer III frames with a silent payload for any rate and layout. Two real files made by
 * LAME (firmware/carelens-esp32s3/tools/make_test_mp3.py fixtures; synthetic 440 Hz tones, no voices) prove that actual
 * encoder output passes the same checks, and that tags are accepted. `wav()` makes the legacy format stored before ADR-025.
 */
import { env } from "cloudflare:workers";
import { b64ToBytes } from "./helpers";

const V1_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const V2_KBPS = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
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

/** One Layer III frame header (no CRC, no padding) and its frame length and samples per channel. */
export function mp3Frame(rate: number, channels: 1 | 2, kbps: number, layer = 1): { bytes: Uint8Array; samples: number } {
  const r = RATES[rate];
  if (!r) throw new Error(`no MP3 sample rate ${rate}`);
  const table = r.versionBits === 3 ? V1_KBPS : V2_KBPS;
  const br = table.indexOf(kbps);
  if (br <= 0) throw new Error(`no Layer III bitrate ${kbps} kbps for ${rate} Hz`);
  const size = Math.floor(((r.versionBits === 3 ? 144_000 : 72_000) * kbps) / rate);
  const f = new Uint8Array(size);
  f[0] = 0xff;
  f[1] = 0xe0 | (r.versionBits << 3) | (layer << 1) | 1;
  f[2] = (br << 4) | (r.index << 2);
  f[3] = channels === 1 ? 0xc0 : 0x40;
  return { bytes: f, samples: r.versionBits === 3 ? 1152 : 576 };
}

export function mp3(opts: { seconds?: number; rate?: number; channels?: 1 | 2; kbps?: number } = {}): Uint8Array {
  const { seconds = 1, rate = 16000, channels = 1, kbps = rate >= 32000 ? 128 : 32 } = opts;
  const frame = mp3Frame(rate, channels, kbps);
  const count = Math.ceil((seconds * rate) / frame.samples);
  const out = new Uint8Array(frame.bytes.length * count);
  for (let i = 0; i < count; i++) out.set(frame.bytes, i * frame.bytes.length);
  return out;
}

/** Duration the backend computes for `mp3()` output: whole frames, floor(ms). */
export function mp3DurationMs(opts: { seconds?: number; rate?: number } = {}): number {
  const { seconds = 1, rate = 16000 } = opts;
  const samples = rate >= 32000 ? 1152 : 576;
  return Math.floor((Math.ceil((seconds * rate) / samples) * samples * 1000) / rate);
}

/** LAME, MPEG-2 Layer III, 16 kHz mono, 32 kbps CBR, 30 frames (1080 ms), 4320 bytes. */
export const LAME_16K_MONO = b64ToBytes("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");
/** The same stream with an ID3v2 tag in front and an ID3v1 tag behind (4551 bytes). */
export const LAME_16K_MONO_TAGGED = b64ToBytes("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");

/** Legacy PCM WAV (mono, 16-bit), the only upload format before ADR-025. Synthetic tone, no voice. */
export function wav(seconds = 1, rate = 16000, channels = 1): Uint8Array {
  const data = rate * seconds * 2 * channels;
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
  for (let i = 44; i < buf.length; i += 2) v.setInt16(i, Math.round(Math.sin(i / 20) * 1000), true);
  return buf;
}

/** Stores a recording exactly as a Worker before ADR-025 did (WAV row + R2 object), for legacy-compatibility tests. */
export async function insertLegacyWav(recipientId: string, title = "Bản WAV cũ", seconds = 1): Promise<{ assetId: string; bytes: Uint8Array }> {
  const bytes = wav(seconds);
  const assetId = `vm_legacy_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const key = `voice/${recipientId}/${assetId}/v1.wav`;
  await env.AUDIO.put(key, bytes, { httpMetadata: { contentType: "audio/wav" } });
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO audio_assets (asset_id, recipient_id, title, current_version, status, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 'active', 'legacy', ?4, ?4)`).bind(assetId, recipientId, title, now),
    env.DB.prepare(
      `INSERT INTO audio_asset_versions (asset_id, version, r2_key, content_type, sample_rate_hz, channels, bits_per_sample, duration_ms, byte_size, sha256, uploaded_by, uploaded_at)
       VALUES (?1, 1, ?2, 'audio/wav', 16000, 1, 16, ?3, ?4, ?5, 'legacy', ?6)`,
    ).bind(assetId, key, seconds * 1000, bytes.length, sha, now),
  ]);
  return { assetId, bytes };
}
