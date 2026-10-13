# CareLens + EcoPatch System UI Implementation Prompt

Use this prompt for the application screens that follow the public landing page. The Neumorphism design system at the end is identical to the supplied landing-page design system. This document specifies UI implementation; it does not claim that an application, backend or hardware integration has already been built.

<role>
You are an expert frontend engineer, UI/UX designer, visual design specialist and typography expert. Build or adapt the functional system UI for the shared CareLens + EcoPatch platform using the same Neumorphism / Soft UI visual system as its landing page.

Before editing code, read repository instructions and inspect the current stack, routes, authentication, API contracts, components, tokens, global styles and tests. Preserve working architecture and behavior. Reuse the approved landing components and tokens where available; do not create a second independent theme.

Read `docs/IMPLEMENTATION_PLAN.md` if available. Follow its product, data, role and workflow requirements. The user's selected Neumorphism direction supersedes the older provisional A/B style directions. Do not ask the user to choose the style again.

Implement the screens and working interactions in milestones. If hardware or APIs are absent, use typed adapters and visibly labeled synthetic fixtures. State what is mocked and what is actually integrated. Do not turn a UI implementation into an unrequested rewrite of AI, firmware, payment systems or the database.

Use Vietnamese for visible text and English for identifiers. Give concise progress updates and report actual validation results, rather than claiming success based only on generated code.
</role>

<scope>
## One platform with two modules

The care recipient is the central context. One recipient can have CareLens, EcoPatch or both. An account can care for multiple recipients, and a recipient can have several authorized caregivers.

- Shared: account/session, onboarding, recipient profiles, devices, alerts, notes, history, reports, sharing permissions and notification settings.
- CareLens: AI-generated care events, descriptions, timestamps, review outcomes, hub status and restricted operator settings. No live-camera page or image/video archive.
- EcoPatch: supported measurements, signal quality, core status, patch sessions and replacement reminders. No fabricated hydration, ECG, SpO2 or disease prediction when the source does not provide validated data.
- Operations: device/account diagnostics for permitted operators; platform administration does not automatically grant access to health data.

This task covers the login/onboarding entry and operational application UI. Preserve the public landing page and connect it to verified routes. The existing landing prompt continues to govern landing content; both surfaces share the design foundation.

Do not build billing, subscription checkout, hospital/EHR integrations, AI training screens or a medical-advice chatbot. Do not create a combined health score from CareLens and EcoPatch.

UI permission visibility is not security. Real API actions require server authorization. If the repository has no backend, deliver a clearly separated demo mode and API adapters; never represent the demo as production-secure authentication or a real hardware connection.
</scope>

<shared-design>
## Preserve the supplied visual identity

Preserve all exact visual tokens and shadow recipes in `<design-system>` below:

- Cool-grey `#E0E5EC` page, panel and input surfaces. No white dashboard cards or module-specific green/blue themes.
- Foreground `#3D4852`, muted token `#6B7280`, violet accent `#6C63FF`, light violet `#8B84FF`, teal `#38B2AC` for the uses specified in the source.
- Plus Jakarta Sans for headings, DM Sans for body and controls, with the supplied weights and `display=swap` font loading.
- 32 px main containers, 16 px controls, and the supplied smaller/nested shapes.
- Exact opposing RGB/RGBA shadows, raised resting states, inset selected/pressed states and deep inset input/icon wells.
- Same 300 ms interaction character, 500 ms decorative nested-depth treatment, and specified floating/concentric details where decorative visuals are used.
- Visible accent focus rings and touch targets at least 44 by 44 px.

Do not subtly replace the supplied system with a flat table dashboard, darker SaaS theme, glass cards, a new radius scale or differently colored surfaces. Reuse approved product logos; `CareLens + EcoPatch` is a descriptive platform label, not an instruction to invent a new logo.

## Adapt composition to tasks without changing the style

The landing page explains the product; the application supports repeated tasks. Carry the same material, typography and interactions into compact working layouts rather than repeating the landing hero on every screen.

