import type { AxisBox, PartId } from "./assemblyConfig";

/**
 * CẤU HÌNH HOẠT ẢNH CUỘN. Tách khỏi `assemblyConfig.ts`: file đó giữ vị trí lắp (nhà) và trạm tách rời chuẩn; file này chỉ mô tả
 * CÁCH đi từ nhà tới trạm theo tiến trình cuộn p ∈ [0, 1]: giai đoạn, cửa sổ thời gian từng linh kiện, góc máy, nhãn.
 * Hoạt ảnh không bao giờ ghi vào cấu hình lắp; mọi tư thế là hàm thuần của p.
 */

export type StageId = "assembled" | "open" | "explode" | "explore" | "overview";

export interface StageConfig {
  id: StageId;
  /** Khoảng p của giai đoạn. */
  from: number;
  to: number;
  /** Tiêu đề ngắn hiển thị cạnh thanh tiến trình. */
  title: string;
  /** Tiêu đề khi người dùng cuộn ngược (lắp lại). */
  reverseTitle: string;
}

export const STAGES: readonly StageConfig[] = [
  { id: "assembled", from: 0, to: 0.08, title: "Thiết bị đã đóng", reverseTitle: "Thiết bị đã đóng" },
  { id: "open", from: 0.08, to: 0.2, title: "Mở nắp", reverseTitle: "Đóng nắp" },
  { id: "explode", from: 0.2, to: 0.58, title: "Tách từng linh kiện", reverseTitle: "Lắp linh kiện lại" },
  { id: "explore", from: 0.58, to: 0.97, title: "Khám phá từng linh kiện", reverseTitle: "Khám phá từng linh kiện" },
  { id: "overview", from: 0.97, to: 1, title: "Toàn bộ linh kiện", reverseTitle: "Toàn bộ linh kiện" },
];

/** Tiến trình tại mốc "tách xong" và "nắp đã mở": dùng làm ảnh tĩnh cho chế độ giảm chuyển động. */
export const SNAPSHOT_P = { assembled: 0, open: 0.2, exploded: 0.58 } as const;

/** Nắp nhấc thẳng lên (khoảng p). Vị trí cuối là `exploded.position` của `enclosure-cap`. */
export const CAP_WINDOW: readonly [number, number] = [0.08, 0.2];

/** Giai đoạn "tách" trải trên khoảng p này; cửa sổ từng linh kiện tính theo s = (p − from) / (to − from). */
export const EXPLODE_RANGE: readonly [number, number] = [0.2, 0.58];

export type MovingPartId = Exclude<PartId, "enclosure-body" | "enclosure-cap">;

/**
 * Cửa sổ chuyển động trong giai đoạn tách (s ∈ [0, 1]). Thứ tự quyết định bởi việc linh kiện nào đang chắn đường thoát lên trên:
 * bo ở vòm nắp đi trước, rồi tới pin, loa, camera, cuối cùng là mạch sạc nằm thấp nhất. `animationValidation` kiểm tra không va chạm.
 */
export const PART_WINDOWS: Readonly<Record<MovingPartId, readonly [number, number]>> = {
  "max98357a": [0.0, 0.2],
  gy521: [0.04, 0.24],
  "boost-converter": [0.12, 0.34],
  "slide-switch": [0.2, 0.42],
  "lipo-cell": [0.28, 0.54],
  speaker: [0.4, 0.66],
  "esp32-cam": [0.52, 0.8],
  tp4056: [0.68, 1.0],
};

/** Quy tắc dựng đường đi: lên khỏi miệng thân, đi ngang tới trạm, hạ xuống độ cao trạm. */
export const PATH_RULES = {
  /** Mép trên của thân (z). */
  rimZ: 53,
  /** Đáy linh kiện phải cao hơn mép thân ít nhất khoảng này khi đi ngang. */
  clearanceMm: 5,
  /** Bán kính bo góc đường đi. */
  cornerRadiusMm: 9,
} as const;

/** Dịch chuyển điểm nhìn (tỉ lệ khung) để chừa chỗ cho nhãn: màn rộng đặt nhãn bên phải, màn hẹp đặt nhãn phía dưới. */
export const VIEW_SHIFT = {
  wide: { x: 0.17, y: 0 },
  narrow: { x: 0, y: 0.17 },
} as const;
export type Layout = keyof typeof VIEW_SHIFT;

