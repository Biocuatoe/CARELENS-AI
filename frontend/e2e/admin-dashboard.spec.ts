import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { BACKEND } from "./helpers";

/**
 * Admin dashboard in a real browser against the production build. The Worker is faked at the network layer with synthetic data;
 * nothing reaches Google or a real backend. What this adds over the jsdom tests: the real <dialog> (modal, focus, Escape), the
 * CSV download, the audio element playing a blob, and client-side navigation between the lazy admin routes. It does not show that
 * a real Worker, a real Google sign-in or a real ESP32 behaves this way.
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS" };
const TOKEN = "clm_synthetic-e2e-admin-session";
const CODE = "cax_synthetic-e2e-one-time-code";

const json = (route: Route, status: number, body?: unknown) =>
  route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const DEVICE = {
  device_id: "esp32-e2e-1",
  recipient_id: "rcp-e2e",
  kind: "esp32_s3_cam",
  label: "Thiết bị thử e2e",
  status: "active",
  firmware_version: "fw-e2e",
  created_at: "2026-10-18T02:00:00.000Z",
  revoked_at: null,
  credential: { state: "active", version: 1 },
  audio_codecs: ["pcm_s16le", "mp3"],
  last_seen_at: new Date().toISOString(),
  last_contact_age_seconds: 5,
  connected: true,
  online_window_seconds: 180,
  last_boot_id: "boot-e2e",
  heartbeat: null,
  last_capture: null,
  last_event: null,
  last_inference_at: null,
  commands: { active: {}, last_24h: {} },
  has_simulated_records_7d: true,
};

// A real MP3 made by LAME (synthetic 440 Hz tone, no voice): the firmware's test fixture, so Chromium can really load it.
const MP3_FIXTURE = fileURLToPath(new URL("../../firmware/carelens-esp32s3/test/fixtures/mp3/mpeg2_16k_mono_32k.mp3", import.meta.url));
const MP3_BYTES = readFileSync(MP3_FIXTURE);

interface Seen {
  posts: string[];
  uploads: Array<{ contentType: string | null; sha256: string; bytes: number }>;
}

async function mockBackend(page: Page): Promise<Seen> {
  const seen: Seen = { posts: [], uploads: [] };
  await page.route(`${BACKEND}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname}`;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (request.method() === "POST") seen.posts.push(key);
    switch (key) {
      case "GET /ready":
        return json(route, 200, { status: "ready", capabilities: { google_signin: "configured", admin_signin: "configured" } });
      case "POST /api/admin/v1/session/exchange":
        return json(route, 201, { token: TOKEN, token_type: "Bearer", expires_at: "2099-01-01T00:00:00.000Z", storage: "memory_only", admin: { admin_id: "adm_e2e", role: "owner" } });
      case "GET /api/admin/v1/me":
        return json(route, 200, { auth_method: "session", admin_id: "adm_e2e", email: "owner@example.invalid", role: "owner", session: { expires_at: "2099-01-01T00:00:00.000Z", authenticated_at: new Date().toISOString() } });
      case "GET /api/admin/v1/status":
        return json(route, 200, { server_time: new Date().toISOString(), storage: { d1_size_bytes: null, imu_ingest: "accepting" }, queue: [], failures_24h: [], last_successful_inference: [], fusion: { policy_version: "fusion-rules.v2", suspected_fall_possible: false }, agents: [], devices: [] });
      case "GET /api/admin/v1/capabilities":
        return json(route, 200, {
          tts: { available: false, reason: "no_text_to_speech_service", note: "Máy chủ không có dịch vụ chuyển văn bản thành giọng nói." },
          audio: { content_type: "audio/mpeg", codec: "mp3", sample_rates_hz: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000], channels: [1, 2], max_bytes: 2000000, min_duration_ms: 500, max_duration_ms: 60000 },
          reminders: { timezone: "Asia/Ho_Chi_Minh" },
          device_playback: "not_verified_with_hardware",
        });
      case "GET /api/admin/v1/devices":
        return json(route, 200, { items: [DEVICE], server_time: new Date().toISOString(), simulated_sources: "accepted" });
      case "GET /api/admin/v1/audit":
        return json(route, 200, { items: [], next_cursor: null });
      case "GET /api/admin/v1/devices/esp32-e2e-1/activity":
        return json(route, 200, {
          device: { device_id: DEVICE.device_id, recipient_id: DEVICE.recipient_id, label: DEVICE.label, status: "active" },
          date: url.searchParams.get("date"),
          timezone: "Asia/Ho_Chi_Minh",
          period: { start: "2026-10-18T17:00:00.000Z", end: "2026-10-19T17:00:00.000Z", interval: "[start, end)" },
          generated_at: new Date().toISOString(),
          in_future: false,
          sources: { events: { status: "ok", count: 1 }, agent_connectivity: { status: "not_stored", count: 0, note: "Không lưu lịch sử." } },
          entries: [{ at: "2026-10-19T02:58:00.000Z", source: "events", kind: "imu_trigger", ref_id: "=1+1", source_mode: "simulated", status: "imu_trigger_reported", detail: { label: "=cmd|' /C calc'!A0" } }],
        });
      case "GET /api/admin/v1/devices/esp32-e2e-1/voice-messages":
        return json(route, 200, { items: [{ voice_message_id: "vm_e2e", title: "Nhắc e2e", status: "active", created_by: "admin:adm_e2e", created_at: new Date().toISOString(), audio: { version: 1, content_type: "audio/mpeg", sample_rate_hz: 16000, channels: 1, duration_ms: 1080, byte_size: MP3_BYTES.length } }] });
      case "GET /api/admin/v1/voice-messages/vm_e2e/audio":
        return route.fulfill({ status: 200, headers: { ...CORS, "content-type": "audio/mpeg" }, body: MP3_BYTES });
      case "POST /api/admin/v1/devices/esp32-e2e-1/voice-messages": {
        const body = request.postDataBuffer() ?? Buffer.alloc(0);
        seen.uploads.push({ contentType: request.headers()["content-type"] ?? null, sha256: createHash("sha256").update(body).digest("hex"), bytes: body.length });
        return json(route, 201, { voice_message: { voice_message_id: "vm_new", title: url.searchParams.get("title"), status: "active", created_by: "admin:adm_e2e", created_at: new Date().toISOString(), audio: { version: 1, content_type: "audio/mpeg", sample_rate_hz: 16000, channels: 1, duration_ms: 1080, byte_size: body.length } } });
      }
      case "GET /api/admin/v1/devices/esp32-e2e-1/commands":
        return json(route, 200, { items: [], next_cursor: null });
      case "POST /api/admin/v1/devices/esp32-e2e-1/voice-commands":
        return json(route, 201, {
          created: true,
          command: { command_id: "cmd_e2e", device_id: DEVICE.device_id, command_type: "play_voice_message", status: "queued", played_confirmed_by_device: false, payload: { voice: { voice_message_id: "vm_e2e", version: 1 } }, expires_at: new Date(Date.now() + 300_000).toISOString(), created_at: new Date().toISOString(), created_by: "admin:adm_e2e" },
        });
      default:
        return json(route, 404, { code: "not_found" });
    }
  });
  return seen;
}

async function signIn(page: Page): Promise<void> {
  await page.goto(`/admin/login#admin_code=${CODE}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan quản trị" })).toBeVisible();
}

test("the nav reaches every dashboard section client-side, and a reload returns to the login", async ({ page }) => {
  await mockBackend(page);
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Khu quản trị" });
  for (const [name, heading] of [
    ["Thiết bị", "Thiết bị"],
    ["Báo cáo ngày", "Báo cáo hoạt động theo ngày"],
    ["Gửi âm thanh", "Gửi âm thanh tới thiết bị"],
    ["Nhắc lịch", "Nhắc lịch cho thiết bị"],
    ["Agent", "Agent và dịch vụ xử lý"],
    ["Nhật ký", "Nhật ký quản trị"],
  ] as const) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Đăng nhập quản trị" })).toBeVisible();
  const stored = await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage, cookie: document.cookie }));
  expect(stored).not.toMatch(/clm_|cax_/);
});

test("the daily report shows the timeline and exports a CSV that cannot run as a formula", async ({ page }) => {
  await mockBackend(page);
  await signIn(page);
  await page.getByRole("navigation", { name: "Khu quản trị" }).getByRole("link", { name: "Báo cáo ngày" }).click();
  await expect(page.getByText(/Dòng thời gian \(1\)/)).toBeVisible();
  await expect(page.getByText("Dữ liệu mô phỏng").first()).toBeVisible();
  await expect(page.getByText("Không được lưu", { exact: true })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Tải CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^carelens-esp32-e2e-1-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const text = (await import("node:fs")).readFileSync(path, "utf8");
  expect(text).toContain(`"'=1+1"`);
  expect(text).not.toMatch(/(^|,)"=/m);
});

test("sending audio needs the real modal's confirmation, can be dismissed with Escape, and sends exactly once", async ({ page }) => {
  const seen = await mockBackend(page);
  await signIn(page);
  await page.getByRole("navigation", { name: "Khu quản trị" }).getByRole("link", { name: "Gửi âm thanh" }).click();
  await expect(page.getByText("Chuyển văn bản thành giọng nói chưa được hỗ trợ")).toBeVisible();

  // Previewing plays the private recording from a blob (the CSP allows blob: media).
  await page.getByRole("radio", { name: /Nhắc e2e/ }).check({ force: true });
  await page.getByRole("button", { name: "Nghe thử" }).click();
  const audio = page.getByLabel("Nghe thử bản ghi");
  await expect(audio).toBeVisible();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThan(0);

  const open = page.getByRole("button", { name: "Gửi tới thiết bị…" });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Xác nhận gửi tới thiết bị thật" });
  await expect(dialog).toBeVisible();
  expect(seen.posts).not.toContain("POST /api/admin/v1/devices/esp32-e2e-1/voice-commands"); // opening sends nothing
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(true); // focus is inside the modal
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused(); // focus returns to what opened it
  expect(seen.posts).not.toContain("POST /api/admin/v1/devices/esp32-e2e-1/voice-commands");

  await open.click();
  await dialog.getByRole("button", { name: "Xác nhận gửi" }).dblclick();
  await expect(page.getByText("Lệnh đã được máy chủ nhận")).toBeVisible();
  await expect(page.getByText(/chưa có nghĩa là thiết bị đã phát/)).toBeVisible();
  expect(seen.posts.filter((p) => p === "POST /api/admin/v1/devices/esp32-e2e-1/voice-commands")).toHaveLength(1);
});

test("an MP3 picked in the real file input is checked, described, and uploaded byte for byte as audio/mpeg (ADR-025)", async ({ page }) => {
  const seen = await mockBackend(page);
  await signIn(page);
  await page.getByRole("navigation", { name: "Khu quản trị" }).getByRole("link", { name: "Gửi âm thanh" }).click();
  const input = page.getByLabel("Tệp âm thanh MP3");
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute("accept", ".mp3,audio/mpeg");
  // The browser's own File for a real LAME file: the page walks its frames and shows what will be sent.
  await input.setInputFiles({ name: "nhac-uong-nuoc.mp3", mimeType: "audio/mpeg", buffer: MP3_BYTES });
  const picked = page.getByLabel("Tệp đã chọn");
  await expect(picked).toContainText("nhac-uong-nuoc.mp3");
  await expect(picked).toContainText("MP3 · MPEG-2 · 16 kHz · mono · 32 kbps");
  await expect(picked).toContainText("1,1 giây");
  // WAV is refused before anything is sent, whatever its name.
  await input.setInputFiles({ name: "doi-ten.mp3", mimeType: "audio/mpeg", buffer: Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), Buffer.alloc(40)]) });
  await expect(page.getByText("Đây là tệp WAV. Lời nhắn giờ phải là tệp MP3.")).toBeVisible();
  await input.setInputFiles({ name: "nhac-uong-nuoc.mp3", mimeType: "audio/mpeg", buffer: MP3_BYTES });
  await page.getByLabel("Tên bản ghi").fill("Nhắc uống nước");
  await page.getByRole("button", { name: "Tải lên kho riêng tư" }).click();
  await expect(page.getByText(/giữ nguyên tệp gốc\)\. Bản ghi nằm trong kho riêng tư; chưa có gì được gửi tới thiết bị/)).toBeVisible();
  expect(seen.uploads).toEqual([{ contentType: "audio/mpeg", sha256: createHash("sha256").update(MP3_BYTES).digest("hex"), bytes: MP3_BYTES.length }]);
  expect(seen.posts).not.toContain("POST /api/admin/v1/devices/esp32-e2e-1/voice-commands"); // uploading never sends a command
});

test("the dashboard has no horizontal scroll at phone width", async ({ page }) => {
  await mockBackend(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page);
  for (const name of ["Thiết bị", "Báo cáo ngày", "Gửi âm thanh", "Nhắc lịch"]) {
    await page.getByRole("navigation", { name: "Khu quản trị" }).getByRole("link", { name, exact: true }).click();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, name).toBeLessThanOrEqual(0);
  }
});