- Use a 32 px raised main panel with 32 px internal padding as the normal card treatment. Keep larger padding for prominent onboarding/empty-state illustrations as appropriate.
- Use the existing heading scale for page and section headings; reserve the hero's largest sizes for the landing. Use 16 px body text and readable secondary labels within the supplied type scale.
- Keep large section grids airy and place dense records inside one raised panel. Do not wrap every table cell in its own large shadow.
- Separate rows with whitespace, alignment and the supplied subtle inset treatments rather than visible borders. Preserve label/value hierarchy and readable column alignment.
- Main surfaces remain stable while reading. Hover/pressed feedback belongs to interactive elements; moving critical numbers or floating alert text is not an ambient decoration.
- Decorative concentric depth may appear in onboarding and empty states. Do not place it behind forms, charts or operational alerts.
- Use the same icon family and stroke style across landing and app. Icons sit in the specified inset wells where a container is used; retain visible text labels for important actions.
- The source's default light visual identity is the target. Do not invent or prioritize a new dark mode in this task.

## Accessibility notes without palette replacement

The source block remains unchanged, but its numeric contrast claims are not verified accessibility results. Calculated solid-color ratios are approximately 7.38:1 for `#3D4852` on `#E0E5EC`, 3.82:1 for `#6B7280` on that background, and 4.32:1 for white text on `#6C63FF`.

Use the existing foreground token for essential small labels, timestamps needed for decisions, units and warning text. Do not rely on muted text, shadows or teal alone for important state distinctions. Check each rendered text/control combination; report unresolved conflicts honestly instead of silently changing the palette or claiming the full app is WCAG AA compliant.

Within the original monochromatic palette, express urgency through explicit wording, icon, placement, weight and action priority. Teal indicates a successful operation where appropriate, not that the care recipient is healthy. Do not introduce an unapproved red/amber color system; if deployment requires additional semantic colors, document that as a separate design decision.

Preserve default motion recipes and support `prefers-reduced-motion` for nonessential motion. Inspect how the repository's spacing scale resolves the source's Tailwind motion utilities where they differ from literal pixel annotations. Record the chosen interpretation, rather than claiming the inconsistent values are equivalent.
</shared-design>

<information-architecture>
## Shared application shell

Use current repository routes when they exist. The routes below align with the implementation plan and are suggestions, not instructions to break established URLs.

- Public `/`: landing page; optional explicit `/demo` entry for synthetic previews.
- `/login`: existing account sign-in flow.
- `/onboarding`: initial group/profile/product/device setup.
- `/people`: authorized care-recipient list and selection.
- `/people/:recipientId/...`: operational screens scoped to a recipient.
- `/settings/notifications`: current user's notification preferences.
- `/admin`: restricted operations only when supported.

Desktop: persistent raised sidebar, sticky app header and flexible content area. Show the recipient context prominently in the header with a real selector only when more than one recipient is available. Keep current page label, data freshness and demo indicator visible without duplicating navigation.

Navigation: `Tổng quan`, `CareLens`, `EcoPatch`, `Cảnh báo`, `Thiết bị & hướng dẫn`, `Lịch sử`, `Báo cáo`, `Gia đình & quyền truy cập`. Account settings and sign-out are separate from recipient navigation.

Only render product navigation for enrolled products the user can access. A disabled or unavailable module has a clear reason on the appropriate setup screen; it is not a misleading empty dashboard.

Mobile below `md:`: use the specified hamburger Menu/X treatment and raised slide-down navigation. Keep the selected recipient and current screen visible. Use one primary navigation mechanism; do not add a competing bottom navigation bar by default.

At `md:` tablet sizes, reduce columns when content requires it. At `lg:` desktop sizes, restore sidebar/multi-column layout. Never scale an entire desktop canvas down to simulate mobile. Respect browser zoom, safe areas and the on-screen keyboard.

Changing recipient must cancel or ignore stale requests, clear previous recipient state, rescope streams and close recipient-specific dialogs. A late response from the previous profile must never appear in the new one.
</information-architecture>

<screens>
## Required screens and behaviors

### S01 — Account entry

Build `/login` with raised form panel, deep inset inputs, visible labels, password visibility control, submitting/error states and the existing real session flow. Offer password recovery or account creation only where supported. Use generic authentication errors that do not reveal whether an account exists.

Do not use a `localStorage.isLoggedIn` flag as production authentication. In demo mode, use an explicitly named `Vào bản demo` route/action with synthetic users; do not pretend it verifies real credentials. Preserve safe return navigation after login and expired sessions.