export interface CameraKey {
  /** Khoảng giữ nguyên tư thế sẽ có hai khoá cùng giá trị. */
  p: number;
  azimuth: number;
  elevation: number;
  /** Hộp (khung CAD, mm) mà camera phải bao trọn; `parts` = bao trạm của các linh kiện ở trạng thái tách rời. */
  focus: { box: AxisBox } | { parts: readonly PartId[] };
  margin: number;
  /** Giá trị thay cho `margin` ở bố cục hẹp (màn dọc), nếu có. */
  marginNarrow?: number;
  /**
   * Hệ số nhân của VIEW_SHIFT: 1 = chừa chỗ cho nhãn (vật thể lệch sang trái hoặc lên trên), 0 = giữa khung,
   * âm = chừa chỗ cho chữ mở đầu (vật thể lệch sang phải hoặc xuống dưới).
   */
  shift: number;
  /**
   * Khoá khung mở đầu (hero): 1 = camera tự đặt thiết bị vào vùng trống còn lại bên cạnh chữ giới thiệu (nếu giao diện báo vùng đó),
   * 0 = theo `shift` thường. Nội suy giữa hai khoá.
   */
  hero?: number;
}

export interface BeatConfig {
  id: string;
  parts: readonly PartId[];
  title: string;
  text: string;
  /** Ghi chú trung thực về mức chắc chắn, luôn hiện cùng nhãn. */
  note: string;
  azimuth: number;
  elevation: number;
  /** Hệ số nhân bán kính khung (lớn hơn = thấy rộng hơn). */
  margin: number;
}

/**
 * Nhãn cho từng linh kiện. Nội dung chỉ nói chức năng chung của loại linh kiện và những gì có trong tài liệu dự án; không có số liệu
 * hiệu năng, độ chính xác hay tuyên bố y khoa. `note` ghi rõ phần chưa xác minh.
 */
export const BEATS: readonly BeatConfig[] = [
  {
    id: "camera",
    parts: ["esp32-cam"],
    title: "Camera ESP32-S3",
    text: "Bo camera đeo ngay sau cửa sổ vuông 8 × 8 mm ở mặt trước. Hình ảnh được gửi tới hub; hub chuyển dữ liệu liên quan tới máy chủ đám mây CareLens AI.",
    note: "Kích thước bo và vị trí ống kính là ước lượng.",
    azimuth: -18,
    elevation: 8,
    margin: 2.2,
  },
  {
    id: "battery",
    parts: ["lipo-cell"],
    title: "Pin Li-Po dẹt",
    text: "Cấp nguồn cho toàn bộ thiết bị, đứng sát thành sau của vỏ.",
    note: "Dung lượng và kích thước thật chưa xác minh; mô hình dùng định dạng giả định 10 × 34 × 50 mm.",
    azimuth: -14,
    elevation: 12,
    margin: 2.0,
  },
  {
    id: "charger",
    parts: ["tp4056"],
    title: "Mạch sạc TP4056",
    text: "Nhận nguồn qua cổng USB-C và sạc pin Li-Po. Cổng quay ra thành trái của vỏ.",
    note: "Vỏ hiện chưa có lỗ USB-C; vị trí cổng là đề xuất.",
    azimuth: -40,
    elevation: 14,
    margin: 2.2,
  },
  {
    id: "boost",
    parts: ["boost-converter"],
    title: "Mạch tăng áp 3,7 → 5 V",
    text: "Nâng điện áp pin lên 5 V cho các mô-đun cần nguồn 5 V.",
    note: "Biến thể mô-đun thật chưa xác định; mô hình theo kiểu MT3608.",
    azimuth: -22,
    elevation: 38,
    margin: 2.2,
  },
  {
    id: "motion",
    parts: ["gy521"],
    title: "Cảm biến chuyển động GY-521",
    text: "Mô-đun MPU6050 đo gia tốc và chuyển động quay của thiết bị.",
    note: "Hướng trục cảm biến so với thiết bị chưa xác minh.",
    azimuth: -14,
    elevation: 38,
    margin: 2.4,
  },
  {
    id: "amp",
    parts: ["max98357a"],
    title: "Bộ khuếch đại âm thanh",
    text: "Mạch MAX98357A nhận âm thanh số I2S và điều khiển loa.",
    note: "Mô hình là bo tham chiếu Adafruit; bo thật có thể khác.",
    azimuth: -36,
    elevation: 38,
    margin: 2.4,
  },
  {
    id: "speaker",
    parts: ["speaker"],
    title: "Loa 8 Ω mini",
    text: "Phát âm thanh từ thiết bị.",
    note: "Vỏ hiện chưa có lỗ thoát âm; loa thật chưa được xác định.",
    azimuth: -10,
    elevation: 14,
    margin: 2.2,
  },
  {
    id: "switch",
    parts: ["slide-switch"],
    title: "Công tắc trượt BẬT/TẮT",
    text: "Công tắc dạng chốt: giữ nguyên vị trí sau khi gạt. Cần gạt thò ra thành trái của vỏ.",
    note: "Vỏ hiện chưa có rãnh cho cần gạt; kích thước công tắc là ước lượng.",
    azimuth: -64,
    elevation: 24,
    margin: 3.2,
  },
];

