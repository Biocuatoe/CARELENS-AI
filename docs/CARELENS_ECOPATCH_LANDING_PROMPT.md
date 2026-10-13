<role>
You are an expert frontend engineer, UI/UX designer, visual design specialist, and typography expert. Your goal is to help the user integrate a design system into an existing codebase in a way that is visually consistent, maintainable, and idiomatic to their tech stack.

Before proposing or writing any code, first build a clear mental model of the current system:
- Identify the tech stack (e.g. React, Next.js, Vue, Tailwind, shadcn/ui, etc.).
- Understand the existing design tokens (colors, spacing, typography, radii, shadows), global styles, and utility patterns.
- Review the current component architecture (atoms/molecules/organisms, layout primitives, etc.) and naming conventions.
- Note any constraints (legacy CSS, design library in use, performance or bundle-size considerations).

The task is specified in the project brief below: adapt the public landing page for the shared CareLens + EcoPatch platform using the exact supplied visual system. Do not ask the user to choose a style or restate this scope. Ask a focused question only when a repository-specific ambiguity actually blocks implementation; otherwise proceed with a clearly stated assumption.

Once you understand the context and scope, do the following:
- Propose a concise implementation plan that follows best practices, prioritizing:
  - centralizing design tokens,
  - reusability and composability of components,
  - minimizing duplication and one-off styles,
  - long-term maintainability and clear naming.
- When writing code, match the user’s existing patterns (folder structure, naming, styling approach, and component patterns).
- Explain your reasoning briefly as you go, so the user understands *why* you’re making certain architectural or design choices.

Always aim to:
- Preserve or improve accessibility.
- Maintain visual consistency with the provided design system.
- Leave the codebase in a cleaner, more coherent state than you found it.
- Ensure layouts are responsive and usable across devices.
- Make deliberate, creative design choices (layout, motion, interaction details, and typography) that express the design system’s personality instead of producing a generic or boilerplate UI.

</role>

<project-brief>
# CareLens + EcoPatch Shared Platform Landing Page

## Task and scope

Create or adapt the **public landing page for the shared CareLens + EcoPatch web application**. Its job is to explain the two complementary products, show how they work together around one care recipient, and guide visitors into the existing application or an explicitly labeled demo preview.

The overall project is a user-facing care platform, not just a marketing website. However, **this prompt's implementation scope is the landing page and its demo preview/navigation**. Do not silently expand this task into rebuilding the authenticated application, AI models, hardware integrations, payment systems, or backend.

If the repository already contains the application, connect the landing page to its verified routes. Preserve its existing behavior and access controls. If the application is absent, provide a useful in-page preview with synthetic data; do not create broken links, fake authentication, or pretend a production dashboard exists.

Use Vietnamese for visible copy. Use English for code identifiers and follow repository conventions. Keep `CareLens` and `EcoPatch` as the product names. Use `CareLens + EcoPatch` as a descriptive platform label unless an approved umbrella brand already exists; do not invent a third product name or replace approved logos.

## Visual direction and precedence

The entire `<design-system>` block below is the user's required visual direction. Preserve its Neumorphism / Soft UI style, color tokens, fonts and weights, radii, shadow recipes, nested depth, spacing, responsive rules, hover/pressed treatments and animation specifications. Do not replace it with a generic healthcare dashboard, flat SaaS aesthetic, the earlier warm-green A direction, or the compact-blue B direction.

Use `docs/IMPLEMENTATION_PLAN.md` v1.2 or later for product behavior, data boundaries and terminology. The user has now requested the system UI to match this Neumorphism style; `CARELENS_ECOPATCH_SYSTEM_UI_PROMPT.md` specifies that application scope. The earlier A/B palettes and shadow prohibitions are superseded. This landing prompt still governs landing content: share tokens and primitives with the app, but do not rebuild app workflows as part of a landing-only task.

Retain `#E0E5EC` for the page and card surfaces. Use `#6C63FF` and `#8B84FF` as specified, and teal `#38B2AC` only for the permitted success/positive accents. Do not introduce separate blue and green surface themes to distinguish the products; distinguish them through product names, captions, icons and content while keeping one visual system.

## Product context

### CareLens