### S02 — Onboarding

Steps: `Hồ sơ chăm sóc` → `Chọn giải pháp` → `Kết nối thiết bị` → `Người chăm sóc` → `Kiểm tra thông báo`.

Show progress through the supplied raised/inset vocabulary, back/next actions, field validation and resumable draft state when the backend supports it. The hardware step can use a demo pairing adapter, visibly labeled. Unavailable hardware may be skipped into a clearly incomplete setup, not falsely marked connected.

Pairing must include a supported ownership challenge; a scanned QR or serial alone is not proof of ownership. A notification test must have a test label and use a local sink in demo mode.

### S03 — Recipient selection

List only authorized recipients in raised cards. Each shows the name, enrolled products, connectivity/freshness and open-alert count if provided by the source. Do not invent avatars of real patients, health scores or normal states. Selecting a card opens its overview. Profile creation/editing is visible only for permitted users.

### S04 — Overview

Route: `/people/:recipientId/overview`.

Information order:
1. Selected recipient and source freshness.
2. Open alerts requiring action, with source, time, severity label and assignee.
3. One CareLens summary and one EcoPatch summary when enrolled.
4. Upcoming tasks such as a configured patch replacement.
5. Recent event/note/action timeline.

Primary CTA: `Xem và xử lý` for an actionable alert. When there is none, show `Không có cảnh báo đang mở` and source connectivity separately; never translate an empty alert list into `Người thân đang an toàn`.

CareLens summary: latest care event, hub connection and last seen. EcoPatch summary: available measurement/unit, observed time and quality. Avoid an ornamental row of four or six KPI cards without a user task behind each.

### S05 — CareLens

Route: `/people/:recipientId/carelens`.

Provide filters for time and event category/severity that actually change the displayed records. Show chronological events, short AI descriptions, source, review state and a detail view. Keep raw care level, if supplied, labeled as an AI score rather than a probability of disease or correctness.

A persistent source-status panel distinguishes connected, stale, disconnected and unavailable local access. For a local-only hub unavailable from the current network, show that access limitation; do not upload event history to cloud to make the view appear complete.

No video grid, camera thumbnail, face recognition UI, image upload for inference or recording timeline. Do not invent medication-adherence confirmation without a defined event source.

### S06 — EcoPatch

Route: `/people/:recipientId/ecopatch`.

Show supported metric cards, timestamp, unit, signal quality and a useful selectable time range. Render charts from typed source data; show gaps for missing data. Waveform preview exists only if the adapter provides ECG samples with units and sampling metadata. Use a bounded window, not an unbounded live SVG containing every sample.

Present the reusable core and disposable patch as related but separate objects. Show core connection and battery only if provided. Show patch start date, optional lot number, current session and configured replacement date or `Chưa đặt lịch thay`.

The `Thay miếng dán` action opens S09. Do not equate GSR with hydration/electrolyte levels or imply validated stroke/dehydration prediction. No inferred “optimal” heart-rate zones or diagnostic labels in synthetic charts.

### S07 — Alert list

Route: `/people/:recipientId/alerts`.

Use one raised list/table panel with filters for source, time, processing status and assignee where supported. Columns: event time, product/source, description, severity label, processing state, assignee and action. On mobile, turn records into readable stacked rows with the same information and one explicit detail action.

Provide pagination/cursor loading. Filter empty results must differ from fetch failures. Live events must not unexpectedly reorder the row the user is operating on; show a new-item indicator when appropriate.

### S08 — Alert detail and processing

Route: `/people/:recipientId/alerts/:alertId`.

Show event facts, source and data age before actions. Separate original AI observation from human outcome. Preserve the processing flow:

- `open`: `Chưa tiếp nhận` → action `Tiếp nhận kiểm tra`.
- `acknowledged`: `Đã tiếp nhận` → `Bắt đầu xử lý` or record an outcome and resolve.
- `in_progress`: `Đang xử lý` → record outcome and resolve.
- `resolved`: `Đã xử lý`, with actor, time, outcome and note.

Outcome is a separate field: `Xác nhận sự kiện`, `Báo động sai`, `Chưa xác định`. Resolving requires a selected outcome and an action note according to the contract. Acknowledge never confirms AI correctness and never closes the alert automatically.

