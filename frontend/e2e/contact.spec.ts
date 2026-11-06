import { expect, test, type Page } from "@playwright/test";
import { BACKEND, expectNoHorizontalOverflow } from "./helpers";

/** Contact & purchase request (A43). The backend is a network-level fake at VITE_API_BASE_URL: the real Worker is covered by
 * backend/care-monitoring/worker/test/contact.test.ts and by the local end-to-end run recorded in docs/E2E_TEST_RESULTS.md. */

interface Captured {
  bodies: Array<Record<string, unknown>>;
}

async function fakeContactApi(page: Page, reply: (body: Record<string, unknown>, n: number) => { status: number; json: unknown; delayMs?: number }): Promise<Captured> {
  const captured: Captured = { bodies: [] };
  await page.route(`${BACKEND}/api/public/v1/contact-requests`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors() });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    captured.bodies.push(body);
    const r = reply(body, captured.bodies.length);
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
    await route.fulfill({ status: r.status, headers: { ...cors(), "content-type": r.status < 300 ? "application/json" : "application/problem+json" }, body: JSON.stringify(r.json) });
  });
  return captured;
}
const cors = () => ({ "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" });
const accepted = (category: unknown, n: number, status = "sent") => ({
  status: 201,
  json: { request_id: `CL-261104-TEST000${n}`, category, received_at: "2026-11-04T03:00:00.000Z", duplicate: false, notification: { status } },
});

async function openContact(page: Page) {
  await page.goto("/#lien-he");
  const section = page.locator("#lien-he");
  await section.scrollIntoViewIfNeeded();
  return section;
}

async function fillShared(page: Page, opts: { facility: boolean }) {
  const s = page.locator("#lien-he");
  if (opts.facility) await s.getByLabel(/^Tên cơ sở \/ tổ chức/).fill("Trung tâm Thử");
  await s.getByLabel(opts.facility ? /^Họ và tên người liên hệ/ : /^Họ và tên/).fill("Người Thử");
  await s.getByLabel(/^Số điện thoại/).first().fill("0900 000 001");
  await s.getByLabel(opts.facility ? /^Email công việc/ : /^Email/).fill("thu@example.invalid");
}

