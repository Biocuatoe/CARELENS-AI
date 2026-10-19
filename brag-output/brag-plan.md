# CareLens AI · DAYONE — 30-second pitch introduction · creative plan

Status vocabulary (AGENTS.md §2): **Yêu cầu PRD** / **Đề xuất trong tài liệu** / **Đã kiểm chứng**. Everything in this film is a *simulated product
scenario built from the repository's own landing page*. Nothing in it is a verified device capability.

## 1. Brief → decisions

| Brief | Decision |
| --- | --- |
| Ground the film in the real frontend | The composition imports the landing page's own code: `lib/hardware3d` (STL enclosure + GLB/procedural components, `animationConfig.BEATS`, `timeline.evaluate`), `lib/careScene` (`FallScene`, `MedicationScene`, figure, hub, data packet), `features/landing/content.ts` (all Vietnamese copy), `Brand.tsx` (the CareLens AI wordmark), `design-system/tokens.css` (palette) and the landing's own button/tag/timeline/notification markup. Nothing is re-modelled. |
| Condense, do not invent | Scenario order, captions and states come from `FALL`, `MEDICATION`, `PRIVACY`, `SECURITY_SCENE`, `DAILY_REPORT`. The only new copy is what the brief dictates (greeting, "Thiết kế nhỏ gọn…") plus short connective labels taken from existing strings. |
| Exactly 30 s, 1920×1080, 30 fps | 900 frames; every animation is a pure function of `t = frame / 30`, so any frame can be re-rendered alone. Scene boundaries sit on beats of a 120 BPM score. |
| Cinematic, not slides | Continuous camera work on real 3D (push-in to the lens → pull-back reveal → lid → explode → close-ups; fall camera; observation camera; lens-fill push), light flashes, one iris-style hand-over into the greeting. |
| No EcoPatch, no invented brand | Only CareLens AI. "DAYONE presents · CareLens AI" appears as small text (opening) and "DAYONE" as small text (ending). No logo was invented; the wordmark is `Brand.tsx`'s `LensMark` + "CareLens AI". |

## 2. Exact timed storyboard (sum = 30.000 s)

| # | Time | Dur | Scene | What happens | On-screen text (Vietnamese, from source) |
| --- | --- | --- | --- | --- | --- |
| 1 | 00:00.000–00:03.000 | 3.0 | Hook | Darkness. A narrow spot travels along the real enclosure and settles on the 8×8 mm camera window while the camera pushes in. Power-up sound opens the score. Frame 0 carries the poster composition. | `DAYONE presents · CareLens AI` · `SEE MORE.` `STORE LESS.` `CARE BETTER.` |
| 2 | 00:03.000–00:08.500 | 5.5 | Hardware | Pull-back reveal (lights come up) → lid lifts (`p` 0.08→0.20) → components separate on the landing's own paths (`p` 0.20→0.58) with 7 labels → close-up on the camera board, then the GY-521. | `Thiết kế nhỏ gọn. Nhiều thành phần phối hợp.` · stage title from `STAGES` · labels = `BEATS[].title` (Camera ESP32-S3, Cảm biến chuyển động GY-521, Pin Li-Po dẹt, Mạch sạc TP4056, Loa 8 Ω mini, Bộ khuếch đại âm thanh, Công tắc trượt BẬT/TẮT) · close-up cards = `BEATS` title + first sentence of its text |
| 3 | 00:08.500–00:14.000 | 5.5 | Fall (Tình huống 01) | Soft flash bridge. Older adult loses balance and falls (non-graphic, stylised figure); wearable ring; call-outs on camera + motion sensor; pipeline Thiết bị đeo → Hub → Máy chủ đám mây CareLens AI → Ứng dụng; event card; **Tiếp nhận kiểm tra** is pressed → `Đã tiếp nhận · Chưa có kết quả kiểm tra`. | `FALL.eyebrow` · `Ví dụ sự kiện chăm sóc` · `Có thể có người nằm trên sàn phòng khách.` · `Nhận định của AI, chưa được người chăm sóc xác nhận.` · `Tiếp nhận kiểm tra` · step chips from `FALL.steps` · `Ví dụ` tag |
| 4 | 00:14.000–00:19.500 | 5.5 | Medication (Tình huống 02) | Example day timeline (`MEDICATION.slots`): 08:00 reminder window opens, speaker note. Cut into the observation scene: hand and glass → camera sees → packet → hub (the real `MedicationScene`, chapter 0). Observation note card. | `Nhắc đúng lúc. Hỏi lại khi chưa thấy dấu hiệu.` · `Loa có thể nhắc nhẹ` · `Giờ nhắc do người chăm sóc đặt.` · note `Cầm ly nước — Hub ghi nhận một lần cầm ly nước ở bếp. Chưa xác nhận đó là việc dùng thuốc.` · `Có ghi chú quan sát` |
| 5 | 00:19.500–00:23.500 | 4.0 | Privacy | The hub frame is dimmed; "image data" mosaic collapses into text lines; text-only event card appears; messages stack with a hierarchy. | `Thấy đủ để chăm sóc. Không hơn.` · `Ứng dụng chỉ hiển thị mô tả sự kiện.` · `Không có ảnh/video hay camera trực tiếp trong ứng dụng.` · `Người được chăm sóc có công tắc BẬT/TẮT vật lý.` · `Mỗi người chỉ xem hồ sơ được cấp quyền.` (`PRIVACY.principles[2]`) · `Minh hoạ luồng dữ liệu, không phải bằng chứng kỹ thuật về bảo mật.` |
| 6 | 00:23.500–00:26.000 | 2.5 | The photograph | Same device, facing the viewer; dolly in until the lens fills the frame; light gathers; viewfinder corners; mechanical shutter cue at 25.22 s; clean white flash at 25.27 s (full white by 25.40 s), held to 26.0 s. | none (viewfinder `CareLens AI` label only) |
| 7 | 00:26.000–00:30.000 | 4.0 | 20/10 greeting | The warm card opens from the centre of the flash like an iris (masked reveal over white); petals and blossoms drift; type settles by 28.4 s and is static through the last frame. | `Chúc mừng Ngày Phụ nữ Việt Nam 20/10` · `Trân trọng những người luôn yêu thương và chăm sóc chúng ta.` · CareLens AI wordmark · `DAYONE` |