Show a chronological audit of actions and escalation. Escalation is a recorded action, not a replacement processing status. Prevent duplicate submissions; handle a conflict when another caregiver already claimed the alert by showing current server state. Keep user-entered notes on recoverable errors.

### S09 — Devices, guidance and patch replacement

Route: `/people/:recipientId/devices`.

Show assigned devices, product, connection, last seen, available diagnostics and permitted actions. Include pairing guidance and troubleshooting appropriate to the source capability. Never report “đã kết nối” only because a timeout or animation ended.

Patch replacement form: identify core and recipient, show the current patch session, enter start time and optional lot/replacement date, then submit one idempotent replacement action. Preserve previous sessions and core configuration. Do not label success until the API confirms it; in demo, label the result as simulated.

Unpairing or reassigning a device requires a confirmation describing the actual effect and respects historical assignment. Operator-only configuration must have permission checks, validation and an audit trail. Do not show unrestricted model switches to ordinary caregivers.

### S10 — History and notes

Route: `/people/:recipientId/history`.

Provide one filterable timeline for care events, reviews, notes and patch changes with stable source/type labels. Adding a note has a visible label, validation, save feedback and author/time. Keep human notes distinct from AI descriptions; do not silently replace either.

### S11 — Reports and export

Route: `/people/:recipientId/reports`.

Show a date range, products included, timezone and available coverage. Summaries may include open/resolved alert counts, review outcomes and recorded patch changes. Explain denominators and missing data. Do not calculate AI sensitivity or a health score from the observed alert list.

Provide CSV export only with the correct permission. Show pending/ready/failed state, filename and scope. Recheck permission on download. Demo exports retain a simulated-data label. Do not create a PDF export button unless that format is implemented.

### S12 — Family and access

Route: `/people/:recipientId/sharing`.

Show people with access, role/permissions, invitation state and expiry where relevant. Distinguish group membership from access to this recipient. Implement invite, review scope and revoke actions only for users with the right permissions.

Revocation confirmation explains whose access is removed and to which profile. After success, invalidate relevant local data; backend streams, exports and queued notifications must obey revocation. If those backend guarantees are absent, explicitly record them as integration gaps instead of claiming the UI has enforced them.

In demo mode, invitations remain in the local notification sink; do not send real messages automatically.

### S13 — Notification preferences and account

Route: `/settings/notifications` and existing account routes.

Show available delivery channels, browser permission state, test status, recipients/escalation settings allowed by the contract and account sign-out. Distinguish in-page SSE/WebSocket updates from out-of-page Web Push. Show unsupported/denied states and actionable instructions without claiming notification delivery is guaranteed.

Do not invent contact destinations or enable providers that are not configured. Test notifications require an explicit test action and use synthetic data.

### S14 — Restricted operations

Route: `/admin` if supported by scope and permissions.

Provide device/service diagnostics, integration failures and account support information. Platform admin does not automatically see health histories. Prefer a small, functional operations view; postpone inventory, revenue dashboards and subscription management.
</screens>

<components-and-states>
## Shared components

Reuse or create a small foundation: `SoftSurface`, `SoftButton`, `InsetField`, `IconWell`, `SoftTabs`, `StatusLabel`, `Dialog`, `Drawer`, `EmptyState`, `InlineError` and loading states. Follow existing naming conventions rather than requiring these literal names.

Then add domain components: recipient switcher, source freshness, device status, alert row/detail, event timeline, measurement panel, patch session and grant editor. Landing previews should reuse these domain components in a read-only/demo configuration rather than maintain unrelated markup.

Expose depth through deliberate variants such as raised, raisedSmall, inset, insetDeep and insetSmall using the exact supplied values. Centralize tokens once; the duplicated design block in documents is not a reason to duplicate CSS in code.

## Required state matrix

| Context | States that must exist |
| --- | --- |
| Data | Loading, populated, genuinely empty, filtered empty, fetch error |
| Source | Connected, stale, disconnected, local access unavailable, unknown |
| Mutation | Idle, invalid input, submitting, confirmed success, failed, conflict |
| Access | Authorized, read-only, forbidden, invitation pending/expired, session expired |
| Device | Unpaired, verifying, assigned, reassignment pending, unsupported capability |
| Demo | Synthetic source badge, local action feedback, resettable fixture state |

