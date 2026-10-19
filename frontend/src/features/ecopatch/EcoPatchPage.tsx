import { useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Cpu, Sticker } from "lucide-react";
import { useAdapter } from "../../data";
import { useBackendDeviceHistory } from "../../data/backendTelemetry";
import type { Measurement, TimeRange } from "../../data/contracts";
import { qk } from "../../data/queryKeys";
import { DemoBadge, EmptyState, Notice, StatusLabel } from "../../design-system/feedback";
import { SoftTabs } from "../../design-system/overlays";
import { buttonClasses, IconWell, SoftSurface } from "../../design-system/primitives";
import { formatDate, formatDateTime, formatRelative, TIMEZONE_LABEL } from "../../lib/time";
import { MeasurementFigure, PageHeader, QueryState, SectionTitle, SourceFreshness } from "../common/components";
import { QUALITY_LABELS, QUALITY_TONE, RANGE_LABELS } from "../common/labels";
import { useRecipient } from "../common/recipient";
import { useDemoBadgeLabel } from "../../app/auth";
import { TrendChart } from "./TrendChart";

const RANGES: TimeRange[] = ["6h", "24h", "7d"];

/**
 * Overlay live SSE-arriving samples on the 24h fixture window while
 * preserving older fixture context. Dedup is by (deviceId|metric|observedAt)
 * so the same live sample never appears twice.
 */