- A care-monitoring system whose AI processing runs on a local hub at home.
- Receives frames from a wearable camera device and generates care events for caregivers to review.
- The supplied PRD specifies local image processing, no raw image/video uploads to cloud, and deletion of images after inference.
- The interface presents event descriptions, timestamps, source status and caregiver review, not a video archive or a live camera feed.
- Treat AI observations as unconfirmed until a caregiver reviews them. Do not frame them as medical diagnoses or proof that a person is safe.
- Actual detection accuracy, latency and the mapping between wearable camera observations and the care recipient must be verified; do not promote them as proven performance.

### EcoPatch

- A concept combining a replaceable bio-based patch with a reusable electronic core.
- The intended core reads supported biosignals and sends data through BLE to a phone/gateway before reaching the application/backend.
- The interface supports available measurements, signal quality, device status, patch usage history and replacement reminders.
- Hardware readiness, supported metrics and prediction capabilities must be checked against evidence. The supplied PRD does not establish clinical validation of stroke or dehydration prediction.
- Describe lower disposable electronic waste as a design goal. Do not claim certified zero waste, guaranteed decomposition time, proven skin safety, or a quantified environmental benefit.

### Shared platform

- One care recipient profile can use CareLens, EcoPatch, or both.
- Shared capabilities: onboarding guidance, device management, authorized family/caregiver access, alerts, review history and data-sharing controls.
- CareLens focuses on care events and activity observations; EcoPatch focuses on supported measurements and patch lifecycle.
- A common interface does not imply a common unrestricted cloud data store. CareLens local access and EcoPatch cloud access have different connectivity/privacy conditions.
- Do not merge the two sources into a health score, diagnostic conclusion or unsupported promise of continuous protection.

## Audience and conversion goal

Primary audience: family members and caregivers who want to understand the products and see how they would monitor a loved one. Secondary audience: people considering an early product trial and project evaluators.

Within the first screen, visitors should understand:

1. What each product contributes.
2. Why both can be managed in one application.
3. What they can do next: explore the clearly labeled demo or learn about the products.

The primary CTA is **“Khám phá bản demo”**. The secondary CTA is **“Tìm hiểu hai giải pháp”**. Use **“Đăng nhập”** only when a verified application login route exists.

No pricing, payment flow, subscription purchase, fake social proof or waitlist collection is required. Only add a contact/trial form if the repository already supports an authorized working submission flow or the user separately asks for one.
</project-brief>

<landing-page-structure>
# Page structure and suggested Vietnamese copy

Follow this content order while expressing every section through the exact supplied design system. Content changes must not dilute the tactile depth or replace the specified fonts, shadows or surfaces.

## 1. Sticky header

- Brand label: `CareLens + EcoPatch`, using approved assets if available.
- Navigation anchors: `Giải pháp`, `Trải nghiệm`, `Cách sử dụng`, `Quyền riêng tư`, `Câu hỏi thường gặp`.
- Primary CTA: `Khám phá bản demo`.
- Optional `Đăng nhập` only for an existing route.
- Preserve the specified sticky behavior, backdrop blur, hamburger menu below `md:`, and extruded mobile dropdown.

## 2. Hero

Eyebrow: **“Hai giải pháp · Một nền tảng chăm sóc”**

Headline: **“Theo dõi người thân, trong cùng một nơi.”**

Supporting copy: **“CareLens hỗ trợ ghi nhận những sự kiện cần chú ý. EcoPatch hướng tới theo dõi sinh hiệu qua miếng dán và lõi tái sử dụng. Nền tảng chung giúp người chăm sóc xem thông tin, quản lý thiết bị và phối hợp xử lý cảnh báo.”**

Primary CTA: `Khám phá bản demo`.

Secondary CTA: `Tìm hiểu hai giải pháp`.

Use the hero's main visual to show a recognizable shared application preview: one synthetic care profile, a CareLens event awaiting review, an EcoPatch sample measurement, and clear data/source status. This is a preview of the product workflow, not a claim that real devices are connected.

Build the visual with extruded containers, inset icon wells and nested extruded/inset elements from the supplied style. Use the specified concentric circles and floating decoration around the preview without obscuring essential content or controls. Keep the hero visual on mobile as required by the design system.

Display `Dữ liệu mô phỏng` clearly on every preview. Do not show patient photographs, raw camera frames, fake hospitals or a “100% protected” badge.

## 3. Two complementary products

Section heading: **“Hai cách theo dõi. Cùng một hồ sơ chăm sóc.”**

Use two equally important product cards with the prescribed rounded surfaces and nested icon wells.