## 3. Accuracy guard-rails (what the film deliberately does *not* say)

* **No confirmed diagnosis / guaranteed fall detection.** The fall card is labelled `Ví dụ`, the description is "nhận định của AI, chưa được người chăm sóc xác nhận", and acknowledgement is "Đã tiếp nhận · Chưa có kết quả kiểm tra" — *not* resolved.
* **Medication:** only an *observation note* (`Có ghi chú quan sát`, "Chưa xác nhận đó là việc dùng thuốc"), never "đã uống thuốc".
* **Hardware:** only the repository's own component names and first-sentence descriptions are shown; no specifications, battery capacity, range, accuracy, latency or certification appears. (Revision 2 removed the on-screen "estimated / unverified" footnote and per-component notes at the owner's request; the repository's `BEATS[].note` fields still record those uncertainties.)
* **Privacy:** no claim that frames never leave the device, no encryption/anonymisation/hash claim, no padlock, no hash animation (the landing's shield / hex-digest chapter is intentionally *not* used). The flow strip follows the repository's own wording (hub → máy chủ đám mây CareLens AI → ứng dụng) and states that the strip is an illustration. What is claimed is only what `PRIVACY` / `SECURITY_SCENE.steps[2]` already claim: the *application* shows text descriptions only; the app has no photo/video/live-camera view; the wearer has a physical ON/OFF slide switch; each person only sees profiles they are granted.
* **Simulated**: all people, scenes and cards are synthetic (`CapabilityTag` "Ví dụ" on every interface card). No real patient photo or data.
* The shutter/flash is a *cinematic transition*; it is not presented as a verified photo-shutter feature.
* Greeting is generic and non-commercial; no medical claim.

## 4. Sound

120 BPM, D major / B minor, procedural (numpy, no samples, no third-party audio, no voice-over — see limitations). Score: a dark drone and activation sweep (0–3 s) → riser and impact at the reveal (3.0 s) → pads, plucked 8th-note arpeggio and soft four-on-the-floor for the hardware/fall/medication run → drums drop out for the privacy scene → tension riser with a quickening pulse → shutter → warm D-major-add9 resolve with bell melody. SFX: activation sweep, spot shimmer, lid latch + slide, per-component click-whirr + landing tick (timed to `PART_WINDOWS`), label blips, flash swoosh, pipeline pings, button click, success chime, speaker reminder chime, shutter (two-part), flash ring. Mastered with ffmpeg `loudnorm` (−16 LUFS, −1.5 dBTP).

## 5. Technical pipeline (all inside `brag-output/`)

```
composition/            editable source (Vite + React + three). Imports ../../frontend/src via the "@fe" alias; assets copied to public/
  src/timing.ts         the storyboard clock (scene boundaries, easing helpers)
  src/main.tsx          per-frame director: t -> 3D poses/cameras/lights -> overlay props
  src/hardware.ts       HardwareDirector (real assembly + timeline), custom camera/lights
  src/careScenes.ts     FallDirector / MedDirector (drive the landing scenes by progress instead of scroll)
  src/Overlay.tsx · OverlayStories.tsx · Greeting.tsx   all 2D layers
  scripts/render.mjs    deterministic frame renderer (headless Chromium + software WebGL, 4 workers)
  scripts/audio.py      soundtrack synth      scripts/encode.sh   mux/encode      scripts/validate.py   delivery checks
audio/soundtrack.wav · brag.mp4 · brag.jpg · share-copy.txt · brag-plan.md
```

Re-render: `cd frontend && npm ci`, `cd ../brag-output/composition && npm ci`, then
`node scripts/render.mjs --out ../_render/frames --workers 4 --pr 1.25`, `python3 scripts/audio.py --out ../audio/soundtrack.wav`,
`bash scripts/encode.sh ../_render/frames ../audio/soundtrack.wav ..`, `python3 scripts/validate.py ..`.
The standard `/brag` workflow favours shorter videos; the 30 s duration is the brief's explicit requirement and was not shortened.

## 6. Validation results (run on the delivered files, `python3 composition/scripts/validate.py .`)

| Check | Result |
| --- | --- |
| `brag.mp4` exists, decodes end-to-end with no errors | PASS (15.9 MB, `ffmpeg -v error -f null` clean) |
| Duration | PASS — container 30.0000 s, video stream 30.000000 s, audio stream 30.000000 s |
| Resolution / frame rate / frames | PASS — 1920×1080, 30/1 fps, 900 frames, H.264 High yuv420p, AAC stereo |
| Loudness | integrated −15.8 LUFS, true peak −1.2 dBFS (ebur128) |
| Final 4 s (26.0–30.0) show the 20/10 greeting | PASS — inspected frames at 26.0, 26.5, 27.5, 29.0, 29.9; text is fully on screen from 28.4 s and static to the last frame |
| `brag.jpg` | PASS — extracted from frame 0 of `brag.mp4` (poster composition is baked into frame zero) |
| `share-copy.txt`, `brag-plan.md`, `composition/` | PASS |

Pre-render stills were inspected for every scene and for the transitions 2→3 (flash), 3→4, 4→5, 5→6, 6→7 (flash → iris), plus a contact sheet of ~60 frames. Fixes made from that review: Vietnamese-capable monospace face (system monospace broke stacked diacritics), headline size/collision in scene 2, right label column clipping, call-outs covering the figure's face, backing panels behind step chips, brighter flash bridge, lens-centred final push, flash→greeting mask.

## 7. Known limitations

* **No voice-over.** No high-quality natural Vietnamese TTS is available offline; the brief allows on-screen text only in that case. The soundtrack is original procedural music + SFX. It was measured (levels, peaks, loudness) but could not be *listened to* in this environment — a human listen is recommended before publishing.
* **No true per-frame motion blur** (selective motion blur was requested): moves are smooth and transitions use blooms/flashes/masks instead.
* The figure, room, hub and data packet are the landing page's own stylised synthetic assets; the fall is deliberately simple and non-graphic.
* Hardware parts are the repository's CAD/procedural models; sizes/variants/placements remain **estimated or unverified** exactly as the repository states; the film no longer carries an on-screen disclaimer about it (removed in revision 2 at the owner's request).
* "DAYONE" is plain text (no official DAYONE logo exists in the repository, none was invented).
* The scene-1 spot is a soft circular highlight, not a literal thin strip of light.
* Rendering uses software WebGL (SwiftShader) in headless Chromium at pixel ratio 1.25; the full 900-frame render takes roughly 35–40 min on 4 cores. Intermediate frames (`_render/`) are git-ignored.
* The composition imports the live landing source (`../../frontend/src`); a future change to the landing 3D code can change the render.
