import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Boxes, TriangleAlert } from "lucide-react";
import { Badge, Choice, SoftSurface } from "../../design-system/primitives";
import { InlineError, LoadingState, Notice } from "../../design-system/feedback";
import { Disclosure, SoftTabs } from "../../design-system/overlays";
import {
  COMPONENTS,
  HardwareViewer,
  buildHardwareAssembly,
  center,
  isWebGLAvailable,
  sizeOf,
  validateAssembly,
  type FeatureCheck,
  type HardwareAssembly,
  type PartId,
  type SectionMode,
  type SwitchPosition,
  type ValidationReport,
  type ViewPreset,
} from "../../lib/hardware3d";
import {
  DIMENSION_LABEL,
  PLACEMENT_LABEL,
  SECTION_OPTIONS,
  SOURCE_LABEL,
  STATUS_LABEL,
  VIEW_PRESETS,
  formatBytes,
  formatMm,
} from "./labels";

type LoadState = { kind: "loading" } | { kind: "ready"; assembly: HardwareAssembly } | { kind: "error"; message: string } | { kind: "no-webgl" };

declare global {
  interface Window {
    /** Chỉ có khi mở trang với `?debug=1`, phục vụ kiểm thử trình duyệt. */
    __hardwareInspector?: {
      sample: () => ReturnType<HardwareViewer["sample"]>;
      parts: PartId[];
      validation: () => ValidationReport | null;
      viewer: HardwareViewer;
    };
  }
}

const fmtVec = (v: readonly number[]) => v.map(formatMm).join(", ");

/**
 * Công cụ nội bộ kiểm tra cụm phần cứng 3D: ẩn/hiện, chọn từng vật thể, xem số đo, mặt cắt vỏ, tách rời và kết quả
 * kiểm tra va chạm theo hình học thật. Không phải màn hình sản phẩm, không có liên kết điều hướng.
 */