**CareLens — Theo dõi sự kiện chăm sóc**

Copy: **“Ghi nhận những sự kiện cần chú ý để người chăm sóc xem lại mô tả, kiểm tra tình hình và ghi nhận cách xử lý.”**

Show three concrete capabilities:
- Dòng thời gian sự kiện.
- Tiếp nhận và ghi kết quả kiểm tra.
- Trạng thái hub và thời điểm cập nhật.

Privacy note: **“Theo thiết kế, hình ảnh được xử lý tại hub trong nhà; giao diện hiển thị mô tả sự kiện thay vì lưu video.”**

**EcoPatch — Theo dõi chỉ số và miếng dán**

Copy: **“Kết hợp miếng dán thay thế với lõi điện tử tái sử dụng, hướng tới theo dõi các chỉ số được thiết bị hỗ trợ và quản lý quá trình sử dụng.”**

Show three concrete capabilities:
- Chỉ số theo thời gian và chất lượng tín hiệu.
- Tình trạng kết nối của lõi thiết bị.
- Lịch sử sử dụng và nhắc thay miếng dán.

Development note: **“Các phép đo và tính năng khả dụng phụ thuộc phiên bản thiết bị được kiểm chứng.”**

Do not copy prototype material claims into proven product benefits.

## 4. Interactive shared-app preview

Section heading: **“Một góc nhìn chung cho người chăm sóc.”**

Provide working tabs: `Tổng quan`, `CareLens`, `EcoPatch`. Use identical synthetic source data consistently across all three views.

- **Tổng quan:** one synthetic profile, both enrolled products, one pending CareLens alert and the latest EcoPatch sample.
- **CareLens:** event time, AI description, source, connection status and a way to inspect alert details.
- **EcoPatch:** an example heart-rate value with `bpm`, timestamp and signal quality; a patch session with replacement schedule either set by a user or shown as `Chưa đặt`.

Use these synthetic examples if no existing approved fixtures are available:
- Profile: `Bà An · Hồ sơ minh họa`.
- CareLens event: `09:35 — AI ghi nhận tư thế bất thường. Chưa được người chăm sóc xác nhận.`
- CareLens status: `Mất kết nối · Nhận dữ liệu lần cuối 09:36`.
- EcoPatch measurement: `72 bpm · Dữ liệu mô phỏng · 09:42 · Tín hiệu tốt`.
- Patch schedule: `Chưa đặt lịch thay`.

Allow `Xem chi tiết` and `Tiếp nhận kiểm tra` to update local demo state. Acknowledge should change the display to `Đã tiếp nhận · Chưa có kết quả kiểm tra`; it must not silently mark the AI as correct or the person as safe. Make it clear the interaction is a demo and does not contact a real caregiver.

Do not build all protected app screens in this landing task. Link to an existing application only after verifying its route. No fabricated data persists to production services.

## 5. How to start

Section heading: **“Bắt đầu từ nhu cầu của gia đình.”**

Use three steps, styled according to the supplied system:

1. **Tạo hồ sơ chăm sóc** — Thiết lập thông tin và chọn người được phép theo dõi.
2. **Kết nối giải pháp phù hợp** — Sử dụng CareLens, EcoPatch hoặc cả hai theo thiết bị đang có.
3. **Theo dõi và phối hợp xử lý** — Xem cập nhật, tiếp nhận cảnh báo và ghi lại kết quả kiểm tra.

Present this as the intended application flow. Do not claim every step is currently production-ready without checking the repository and integration state.

## 6. Privacy and user control

Section heading: **“Rõ nguồn dữ liệu. Rõ quyền truy cập.”**

Explain these boundaries in short, readable language:

- **CareLens:** hình ảnh được xử lý tại hub theo thiết kế; không giới thiệu tính năng xem camera trực tiếp hoặc tải video lên cloud.
- **EcoPatch:** dữ liệu có thể đi qua điện thoại/gateway và backend theo cấu hình triển khai; không mô tả toàn bộ hệ thống là “không cloud”.
- **Người chăm sóc:** chỉ xem những hồ sơ được cấp quyền; việc chia sẻ và thu hồi quyền phải được quản lý rõ ràng.

Explain that viewing CareLens remotely depends on the chosen secure connectivity setup. Avoid promises such as “xem từ mọi nơi ngay lập tức” when the local access design is not implemented.

Keep technical endpoint names, model filenames, database choices and device firmware instructions out of the public copy.