test.describe("Liên hệ và đặt mua", () => {
  test("gửi được cả bốn loại yêu cầu và hiện đúng mã do máy chủ trả", async ({ page }) => {
    const api = await fakeContactApi(page, (b, n) => accepted(b.category, n));
    const s = await openContact(page);
    const cases = [
      { group: "Cá nhân và gia đình", action: "Tư vấn sản phẩm", category: "individual_consultation", facility: false, extra: async () => {} },
      {
        group: "Cá nhân và gia đình",
        action: "Yêu cầu đặt mua",
        category: "individual_purchase",
        facility: false,
        extra: async () => {
          await s.getByLabel(/^Tên người nhận/).fill("Người Nhận");
          await s.getByLabel(/^Số điện thoại người nhận/).fill("0900000003");
          await s.getByLabel(/^Địa chỉ giao hàng/).fill("Số 1 Đường Thử");
        },
      },
      { group: "Cơ sở chăm sóc y tế", action: "Tư vấn triển khai", category: "facility_consultation", facility: true, extra: async () => {} },
      {
        group: "Cơ sở chăm sóc y tế",
        action: "Báo giá / đặt mua",
        category: "facility_purchase",
        facility: true,
        extra: async () => {
          await s.getByLabel(/^Địa chỉ cơ sở/).fill("Số 2 Đường Thử");
          await s.getByLabel(/^Số lượng thiết bị/).fill("12");
        },
      },
    ];
    for (const [i, c] of cases.entries()) {
      await s.getByRole("group", { name: "Chọn nhóm khách hàng" }).getByRole("button", { name: new RegExp(c.group) }).click();
      await s.getByRole("group", { name: "Chọn nhu cầu" }).getByRole("button", { name: new RegExp(c.action.replace("/", "\\/")) }).click();
      await fillShared(page, { facility: c.facility });
      await c.extra();
      await s.getByText(/Tôi đồng ý để CareLens AI/).click();
      await expect(s.getByRole("checkbox", { name: /Tôi đồng ý/ })).toBeChecked();
      await s.getByRole("button", { name: "Gửi yêu cầu" }).click();
      await expect(s.getByTestId("contact-reference")).toHaveText(`CL-261104-TEST000${i + 1}`);
      await s.getByRole("button", { name: "Gửi yêu cầu khác" }).click();
    }
    expect(api.bodies.map((b) => b.category)).toEqual(cases.map((c) => c.category));
    expect(api.bodies[3]).toMatchObject({ device_quantity: 12, organization: "Trung tâm Thử", consent: true, website: "" });
  });

  test("đang gửi khóa nút; lỗi máy chủ giữ nội dung; thông báo email chậm được nói rõ", async ({ page }) => {
    await fakeContactApi(page, (b, n) => (n === 1 ? { status: 503, json: { code: "submission_not_stored" }, delayMs: 600 } : accepted(b.category, n, "failed")));
    const s = await openContact(page);
    await s.getByRole("button", { name: /Cá nhân và gia đình/ }).click();
    await s.getByRole("button", { name: /Tư vấn sản phẩm/ }).click();
    await fillShared(page, { facility: false });
    await s.getByText(/Tôi đồng ý để CareLens AI/).click();
      await expect(s.getByRole("checkbox", { name: /Tôi đồng ý/ })).toBeChecked();
    await s.getByRole("button", { name: "Gửi yêu cầu" }).click();
    await expect(s.getByRole("button", { name: "Đang gửi…" })).toBeDisabled();
    await expect(s.getByRole("alert")).toContainText("chưa xác nhận được yêu cầu");
    await expect(s.getByLabel(/^Họ và tên/)).toHaveValue("Người Thử");
    await s.getByRole("button", { name: "Gửi yêu cầu" }).click();
    await expect(s.getByTestId("contact-notification-delayed")).toBeVisible();
  });

  test("mọi điều khiển trong phần liên hệ (kể cả biểu mẫu đã mở) có vùng chạm ít nhất 44×44px ở 360px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await fakeContactApi(page, (b, n) => accepted(b.category, n));
    const s = await openContact(page);
    const small: string[] = [];
    for (const [group, actions] of [
      ["Cá nhân và gia đình", ["Tư vấn sản phẩm", "Yêu cầu đặt mua"]],
      ["Cơ sở chăm sóc y tế", ["Tư vấn triển khai", "Báo giá \\/ đặt mua"]],
    ] as const) {
      await s.getByRole("button", { name: new RegExp(group) }).click();
      for (const action of actions) {
        await s.getByRole("button", { name: new RegExp(action) }).click();
        small.push(
          ...(await page.evaluate(() => {
            const root = document.getElementById("lien-he")!;
            // Ô chọn ẩn (sr-only) được bấm qua nhãn bao quanh nó: đo nhãn.
            const targets = Array.from(root.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea"))
              .filter((el) => !el.closest("[aria-hidden]"))
              .map((el) => (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.closest("label")! : el));
            return targets
              .filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && (r.width < 44 || r.height < 44);
              })
              .map((el) => `${el.tagName} ${(el.getAttribute("name") ?? el.textContent ?? "").slice(0, 30)}`);
          })),
        );
      }
    }
    expect(small).toEqual([]);
  });

  test("chỉ dùng bàn phím: chọn nhóm, nhu cầu, điền và gửi; lỗi được đọc và focus về ô sai", async ({ page }) => {
    await fakeContactApi(page, (b, n) => accepted(b.category, n, "pending"));
    const s = await openContact(page);
    const group = s.getByRole("button", { name: /Cá nhân và gia đình/ });
    await group.focus();
    await page.keyboard.press("Enter");
    await expect(group).toHaveAttribute("aria-pressed", "true");
    const action = s.getByRole("button", { name: /Tư vấn sản phẩm/ });
    await action.focus();
    await page.keyboard.press("Space");
    await expect(action).toHaveAttribute("aria-pressed", "true");
    // Gửi rỗng bằng bàn phím: tóm tắt lỗi được thông báo, focus về ô bắt buộc đầu tiên, ô đó trỏ tới lời báo lỗi.
    await s.getByRole("button", { name: "Gửi yêu cầu" }).focus();
    await page.keyboard.press("Enter");
    await expect(s.getByRole("alert")).toContainText("mục chưa hợp lệ");
    const name = s.getByLabel(/^Họ và tên/);
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    const errorId = (await name.getAttribute("aria-describedby"))!;
    await expect(page.locator(`[id="${errorId}"]`)).toHaveText(/Vui lòng nhập/);
    // Vòng focus hiện rõ trên nút chọn khi đi bằng Tab.
    await page.keyboard.press("Shift+Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
    await name.focus();
    await page.keyboard.type("Người Thử");
    await page.keyboard.press("Tab");
    await page.keyboard.type("0900 000 001");
    await page.keyboard.press("Tab");
    await page.keyboard.type("thu@example.invalid");
    const consent = s.getByRole("checkbox", { name: /Tôi đồng ý/ });
    await consent.focus();
    await page.keyboard.press("Space");
    await expect(consent).toBeChecked();
    await s.getByRole("button", { name: "Gửi yêu cầu" }).focus();
    await page.keyboard.press("Enter");
    await expect(s.getByTestId("contact-success")).toBeFocused();
    await expect(s.getByTestId("contact-notification-delayed")).toContainText("chưa gửi xong");
  });
});

for (const width of [360, 390, 768, 1024, 1440]) {
  test(`liên hệ ở ${width}px: không tràn ngang, nhóm xếp dọc trên điện thoại, nút gửi rộng hết hàng trên màn hẹp`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fakeContactApi(page, (b, n) => accepted(b.category, n));
    const s = await openContact(page);
    await s.getByRole("button", { name: /Cơ sở chăm sóc y tế/ }).click();
    await s.getByRole("button", { name: /Báo giá \/ đặt mua/ }).click();
    await s.getByRole("button", { name: "Gửi yêu cầu" }).scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page);
    const groups = s.getByRole("group", { name: "Chọn nhóm khách hàng" }).getByRole("button");
    const [a, b] = [await groups.nth(0).boundingBox(), await groups.nth(1).boundingBox()];
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    const submit = await s.getByRole("button", { name: "Gửi yêu cầu" }).boundingBox();
    const form = await s.locator("form").boundingBox();
    if (width < 640) expect(submit!.width).toBeGreaterThan(form!.width - 2);
    // Không có chữ bị cắt trong phần liên hệ.
    const clipped = await page.evaluate(() =>
      Array.from(document.getElementById("lien-he")!.querySelectorAll<HTMLElement>("h2, h3, p, li, button, a, label, legend"))
        .filter((el) => el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible" && !el.closest("[aria-hidden]"))
        .map((el) => el.textContent?.slice(0, 30)),
    );
    expect(clipped).toEqual([]);
    await page.screenshot({ path: `test-results/contact-${width}.png`, fullPage: false });
  });
}