export function HardwareInspectorPage() {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HardwareViewer | null>(null);
  const validationRef = useRef<ValidationReport | null>(null);
  const [state, setState] = useState<LoadState>(() => (isWebGLAvailable() ? { kind: "loading" } : { kind: "no-webgl" }));
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<PartId>("esp32-cam");
  const [visible, setVisible] = useState<Record<PartId, boolean>>(() => Object.fromEntries(COMPONENTS.map((p) => [p.id, true])) as Record<PartId, boolean>);
  const [explode, setExplode] = useState(0);
  const [ghost, setGhost] = useState(false);
  const [section, setSection] = useState<SectionMode>("none");
  const [preset, setPreset] = useState<ViewPreset>("iso");
  const [switchPos, setSwitchPos] = useState<SwitchPosition>("off");
  const [validation, setValidation] = useState<ValidationReport | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isWebGLAvailable()) return;
    let cancelled = false;
    let assembly: HardwareAssembly | null = null;
    let timer = 0;
    const viewer = new HardwareViewer(host);
    viewerRef.current = viewer;
    buildHardwareAssembly()
      .then((a) => {
        if (cancelled) {
          a.dispose();
          return;
        }
        assembly = a;
        viewer.setAssembly(a);
        viewer.frame("iso");
        setState({ kind: "ready", assembly: a });
        // Kiểm tra va chạm sau khung hình đầu tiên để trang hiện ngay.
        timer = window.setTimeout(() => {
          if (cancelled) return;
          const report = validateAssembly(a);
          validationRef.current = report;
          setValidation(report);
        }, 50);
        if (new URLSearchParams(window.location.search).has("debug")) {
          window.__hardwareInspector = { sample: () => viewer.sample(), parts: COMPONENTS.map((p) => p.id), validation: () => validationRef.current, viewer };
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      delete window.__hardwareInspector;
      viewer.setAssembly(null);
      assembly?.dispose();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [attempt]);

  const assembly = state.kind === "ready" ? state.assembly : null;

  useEffect(() => {
    assembly?.setExplode(explode);
    viewerRef.current?.requestRender();
  }, [assembly, explode]);
  useEffect(() => {
    assembly?.setEnclosureGhost(ghost);
    viewerRef.current?.requestRender();
  }, [assembly, ghost]);
  useEffect(() => {
    assembly?.setSection(section);
    viewerRef.current?.requestRender();
  }, [assembly, section]);
  useEffect(() => {
    assembly?.setSwitchPosition(switchPos);
    viewerRef.current?.requestRender();
  }, [assembly, switchPos]);
  useEffect(() => {
    assembly?.setHighlight(selected);
    viewerRef.current?.requestRender();
  }, [assembly, selected]);
  useEffect(() => {
    if (!assembly) return;
    for (const p of COMPONENTS) assembly.setPartVisible(p.id, visible[p.id]);
    viewerRef.current?.requestRender();
  }, [assembly, visible]);

  const handle = assembly?.parts.get(selected);
  const config = COMPONENTS.find((c) => c.id === selected)!;
  const totals = useMemo(() => {
    if (!assembly) return null;
    let bytes = 0;
    let files = 0;
    for (const h of assembly.parts.values()) {
      if (h.assetBytes !== undefined) {
        bytes += h.assetBytes;
        files++;
      }
    }
    return { bytes, files };
  }, [assembly]);

  const changePreset = (p: ViewPreset) => {
    setPreset(p);
    viewerRef.current?.frame(p);
  };

  return (
    <div className="min-h-dvh bg-surface text-fg">
      <main id="noi-dung" className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-8 md:px-6 md:py-12">
        <header className="flex flex-col gap-4">
          <Badge icon={<Boxes aria-hidden />} className="self-start">
            Công cụ nội bộ
          </Badge>
          <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl">Kiểm tra mô hình 3D phần cứng CareLens</h1>
          <Notice icon={<TriangleAlert aria-hidden />} title="Bố trí ước lượng, chưa xác minh với phần cứng thật">
            Chỉ hai file STL của vỏ là dữ liệu của dự án. Linh kiện bên trong là CAD tham chiếu hoặc dựng bằng code theo kích thước điển hình. Pin dùng
            định dạng giả định 103450 vì pin tham chiếu 2000 mAh không lắp vừa. Vỏ chưa có lỗ USB-C và rãnh công tắc.
          </Notice>
        </header>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section aria-labelledby="stage-title" className="flex min-w-0 flex-col gap-6">
            <h2 id="stage-title" className="sr-only">
              Khung nhìn 3D
            </h2>
            <SoftSurface depth="inset" padding="none" className="relative h-[24rem] w-full overflow-hidden sm:h-auto sm:aspect-[4/3]" data-testid="viewer-stage">
              <div ref={hostRef} className="absolute inset-0" data-state={state.kind} />
              {state.kind === "loading" ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <LoadingState label="Đang tải vỏ và linh kiện…" />
                </div>
              ) : null}
              {state.kind === "no-webgl" ? (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <InlineError title="Trình duyệt này không dùng được WebGL">Không thể dựng khung nhìn 3D.</InlineError>
                </div>
              ) : null}
              {state.kind === "error" ? (
                <div className="absolute inset-0 flex items-center justify-center p-6">
                  <InlineError
                    title="Không tải được mô hình"
                    onRetry={() => {
                      setState({ kind: "loading" });
                      setAttempt((n) => n + 1);
                    }}
                  >
                    {state.message}
                  </InlineError>
                </div>
              ) : null}
            </SoftSurface>

            <SoftSurface padding="sm" className="flex flex-col gap-5">
              <SoftTabs label="Hướng nhìn" options={VIEW_PRESETS.map((p) => ({ value: p.value, label: p.label }))} value={preset} onChange={changePreset} idBase="view" />
              <SoftTabs label="Mặt cắt vỏ" options={SECTION_OPTIONS} value={section} onChange={setSection} idBase="section" />
              <div className="flex flex-col gap-2">
                <label htmlFor="explode" className="font-bold">
                  Tách rời: {Math.round(explode * 100)}%
                </label>
                <input
                  id="explode"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={explode}
                  disabled={!assembly}
                  onChange={(e) => setExplode(Number(e.target.value))}
                  className="h-11 w-full accent-accent"
                />
                <p className="text-sm">Vị trí lắp và vị trí tách rời lấy từ assemblyConfig.ts. Bấm một hướng nhìn để căn lại khung hình.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice label="Vỏ trong suốt" description="Nhìn xuyên vỏ" checked={ghost} disabled={!assembly} onChange={(e) => setGhost(e.target.checked)} />
                <fieldset className="flex flex-col gap-2" disabled={!assembly}>
                  <legend className="mb-1 font-bold">Cần gạt công tắc</legend>
                  <div className="flex gap-3">
                    <Choice type="radio" name="switch-pos" label="TẮT" checked={switchPos === "off"} onChange={() => setSwitchPos("off")} />
                    <Choice type="radio" name="switch-pos" label="BẬT" checked={switchPos === "on"} onChange={() => setSwitchPos("on")} />
                  </div>
                </fieldset>
              </div>
            </SoftSurface>

            <SoftSurface padding="sm" as="section" aria-labelledby="validation-title" data-testid="validation">
              <h2 id="validation-title" className="mb-3 font-display text-xl font-bold">
                Kiểm tra lắp ráp theo hình học
              </h2>
              {validation ? (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Row term="Linh kiện chạm hoặc xuyên vỏ" value={`${validation.shellIssues.length} điểm (đã kiểm ${validation.checkedPoints} điểm)`} testId="shell-issues" />
                  <Row term="Va chạm giữa linh kiện" value={`${validation.collisions.length} cặp mesh`} testId="collisions" />
                  <Row
                    term="Camera"
                    value={`Lệch tâm cửa sổ ${formatMm(validation.camera.offsetFromWindowMm)} mm, lệch trục ${formatMm(validation.camera.axisErrorDeg)}°, ${
                      validation.camera.openingFound ? "nhìn ra ngoài qua cửa sổ" : "bị thành vỏ che"
                    }`}
                    testId="camera-check"
                  />
                  <Row term="Cổng USB-C" value={featureText(validation.usbC)} testId="usb-check" />
                  <Row term="Cần gạt công tắc" value={featureText(validation.switchActuator)} testId="switch-check" />
                  <Row term="Dây mềm chạm vỏ (cảnh báo)" value={`${validation.flexibleShellIssues.length} điểm`} />
                </dl>
              ) : (
                <LoadingState label="Đang kiểm tra va chạm với mesh STL…" className="py-2" />
              )}
              {validation && validation.collisions.length > 0 ? (
                <Disclosure summary="Danh sách va chạm" headingLevel={3} className="mt-4">
                  <ul className="flex flex-col gap-1 text-sm">
                    {validation.collisions.map((c) => (
                      <li key={`${c.a}/${c.meshA}-${c.b}/${c.meshB}`}>
                        {c.a}/{c.meshA} ∩ {c.b}/{c.meshB}: {c.volumeMm3.toFixed(2)} mm³
                      </li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </SoftSurface>
          </section>

          <aside aria-label="Vật thể và số đo" className="flex min-w-0 flex-col gap-6">
            <SoftSurface padding="sm" as="section" aria-labelledby="parts-title">
              <h2 id="parts-title" className="mb-3 font-display text-xl font-bold">
                Vật thể trong cảnh ({COMPONENTS.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {COMPONENTS.map((p) => {
                  const h = assembly?.parts.get(p.id);
                  return (
                    <li key={p.id} className="flex items-center gap-2" data-part-id={p.id} data-status={h?.status ?? "pending"}>
                      <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-inner shadow-extruded-sm has-[:checked]:shadow-inset-sm">
                        <input
                          type="checkbox"
                          aria-label={`Hiện ${p.label}`}
                          checked={visible[p.id]}
                          onChange={(e) => setVisible((v) => ({ ...v, [p.id]: e.target.checked }))}
                          className="size-5 accent-accent"
                        />
                      </label>
                      <button
                        type="button"
                        aria-pressed={selected === p.id}
                        onClick={() => setSelected(p.id)}
                        className="flex min-h-11 flex-1 flex-col items-start rounded-control bg-surface px-3 py-2 text-left shadow-extruded-sm transition-shadow duration-300 ease-out aria-pressed:shadow-inset-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <span className="font-medium">{p.label}</span>
                        <span className="text-sm">
                          {SOURCE_LABEL[p.source]}
                          {h ? ` · ${STATUS_LABEL[h.status]}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </SoftSurface>

            <SoftSurface padding="sm" as="section" aria-labelledby="detail-title" data-testid="part-detail">
              <h2 id="detail-title" className="mb-3 flex items-center gap-2 font-display text-xl font-bold">
                <Box className="size-5 text-accent" aria-hidden />
                {config.label}
              </h2>
              {handle ? (
                <dl className="flex flex-col gap-3">
                  <Row term="Mã vật thể" value={config.id} />
                  <Row term="Nguồn" value={SOURCE_LABEL[config.source]} />
                  {config.credit ? <Row term="Ghi công và giấy phép" value={config.credit} /> : null}
                  <Row term="Kích thước cục bộ (mm)" value={config.dimensions.size.map(formatMm).join(" × ")} />
                  <Row term="Mức bằng chứng kích thước" value={`${DIMENSION_LABEL[config.dimensions.status]}. ${config.dimensions.basis}`} />
                  <Row term="Hộp bao đo từ hình học (X × Y × Z, mm)" value={sizeOf(handle.assembledBox).map(formatMm).join(" × ")} />
                  <Row term="Sai lệch cấu hình so với hình học" value={`${formatMm(handle.configMismatchMm)} mm`} />
                  <Row term="Tâm khi lắp (x, y, z mm) · xoay (độ)" value={`${fmtVec(center(config.assembled.box))} · ${config.assembled.rotation.join(", ")}`} />
                  <Row term="Tâm khi tách rời (x, y, z mm)" value={fmtVec(config.exploded.position)} />
                  <Row term="Vị trí" value={PLACEMENT_LABEL[config.placement.status]} />
                  {config.placement.notes.map((n) => (
                    <Row key={n} term="Ghi chú" value={n} />
                  ))}
                  <Row term="Dung lượng file tải về" value={handle.assetBytes !== undefined ? formatBytes(handle.assetBytes) : "Không có file (dựng bằng code)"} />
                  {handle.error ? <Row term="Lỗi tải" value={handle.error} /> : null}
                </dl>
              ) : (
                <p>Chưa tải xong.</p>
              )}
            </SoftSurface>

            {totals ? (
              <SoftSurface padding="sm" as="section" aria-labelledby="summary-title" data-testid="summary">
                <h2 id="summary-title" className="mb-3 font-display text-xl font-bold">
                  Tổng hợp
                </h2>
                <dl className="flex flex-col gap-3">
                  <Row term="File tài sản đã tải" value={`${totals.files} file, ${formatBytes(totals.bytes)}`} />
                </dl>
              </SoftSurface>
            ) : null}
          </aside>
        </div>
      </main>
    </div>
  );
}

function featureText(f: FeatureCheck): string {
  if (f.openingFound) return "Nhìn thẳng ra một lỗ trên vỏ";
  return `Vỏ chưa có lỗ ở hướng (${f.direction.map((v) => Math.round(v)).join(", ")}); cách mặt trong ${f.gapToWallMm === null ? "?" : formatMm(f.gapToWallMm)} mm`;
}

function Row({ term, value, testId }: { term: string; value: string; testId?: string }) {
  return (
    <div data-testid={testId}>
      <dt className="text-sm font-bold">{term}</dt>
      <dd>{value}</dd>
    </div>
  );
}