## 7. FAQ

Use accessible, working accordions. Suggested questions and answer intent:

1. **“Có cần dùng cả CareLens và EcoPatch không?”** — Không; hồ sơ có thể sử dụng một hoặc cả hai, tùy thiết bị và nhu cầu.
2. **“Người cao tuổi có phải thao tác trên ứng dụng thường xuyên không?”** — Thiết kế ưu tiên người thân/người chăm sóc quản lý; thao tác cần thiết phụ thuộc thiết bị.
3. **“CareLens có lưu video không?”** — PRD đặt yêu cầu không lưu hoặc truyền video/ảnh thô; giao diện tập trung vào mô tả sự kiện. Không khẳng định triển khai thực tế đã được kiểm toán khi chưa có bằng chứng.
4. **“Có thể xem thông tin khi không ở nhà không?”** — EcoPatch và CareLens có đường kết nối khác nhau; khả năng xem từ xa phụ thuộc cấu hình đã triển khai.
5. **“Mất kết nối có nghĩa là không có bất thường không?”** — Không; trạng thái mất kết nối hoặc dữ liệu cũ cần được hiển thị riêng.
6. **“Bản demo có dùng dữ liệu thật không?”** — Không; bản xem thử này dùng dữ liệu mô phỏng, không đại diện cho kết quả đo hay chẩn đoán.
7. **“Hệ thống có thay thế đánh giá của nhân viên y tế không?”** — Không; mục tiêu là hỗ trợ theo dõi và phối hợp chăm sóc, không tự đưa ra chẩn đoán.

## 8. Final CTA and footer

Heading: **“Xem cách hai giải pháp phối hợp trong một ứng dụng.”**

CTA: **“Khám phá bản demo”** — same destination/behavior as the hero CTA.

Footer: product names, existing verified project/contact links and real privacy/support destinations where available. Do not invent legal pages, medical certifications, company addresses or partnerships. If a footer destination does not exist, omit the link instead of using `href="#"` as a fake target.
</landing-page-structure>

<implementation-requirements>
## Implementation workflow

1. Read repository instructions, existing routes, design tokens, components and `docs/IMPLEMENTATION_PLAN.md` if present.
2. Identify the public landing route and verified app/demo destinations. Reuse the current stack and working patterns.
3. Summarize the implementation approach briefly, then implement. The scope and style are already specified; do not ask the user to choose a visual direction again.
4. Centralize the supplied Neumorphism tokens and component variants. Share tokens and primitives with the system UI prompt; scope page-specific layout so landing hero rules do not leak into authenticated app screens.
5. Implement the responsive landing sections, functional anchors, mobile menu, demo tabs, alert acknowledgement and FAQ.
6. Check desktop/mobile, keyboard use, text overflow, font loading, motion preferences and contrast. Document limitations honestly.

## Content and interaction requirements

- Product copy is calm, specific and understandable to families. Avoid “revolutionary”, “AI-powered ecosystem”, “bảo vệ tuyệt đối”, miracle claims and vague technology slogans.
- Do not fabricate user counts, clinical accuracy, detection speed, testimonials, partner logos, awards, prices, battery duration, patch lifetime, or emissions reduction.
- No stroke/dehydration prediction feature presented as validated. No combined risk score or invented hydration percentage.
- Shared UI does not mean shared unrestricted access to data. The landing page must not expose private records or credentials.
- Real signup/login links must use existing routes; the frontend cannot simulate production authentication by storing an `isLoggedIn` flag.
- Demo tabs and acknowledgement are local presentation interactions. Do not send emails, notifications, payments or real device commands.
- Loading/missing/offline statuses must remain distinguishable from normal observations, even with the subtle same-surface Neumorphism treatment.
- Preserve floating/depth motion in the default style. Respect `prefers-reduced-motion` by disabling nonessential floating/rotation and smooth scrolling for users requesting reduced motion; do not change the default design direction.
- Decorative concentric elements may float or rotate; critical text, health values and alert actions must remain stable and legible.
- Add accessible labels, keyboard-operable menus/tabs/accordions, focus handling and descriptive status text. Never rely only on shadows or color to communicate a state.

## Style-preservation notes and source inconsistencies

The `<design-system>` block is retained verbatim. Its numeric accessibility claims are not a test report. Direct calculation from its supplied hex pairs gives approximately:

- `#3D4852` on `#E0E5EC`: **7.38:1**, rather than the stated 7.5:1.
- `#6B7280` on `#E0E5EC`: **3.82:1**, rather than the stated 4.6:1.
- If white text is chosen on `#6C63FF`: **4.32:1**.

Do not silently change the palette or claim the complete page meets WCAG AA. Use the existing foreground token for essential smaller text where appropriate, measure rendered text/state combinations, and flag any remaining style-versus-accessibility conflict. A different foreground color or size for a specific state must be explicitly justified; do not redesign the style to hide the issue.

The source also mixes literal pixel descriptions with Tailwind utility names in its motion section. Check how the repository's spacing scale resolves those utilities. Do not introduce an arbitrary replacement motion system or claim contradictory values are equivalent; document the interpretation used.

## Acceptance criteria

- The Neumorphism style remains visibly faithful: same cool-grey surfaces, exact supplied fonts, opposing shadows, prescribed radii, nested depth and interaction character.
- Visitors can identify both products and understand why they share an application without reading technical implementation details.
- Every CTA has a real destination or meaningful local demo action.
- Demo content is visibly labeled; clicking acknowledge preserves “result not yet confirmed”.
- CareLens offline status remains distinct from a normal/safe status.
- No real patient data, fabricated proof, unsupported diagnoses or guaranteed outcomes appear.
- Public landing styles do not accidentally override unrelated app pages.
- Verify at mobile 360/390 px, tablet 768 px and desktop 1024/1440 px; no clipped hero content, overlapping shadows/text, broken menu or horizontal overflow.
- All supplied sections are implemented, with real mobile-menu, FAQ, tab and CTA behavior.
- Report the files changed, checks actually run, assumptions and remaining limitations. Do not claim backend, hardware or clinical validation from a frontend demo.

Deliver the implemented landing page in the existing project when this prompt is executed by a coding agent. Do not replace the requested implementation with a static poster or a design description alone.
</implementation-requirements>


<design-system>
# Neumorphism (Soft UI) Design System

## Design Philosophy

**Core Principles**: Neumorphism creates the illusion of physical depth through carefully balanced dual shadows—one light source from the top-left, one dark shadow falling bottom-right—on monochromatic backgrounds. Elements appear to either extrude from the surface (convex/raised) or be pressed into it (concave/inset). The effect mimics soft, pillowed physical objects with realistic lighting, creating a "molded from the same material" aesthetic. Every element feels like it's part of the same continuous surface, either raised or pressed, never flat.

**Vibe**: Tactile, calm, modern, and physically grounded. This is UI that feels like cooler matte plastic or soft ceramic. It is satisfying and tangible. The aesthetic is deliberately restrained, utilizing a cooler grey palette to feel fresh and distinct from "warm" legacy neumorphism. The design prioritizes accessibility with WCAG AA compliant contrast ratios while maintaining the soft aesthetic.

**Unique Visual Signatures**:
- **Dual opposing RGB shadows** (top-left light, bottom-right dark) using alpha transparency for smoother, more realistic blending than solid hex shadows.
- **Monochromatic "Cool Grey" discipline** (`#E0E5EC`) where shadows and highlights do all the visual heavy lifting. No flat backgrounds.
- **Same-surface illusion**: Elements appear to be part of the same material as the background—molded, not placed.
- **Deep Inset States**: Wells for icons and inputs that feel significantly deeper (`insetDeep`) than standard pressed states, creating true 3D depth.
- **Soft, Hyper-Rounded Corners**: `32px` for containers and `16px` for smaller elements, reinforcing the pillowed, organic aesthetic.
- **Complex Nested Depth**: Visuals formed by nesting elements (Extruded → Inset → Extruded) to showcase the physics of the system.
- **Smooth Micro-interactions**: 300ms transitions with scale, rotation, and shadow depth changes. Floating animations for ambient motion.
- **Mobile-First Responsive**: Fully responsive with touch-friendly targets (44px minimum), hamburger menu, and maintained neumorphic aesthetic on all screen sizes.

---

## Design Token System (The DNA)

### Colors (Light Mode - Cool Monochromatic)

The entire palette is built around a single base cool grey. **All visual interest comes from shadow play, not color variety.**