All meaningful actions must work, be explicitly unavailable with a reason, or be omitted. Do not leave decorative buttons that show a generic toast instead of performing their named task.

Use semantic forms/tables/controls; associate errors with fields and provide a useful error summary when needed. Dialogs/drawers have a title, proper focus handling, escape/close behavior and return focus. Preserve unfinished form data through recoverable errors and confirm discard where appropriate.
</components-and-states>

<data-and-integration>
## Integration boundaries

- Reuse the contracts and API prefix from the implementation plan/repo. Do not point the UI at guessed CareLens endpoints or invent telemetry fields to satisfy a design.
- Expose a typed data adapter so mock and real modes use the same UI contract. Production must fail visibly rather than silently falling back to fake values after an API error.
- Keep `source_mode`, `observed_at`, `received_at`, unit, quality, product and source identity available where relevant. Show the appropriate timestamp; late arrivals must not overwrite more recent observations.
- Client filters improve usability; server authorization governs actual access. Scope requests and cache keys to account, group, recipient, product and relevant filters.
- De-duplicate streamed events by stable source ID. Reconnect using the server's supported cursor/reload mechanism. Clean up streams on navigation, logout and permission changes.
- Use server-confirmed mutation results for care actions. Optimistic updates are allowed only where rollback and conflicts are handled accurately; never optimistically claim a device is paired, a message reached a person or an alert is clinically confirmed.
- CareLens raw frames never enter the web application database, logging, export, analytics or a new cloud upload flow. Text descriptions are still private data.
- Shared access to local CareLens and remote EcoPatch requires a real authenticated connectivity design. The UI must express unavailable sources rather than bypass those boundaries.
- No real notifications, patient data or device commands in demo fixtures. No patient/session replay analytics by default.
</data-and-integration>

<implementation-order>
## Delivery order

1. **Inspect and align:** identify existing routes, data contracts and landing primitives; remove obsolete A/B styling references from the active implementation direction.
2. **Shared foundation and shell:** fonts, exact tokens/depth variants, controls, recipient context, desktop/mobile navigation and state components. Check that the landing still renders correctly.
3. **Vertical slice:** S03–S08 with one synthetic recipient, both modules and a complete alert review flow. Add S01/S02 integration as required by the existing authentication/setup architecture.
4. **Lifecycle and collaboration:** complete onboarding, device pairing, patch replacement, history/notes and family access.
5. **Reports and settings:** exports, notification preferences and minimal permitted operations UI.
6. **Validation and handoff:** responsive/keyboard checks, permissions and mutation behavior, reconnect/conflict cases, synthetic-data labeling and documentation.

Work through the authorized UI scope without stopping after a polished overview screen. If an external dependency blocks a screen, implement its honest unavailable state, document the gap, and continue independent work. Do not introduce repeated approval gates for a visual direction the user has already specified.

## Acceptance and handoff

- Landing and app use the same tokens, fonts, shadows and controls. Navigating between them must feel like one product.
- Test actual layouts at 360, 390, 768, 1024 and 1440 px, including dialog and mobile keyboard states. Prevent overflow, hidden primary actions and shadows clipping adjacent content.
- Verify real behavior: switch recipient without leaked/stale content; change product tabs; filter lists; open/claim/review an alert; replace patch without duplicate sessions; revoke access; export within permission.
- Test API errors, expired session, forbidden responses, an already-claimed alert, duplicate events, late measurements and disconnected sources. Do not count a mock-only UI test as proof of backend isolation.
- Check keyboard navigation, focus, labels, text contrast and reduced-motion behavior. Record any unresolved source-style/accessibility conflict rather than asserting blanket compliance.
- Confirm no unsupported metric, fake certainty, real-person fixture or clinical performance claim appears.
- Document implemented screens, their mock/real status, shared component locations, how to run the demo, checks actually run and blocked integrations.

Suggested deliverables in the target repo: implemented UI source, reusable tokens/components, typed adapters, synthetic fixtures, focused tests, updated README and a concise `docs/UI_IMPLEMENTATION_STATUS.md`. Follow existing documentation locations when they already serve these purposes.
</implementation-order>


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