/** Tâm p của từng nhịp khám phá: nhịp đầu ở 0,615, cách nhau 0,048. */
export const BEAT_START_P = 0.615;
export const BEAT_STEP_P = 0.048;
/** Nửa độ rộng của đoạn giữ nguyên góc máy quanh tâm nhịp. */
export const BEAT_HOLD_P = 0.01;
/** Nhãn hiện dần trong [tâm − FADE_OUTER, tâm − FADE_INNER] và tắt dần trong [tâm + FADE_INNER, tâm + FADE_OUTER]. */
export const LABEL_FADE = { inner: 0.008, outer: 0.018 } as const;

export const beatCenterP = (index: number): number => BEAT_START_P + index * BEAT_STEP_P;

/** Hộp bao toàn cảnh cho các góc máy tổng quan (khung CAD, mm), gồm trạm xa nhất và nắp nâng cao. */
export const FOCUS_BOXES = {
  assembled: { x: [0, 43], y: [0, 32], z: [0, 65] },
  open: { x: [-5, 50], y: [-5, 35], z: [0, 156] },
  exploded: { x: [-62, 97], y: [-45, 32], z: [-1, 139] },
} as const satisfies Record<string, AxisBox>;

/** Khung mở đầu: thiết bị lớn, lệch sang phải (màn rộng) hoặc xuống dưới (màn hẹp) để chừa chỗ cho chữ giới thiệu. */
export const HERO_FRAME = { shift: 0, margin: 0.82, marginNarrow: 0.85 } as const;

/** Góc máy cho các giai đoạn lớn; khoá của từng nhịp được `timeline.ts` thêm vào theo BEATS. */
export const STAGE_CAMERA_KEYS: readonly CameraKey[] = [
  { p: 0, azimuth: 34, elevation: 16, focus: { box: FOCUS_BOXES.assembled }, margin: HERO_FRAME.margin, marginNarrow: HERO_FRAME.marginNarrow, shift: HERO_FRAME.shift, hero: 1 },
  { p: 0.08, azimuth: 34, elevation: 16, focus: { box: FOCUS_BOXES.assembled }, margin: HERO_FRAME.margin, marginNarrow: HERO_FRAME.marginNarrow, shift: HERO_FRAME.shift, hero: 1 },
  // Khi nắp mở, camera vòng chậm từ chéo trước-phải sang chéo trước-trái: góc nhìn tổng quan cố định cho cả giai đoạn tách và khám phá.
  { p: 0.2, azimuth: 10, elevation: 28, focus: { box: FOCUS_BOXES.open }, margin: 0.98, shift: 0 },
  { p: 0.58, azimuth: -28, elevation: 23, focus: { box: FOCUS_BOXES.exploded }, margin: 0.7, marginNarrow: 0.88, shift: 0 },
  { p: 1, azimuth: -32, elevation: 25, focus: { box: FOCUS_BOXES.exploded }, margin: 0.72, marginNarrow: 0.9, shift: 0 },
];