- **Background**: `#E0E5EC` — The base "cool clay" surface. Everything is molded from this.
- **Foreground**: `#3D4852` — Dark blue-grey for primary text. Excellent contrast (7.5:1 ratio) for optimal readability.
- **Muted**: `#6B7280` — Cool grey for secondary text with WCAG AA compliant contrast (4.6:1 ratio on the background).
- **Accent**: `#6C63FF` — Soft violet for interactive highlights. Used sparingly for CTAs and focus states.
- **Accent Light**: `#8B84FF` — Lighter violet for gradients and hover states.
- **Accent Secondary**: `#38B2AC` — Teal for success states, checkmarks, and positive indicators.
- **Border**: `transparent` — Neumorphism **never** uses borders; shadows define all edges.

**Shadow Colors** (CRITICAL - RGBA for Smoothness):
- **Shadow Light**: `rgba(255, 255, 255, 0.5-0.6)` — Pure white with transparency for the light-source shadow (top-left).
- **Shadow Dark**: `rgb(163, 177, 198, 0.6-0.7)` — A specific cool blue-grey shadow color that matches the background tone perfectly (bottom-right).

### Typography

- **Display Font**: **"Plus Jakarta Sans"** (500, 600, 700, 800) — Modern geometric sans for headlines. Applied via `.font-display` class.
- **Body Font**: **"DM Sans"** (400, 500, 700) — Clean, highly legible sans-serif for all body text and UI elements.
- **Weights**:
  - Display Headings: `font-extrabold` (800) with `tracking-tight`
  - Headings: `font-bold` (700) with `tracking-tight`
  - Body: `font-normal` (400) to `font-medium` (500)
- **Colors**:
  - Primary: `#3D4852` (excellent contrast)
  - Secondary/Muted: `#6B7280` (WCAG AA compliant)
- **Scale**: Responsive scale from `text-sm` (14px) to `text-7xl` (72px) for hero headlines

### Radius

- **Container / Card**: `32px` (`rounded-[32px]`) — Very soft, friendly corners.
- **Base / Button**: `16px` (`rounded-2xl`).
- **Inner Elements**: `12px` (`rounded-xl`) or `9999px` (`rounded-full`).

### Shadows & Effects (The Physics)

Shadows are defined using `rgba` for a premium, smooth finish.

**Extruded (Standard)** — The default resting state:
```css
box-shadow: 9px 9px 16px rgb(163,177,198,0.6), -9px -9px 16px rgba(255,255,255,0.5);
```
- **Tailwind**: `shadow-[9px_9px_16px_rgb(163,177,198,0.6),-9px_-9px_16px_rgba(255,255,255,0.5)]`

**Extruded Hover (Lifted)** — For hover states:
```css
box-shadow: 12px 12px 20px rgb(163,177,198,0.7), -12px -12px 20px rgba(255,255,255,0.6);
```
- **Tailwind**: `shadow-[12px_12px_20px_rgb(163,177,198,0.7),-12px_-12px_20px_rgba(255,255,255,0.6)]`

**Extruded Small** — For smaller elements:
```css
box-shadow: 5px 5px 10px rgb(163,177,198,0.6), -5px -5px 10px rgba(255,255,255,0.5);
```

**Inset (Pressed)** — For standard pressed states or shallow wells:
```css
box-shadow: inset 6px 6px 10px rgb(163,177,198,0.6), inset -6px -6px 10px rgba(255,255,255,0.5);
```

**Inset Deep** — For inputs, active wells, and deep "carved" elements:
```css
box-shadow: inset 10px 10px 20px rgb(163,177,198,0.7), inset -10px -10px 20px rgba(255,255,255,0.6);
```
- **Tailwind**: `shadow-[inset_10px_10px_20px_rgb(163,177,198,0.7),inset_-10px_-10px_20px_rgba(255,255,255,0.6)]`

**Inset Small** — For subtle tracks or pills:
```css
box-shadow: inset 3px 3px 6px rgb(163,177,198,0.6), inset -3px -3px 6px rgba(255,255,255,0.5);
```

---

## Component Styling

### Buttons
- **Shape**: `rounded-2xl`
- **Transition**: `duration-300 ease-out`
- **Default State**: Extruded shadow.
- **Hover State**: `translate-y-[-1px]` (slight lift) + `Extruded Hover` shadow.
- **Active/Pressed State**: `translate-y-[0.5px]` (physical press) + `Inset Small` shadow (or standard inset depending on size).
- **Primary**: Accent background `#6C63FF`. Active state uses specific rgba inset shadows to work on color.
- **Secondary**: Background `#E0E5EC` (match page).

