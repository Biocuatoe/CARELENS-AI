import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Real end-to-end check with the PHYSICAL ESP32 through the real admin dashboard, the real local Worker (wrangler dev) and
 * the device's real HTTPS connection (firmware/carelens-esp32s3, tools/local_tls_proxy.py). Nothing is mocked here.
 * Runs only when E2E_HARDWARE_DEVICE names the provisioned device; skipped otherwise (and in `npm run test:e2e`).
 *
 *   E2E_BASE_URL=http://localhost:5173            the Vite dev server, VITE_API_BASE_URL = the local Worker
 *   E2E_HARDWARE_DEVICE=esp32s3-chest-01
 *   E2E_ADMIN_LOGIN_URL_FILE=…/dev-admin-login-url.txt   from backend/care-monitoring/scripts/dev_admin_login.py
 *   E2E_TEST_MP3=…/test-message-vi.mp3           a synthetic (TTS) recording, no real voice; uploaded and played as MP3 (ADR-025)
 *   E2E_FIRMWARE_VERSION=carelens-fw-0.2.0       the firmware the device is expected to report
 *   E2E_SPEAKER_VOLUME=0.45                       optional: volume to set first
 *
 * Software cannot hear the speaker: "the device reported completed" is checked here; audibility is confirmed by a person.
 */
const deviceId = process.env.E2E_HARDWARE_DEVICE ?? "";
test.skip(!deviceId, "set E2E_HARDWARE_DEVICE to run against the physical device");
test.use({ actionTimeout: 20_000 });
const say = (text: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);
// E2E_STEPS selects steps (default all): online, volume, audio, results.
const steps = new Set((process.env.E2E_STEPS ?? "online,volume,audio,results").split(","));

async function signIn(page: Page): Promise<void> {
  const url = readFileSync(process.env.E2E_ADMIN_LOGIN_URL_FILE ?? "", "utf8").trim();
  const code = url.split("#admin_code=")[1] ?? "";
  // The one-time code is put into the address bar by an init script, so it never appears in a navigation log or trace.
  await page.addInitScript((c) => {
    if (location.pathname === "/admin/login" && !location.hash) history.replaceState(null, "", `/admin/login#admin_code=${c}`);
  }, code);
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { level: 1, name: "Tổng quan quản trị" })).toBeVisible({ timeout: 30_000 });
}

const valueOf = (page: Page, label: string) => page.locator(`xpath=//dt[normalize-space(.)="${label}"]/following-sibling::dd[1]`).first();

test("physical device: online state, speaker volume and a voice message from the dashboard to the speaker", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await signIn(page);
  say("signed in");

  await test.step("the dashboard shows the device's own heartbeat", async () => {
    // In-app navigation only: the admin session lives in memory, a full page load would end it (ADR-020).
    await page.getByRole("link", { name: "Thiết bị", exact: true }).first().click();
    await page.getByRole("row", { name: new RegExp(deviceId) }).getByRole("link").click();
    await expect(page.getByText("Có liên lạc gần đây")).toBeVisible({ timeout: 20_000 });
    await expect(valueOf(page, "Phiên bản firmware")).toHaveText(process.env.E2E_FIRMWARE_VERSION ?? "carelens-fw-0.2.0");
    await expect(page.getByText(/Sức khỏe do thiết bị tự báo lúc/)).toBeVisible();
    await expect(valueOf(page, "Camera")).toHaveText("ok");
    await expect(valueOf(page, "IMU")).toHaveText("ok");
    await expect(valueOf(page, "Loa")).toHaveText("ok");
  });

  const volume = process.env.E2E_SPEAKER_VOLUME;
  if (volume && steps.has("volume")) {
    await test.step(`speaker volume ${volume}: set on the server, applied only when the device reports it`, async () => {
      const pct = `${Math.round(Number(volume) * 100)}%`;
      await page.getByLabel("Mức mới").selectOption(volume);
      await page.getByRole("button", { name: "Đặt âm lượng…" }).click();
      await page.getByRole("dialog", { name: "Xác nhận đổi âm lượng loa" }).getByRole("button", { name: `Đặt ${pct}` }).click();
      await expect(page.getByText(new RegExp(`Đã đặt ${pct} trên máy chủ`))).toBeVisible();
      await expect(valueOf(page, "Mức đặt trên máy chủ")).toContainText(pct);
      // The card asks again every 10 s; the device applies the value at its next heartbeat (≤ 60 s).
      await expect(valueOf(page, "Thiết bị báo đang dùng")).toContainText(pct, { timeout: 150_000 });
    });
  }

  if (steps.has("audio")) await test.step("upload a recording, send it, and see the device's own acknowledgements up to completed", async () => {
    say("device page checked");
    await page.getByRole("link", { name: "Gửi âm thanh", exact: true }).first().click();
    const title = `Lời nhắn thử E2E ${new Date().toISOString().slice(11, 19)}`;
    await page.getByLabel("Tên bản ghi").fill(title);
    // The input stays disabled until the server's audio limits are loaded.
    await expect(page.getByLabel(/Tệp âm thanh MP3/)).toBeEnabled({ timeout: 20_000 });
    await page.getByLabel(/Tệp âm thanh MP3/).setInputFiles(process.env.E2E_TEST_MP3 ?? "");
    await expect(page.getByLabel("Tệp đã chọn")).toContainText("MP3 ·");
    say(`picked: ${(await page.getByLabel("Tệp đã chọn").textContent())?.replace(/\s+/g, " ")}`);
    await page.getByRole("button", { name: "Tải lên kho riêng tư" }).click();
    await expect(page.getByText(/Bản ghi nằm trong kho riêng tư; chưa có gì được gửi tới thiết bị/)).toBeVisible({ timeout: 30_000 });
    say("recording uploaded");
    await page.getByRole("radio", { name: new RegExp(title) }).check();
    await page.getByRole("button", { name: "Gửi tới thiết bị…" }).click();
    await page.getByRole("dialog", { name: "Xác nhận gửi tới thiết bị thật" }).getByRole("button", { name: "Xác nhận gửi" }).click();
    const notice = page.getByRole("status").filter({ hasText: "Lệnh đã được máy chủ nhận" });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    const id = /Mã lệnh (cmd_[A-Za-z0-9_-]+)/.exec((await notice.textContent()) ?? "")?.[1];
    expect(id).toBeTruthy();
    console.log(`command ${id} created through the dashboard`);
    await expect(notice).toContainText("Trạng thái hiện tại: Thiết bị báo đã phát xong", { timeout: 120_000 });
    await expect(notice).toContainText("Thiết bị đã tự báo phát xong.");
    console.log(`command ${id}: the device reported completed`);
  });
  if (steps.has("results")) await test.step("the dashboard shows the device's latest inference, labelled as unverified model output", async () => {
    await page.getByRole("link", { name: "Thiết bị", exact: true }).first().click();
    await page.getByRole("row", { name: new RegExp(deviceId) }).getByRole("link").click();
    await expect(page.getByText("Có liên lạc gần đây")).toBeVisible({ timeout: 20_000 });
    await expect(valueOf(page, "Suy luận thành công gần nhất")).not.toHaveText("Chưa có");
    await expect(valueOf(page, "Sự kiện gần nhất")).toContainText(/fall_check|drink_check/);
    await expect(valueOf(page, "Lần chụp gần nhất")).toContainText(/Đã xử lý|processed/);
    console.log(`latest inference: ${await valueOf(page, "Suy luận thành công gần nhất").textContent()}; latest event: ${await valueOf(page, "Sự kiện gần nhất").textContent()}`);
  });
});