function mergeLiveOverFixtures(
  live: readonly Measurement[],
  fixtures: readonly Measurement[],
  metric: "heart_rate" | "spo2",
): Measurement[] {
  const seen = new Set<string>();
  const out: Measurement[] = [];
  for (const m of live) {
    const key = `${m.deviceId}|${m.metric}|${m.observedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  for (const m of fixtures) {
    if (m.metric !== metric) continue;
    const key = `${m.deviceId}|${m.metric}|${m.observedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  out.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  return out;
}

export function EcoPatchPage() {
  const adapter = useAdapter();
  const { recipient, recipientId, can } = useRecipient();
  const demoBadgeLabel = useDemoBadgeLabel();
  const [range, setRange] = useState<TimeRange>("24h");
  const [spo2Range, setSpo2Range] = useState<TimeRange>("24h");
  const source = recipient.sources.find((s) => s.product === "ecopatch");

  const series = useQuery({
    queryKey: qk.measurements(recipientId, range, "heart_rate"),
    queryFn: () => adapter.listMeasurements(recipientId, { metric: "heart_rate", range }),
    placeholderData: (prev) => prev,
  });
  const spo2Series = useQuery({
    queryKey: qk.measurements(recipientId, spo2Range, "spo2"),
    queryFn: () => adapter.listMeasurements(recipientId, { metric: "spo2", range: spo2Range }),
    placeholderData: (prev) => prev,
  });

  /**
   * Live rolling history from the existing SSE-driven getBackendDevices().
   * Static personas (u_minh / u_lan / u_ha / u_khoa) get empty arrays — they
   * continue to render from fixtures only. Only r_liveshowcase accumulates
   * real telemetry samples as they arrive.
   */
  const { hrItems: liveHr, spo2Items: liveSpo2 } = useBackendDeviceHistory(recipientId);

  // For r_liveshowcase the chart shows live SSE samples overlaid on the
  // 24h fixture window so older context is preserved. For other personas
  // we leave the series untouched.
  const hrChartItems: Measurement[] = liveHr.length > 0 ? mergeLiveOverFixtures(liveHr, series.data?.items ?? [], "heart_rate") : (series.data?.items ?? []);
  const spo2ChartItems: Measurement[] = liveSpo2.length > 0 ? mergeLiveOverFixtures(liveSpo2, spo2Series.data?.items ?? [], "spo2") : (spo2Series.data?.items ?? []);
  const hrLatest: Measurement | null = liveHr.length > 0 ? liveHr[liveHr.length - 1] ?? null : (series.data?.latest ?? null);
  const spo2Latest: Measurement | null = liveSpo2.length > 0 ? liveSpo2[liveSpo2.length - 1] ?? null : (spo2Series.data?.latest ?? null);
  const hrExpectedIntervalMinutes = series.data?.expectedIntervalMinutes ?? 10;
  const spo2ExpectedIntervalMinutes = spo2Series.data?.expectedIntervalMinutes ?? 10;
  const devices = useQuery({ queryKey: qk.devices(recipientId), queryFn: () => adapter.listDevices(recipientId) });
  const patches = useQuery({ queryKey: qk.patches(recipientId), queryFn: () => adapter.listPatchSessions(recipientId) });

  const core = devices.data?.find((d) => d.kind === "ecopatch_core");
  const activePatch = patches.data?.find((p) => !p.endedAt && p.coreDeviceId === core?.id);

  return (
    <>
      <PageHeader
        title="EcoPatch"
        eyebrow={<DemoBadge label={demoBadgeLabel} />}
        description="Chỉ số được thiết bị hỗ trợ, chất lượng tín hiệu, lõi điện tử và miếng dán. Giá trị không phải kết luận y khoa."
      />

      <div className="flex flex-col gap-8">
        <SoftSurface as="section" aria-labelledby="metric-title">
          <SectionTitle id="metric-title">Nhịp tim</SectionTitle>
          <QueryState query={series}>
            {() => {
              const latest = hrLatest;
              // eslint-disable-next-line react-hooks/purity -- intentional stale-check at render time
              const staleData = latest ? Date.now() - new Date(latest.observedAt).getTime() > hrExpectedIntervalMinutes * 3 * 60_000 : false;
              return (
                <div className="flex flex-col gap-6">
                  {latest ? (
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <MeasurementFigure label="Giá trị gần nhất" value={latest.value ?? "--"} unit={latest.unit} observedAt={latest.observedAt} />
                      <div className="flex flex-wrap gap-2">
                        <StatusLabel tone={QUALITY_TONE[latest.quality]}>{QUALITY_LABELS[latest.quality]}</StatusLabel>
                        {staleData ? <StatusLabel tone="attention">Dữ liệu cũ, không phải thời gian thực</StatusLabel> : null}
                      </div>
                    </div>
                  ) : (
                    <Notice title="Chưa có phép đo">Thiết bị chưa gửi phép đo nhịp tim cho hồ sơ này.</Notice>
                  )}

                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <SoftTabs label="Khoảng thời gian biểu đồ" value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))} />
                    <p className="text-sm">
                      Tần suất đo dự kiến {hrExpectedIntervalMinutes} phút · {TIMEZONE_LABEL}
                    </p>
                  </div>

                  {hrChartItems.length === 0 ? (
                    <TrendChart
                      placeholder
                      items={hrChartItems}
                      from={series.data?.from ?? ""}
                      to={series.data?.to ?? ""}
                      unit="bpm"
                      label={`Nhịp tim ${RANGE_LABELS[range]} qua`}
                      expectedIntervalMinutes={hrExpectedIntervalMinutes}
                    />
                  ) : (
                    <TrendChart
                      items={hrChartItems}
                      from={series.data?.from ?? ""}
                      to={series.data?.to ?? ""}
                      unit="bpm"
                      label={`Nhịp tim ${RANGE_LABELS[range]} qua`}
                      expectedIntervalMinutes={hrExpectedIntervalMinutes}
                    />
                  )}
                  <p className="text-sm">
                    Biểu đồ không hiển thị vùng “bình thường” hay ngưỡng y khoa. Dạng sóng ECG chỉ xuất hiện khi thiết bị cung cấp dữ liệu mẫu và tần số lấy mẫu.
                  </p>
                </div>
              );
            }}
          </QueryState>
        </SoftSurface>

        <SoftSurface as="section" aria-labelledby="spo2-title">
          <SectionTitle id="spo2-title">SpO₂</SectionTitle>
          <QueryState query={spo2Series}>
            {() => {
              const latest = spo2Latest;
              // eslint-disable-next-line react-hooks/purity -- intentional stale-check at render time
              const staleData = latest ? Date.now() - new Date(latest.observedAt).getTime() > spo2ExpectedIntervalMinutes * 3 * 60_000 : false;
              return (
                <div className="flex flex-col gap-6">
                  {latest ? (
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <MeasurementFigure label="Giá trị gần nhất" value={latest.value} unit={latest.unit} observedAt={latest.observedAt} />
                      <div className="flex flex-wrap gap-2">
                        <StatusLabel tone={QUALITY_TONE[latest.quality]}>{QUALITY_LABELS[latest.quality]}</StatusLabel>
                        {staleData ? <StatusLabel tone="attention">Dữ liệu cũ, không phải thời gian thực</StatusLabel> : null}
                      </div>
                    </div>
                  ) : (
                    <Notice title="Chưa có phép đo">Thiết bị chưa gửi phép đo SpO₂ cho hồ sơ này.</Notice>
                  )}

                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <SoftTabs label="Khoảng thời gian biểu đồ SpO₂" value={spo2Range} onChange={setSpo2Range} options={RANGES.map((r) => ({ value: r, label: RANGE_LABELS[r] }))} />
                    <p className="text-sm">
                      Tần suất đo dự kiến {spo2ExpectedIntervalMinutes} phút · {TIMEZONE_LABEL}
                    </p>
                  </div>

                  {spo2ChartItems.length === 0 ? (
                    <div className="flex min-h-[260px] items-center justify-center rounded-control p-6 shadow-inset-sm">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <p className="text-base font-medium text-fg-muted">Biểu đồ SpO₂</p>
                        <p className="text-sm text-fg-muted">Dữ liệu SpO₂ sẽ hiển thị khi thiết bị cung cấp phép đo.</p>
                      </div>
                    </div>
                  ) : (
                    <TrendChart
                      items={spo2ChartItems}
                      from={spo2Series.data?.from ?? ""}
                      to={spo2Series.data?.to ?? ""}
                      unit="%"
                      label={`SpO₂ ${RANGE_LABELS[spo2Range]} qua`}
                      expectedIntervalMinutes={spo2ExpectedIntervalMinutes}
                      yDomain={[90, 100]}
                    />
                  )}
                  <p className="text-sm">SpO₂ (oxy saturation) là chỉ số bão hòa oxy trong máu. Giá trị hiển thị khi thiết bị cung cấp dữ liệu.</p>
                </div>
              );
            }}
          </QueryState>
        </SoftSurface>

        <div className="grid gap-8 lg:grid-cols-2">
          <SoftSurface as="section" aria-labelledby="core-title">
            <SectionTitle id="core-title">Lõi điện tử</SectionTitle>
            {source ? <SourceFreshness source={source} compact /> : null}
            <QueryState query={devices}>
              {() =>
                core ? (
                  <dl className="mt-4 grid gap-3 rounded-control p-4 shadow-inset-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-sm">Thiết bị</dt>
                      <dd className="font-medium">
                        {core.label} · {core.serialMasked}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm">Pin</dt>
                      <dd className="font-medium">
                        {core.capabilities.includes("battery") && core.batteryPercent !== null
                          ? `${core.batteryPercent}% (báo lúc ${formatRelative(core.lastSeenAt)})`
                          : "Thiết bị không cung cấp"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm">Chỉ số hỗ trợ</dt>
                      <dd className="font-medium">Nhịp tim, chất lượng tín hiệu</dd>
                    </div>
                    <div>
                      <dt className="text-sm">Dạng sóng ECG</dt>
                      <dd className="font-medium">{core.capabilities.includes("ecg_waveform") ? "Có" : "Thiết bị không cung cấp"}</dd>
                    </div>
                  </dl>
                ) : (
                  <EmptyState icon={<Cpu />} title="Chưa ghép lõi EcoPatch">
                    <Link to={`/people/${recipientId}/devices`} className={buttonClasses({ className: "mt-2" })}>
                      Ghép thiết bị
                    </Link>
                  </EmptyState>
                )
              }
            </QueryState>
          </SoftSurface>

          <SoftSurface as="section" aria-labelledby="patch-title">
            <SectionTitle id="patch-title">Miếng dán</SectionTitle>
            <QueryState query={patches}>
              {(sessions) => (
                <div className="flex flex-col gap-4">
                  {activePatch ? (
                    <div className="flex gap-4 rounded-control p-4 shadow-inset-sm">
                      <IconWell size="sm">
                        <Sticker />
                      </IconWell>
                      <dl className="grid flex-1 gap-2">
                        <div>
                          <dt className="text-sm">Bắt đầu</dt>
                          <dd className="font-medium">{formatDateTime(activePatch.startedAt)}</dd>
                        </div>
                        <div>
                          <dt className="text-sm">Mã lô</dt>
                          <dd className="font-medium">{activePatch.lotCode ?? "Không nhập"}</dd>
                        </div>
                        <div>
                          <dt className="text-sm">Lịch thay</dt>
                          <dd className="inline-flex items-center gap-2 font-medium">
                            <CalendarClock className="size-4 text-accent" aria-hidden />
                            {activePatch.expectedReplaceAt ? `Dự kiến ${formatDate(activePatch.expectedReplaceAt)}` : "Chưa đặt lịch thay"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ) : (
                    <Notice>Chưa ghi nhận miếng dán đang dùng.</Notice>
                  )}
                  <p className="text-sm">Thay miếng dán không đổi người được gán cho lõi. Lịch sử phiên cũ được giữ nguyên.</p>
                  <p className="text-sm">{sessions.length} phiên miếng dán đã ghi nhận.</p>
                  {core && can("patches.replace") ? (
                    <Link to={`/people/${recipientId}/devices?replace=${core.id}`} className={buttonClasses({ variant: "primary", className: "self-start" })}>
                      Thay miếng dán
                    </Link>
                  ) : core ? (
                    <p className="text-sm font-medium">Bạn không có quyền ghi nhận thay miếng dán.</p>
                  ) : null}
                </div>
              )}
            </QueryState>
          </SoftSurface>
        </div>
      </div>
    </>
  );
}