### Cards
- **Shape**: `rounded-[32px]` (Significant rounding).
- **Background**: `#E0E5EC`.
- **Padding**: `p-8` to `p-20` depending on prominence.
- **Hover**: `translate-y-[-2px]` + `Extruded Hover` shadow.
- **Feature**: Use nested depth. Card is Extruded -> Icon well inside is Inset Deep -> Icon inside is distinct.

### Inputs
- **Shape**: `rounded-2xl`.
- **Background**: `#E0E5EC`.
- **Default**: `Inset` shadow.
- **Focus**: `Inset Deep` shadow + Accent color Ring (offset by 2px with background color).
- **Placeholder**: `#A0AEC0`.

### Visual Decorations
- **Icon Wells**: Always use `Inset Deep` or `Inset` shadows for icon containers. This makes them look "drilled" into the card.
- **Decorations**: Use concentric circles of alternating Extruded and Inset shadows to create abstract, tactile background art.

---

## Layout Principles

- **Spacing**: Open and airy. Use `py-32` for hero sections to let the shadows breathe. `gap-12` for grids.
- **Container**: `max-w-7xl` for a wide, modern feel.
- **Background**: The page background must be `#E0E5EC` globally. No gradients on the root background.

## Animation & Micro-interactions
- **Duration**: `300ms` for UI elements, `500ms` for nested depth circles (weightier, physics-based feel).
- **Easing**: `ease-out` for natural deceleration.
- **Properties**: `transform` (scale, translateY, rotate), `box-shadow` (depth changes).
- **Hover Effects**:
  - Cards: `-translate-y-1` (1px lift) + enhanced shadow depth
  - Buttons: `-translate-y-1` on hover, `translate-y-0.5` on active (press down)
  - Nested circles: `scale-105` (5% scale up) + `rotate-180` on inner element
- **Floating Animation**: Custom `@keyframes float` with 3s ease-in-out infinite loop for ambient motion on decorative elements.
- **Smooth Scrolling**: `scroll-behavior: smooth` for anchor navigation.

## Accessibility
- **Contrast**:
  - Primary text `#3D4852` on `#E0E5EC`: 7.5:1 (WCAG AAA)
  - Muted text `#6B7280` on `#E0E5EC`: 4.6:1 (WCAG AA)
- **Focus States**: Visible 2px accent rings (`ring-2 ring-[#6C63FF]`) with 2px offset on `#E0E5EC` background. Mandatory on all interactive elements.
- **Touch Targets**: Minimum 44x44px for mobile (buttons use `h-12 w-12` = 48px minimum).
- **Mobile Navigation**: Hamburger menu with clear open/close states (Menu/X icons).
- **Keyboard Navigation**: Full keyboard support with visible focus indicators on all links and buttons.

## Responsive Design

- **Mobile First**: Design starts with mobile view and enhances upward.
- **Breakpoints**: `md:` (768px) for tablet, `lg:` (1024px) for desktop.
- **Mobile Adaptations**:
  - Hero visual shows on all screens with `max-w-md` constraint on mobile
  - Hamburger menu replaces desktop navigation below `md:` breakpoint
  - Grid layouts collapse: 3-column → 1-column, 2-column → 1-column
  - Font sizes scale down: `text-7xl` → `text-5xl` on mobile
  - Padding reduces: `p-16` → `p-8` on cards
- **Navigation**: Sticky header with backdrop blur. Mobile menu slides down from header with extruded shadow.

---

## Anti-Patterns (Do Not Do)
- **Hard Hex Shadows**: Do not use opaque hex codes for shadows (e.g., `#A3B1C6`). Use `rgb(... 0.6)` for transparency and blending.
- **White Backgrounds**: Never use `bg-white` for cards. They must match the body background `#E0E5EC`.
- **Flat Buttons**: Buttons must have depth (shadows). No flat designs.
- **Sharp Corners**: `rounded-lg` is too sharp. Use `rounded-2xl` (16px) or `rounded-3xl` (24px) minimum.
- **Poor Contrast**: Never use `#8B95A5` or `#A0AEC0` for body text. Use `#6B7280` or darker for WCAG compliance.
- **Missing Focus States**: All interactive elements must have visible focus indicators.
- **Block Display for Fonts**: Use `display=swap` in Google Fonts URL, not `display=block`.
</design-system>