import type { Vector3Tuple } from "three";
import type { CellDimensions } from "./procedural";

/**
 * CẤU HÌNH LẮP RÁP TẬP TRUNG của thiết bị CareLens. Sửa vị trí, hướng, kích thước ở đây; không sửa trong viewer hay hoạt ảnh.
 *
 * Khung toạ độ: khung CAD của STL (mm). Z hướng lên, mặt trước thiết bị là −Y (cửa sổ camera ở y = 0), X sang phải khi nhìn từ trước.
 * Gốc cục bộ của mọi vật thể là tâm hộp bao cứng (không tính dây/đầu nối mềm).
 *
 * - `assembled.box`: hộp bao cứng theo trục thế giới ở trạng thái lắp. Vị trí lắp = tâm hộp. Test kiểm tra kích thước hộp
 *   khớp đúng hình học dựng được, nên không thể đặt một con số không khớp mô hình.
 * - `rotation`: Euler XYZ (độ), xoay mô hình từ khung cục bộ sang khung CAD.
 * - `exploded.position`: tâm vật thể ở trạng thái tách rời ("trạm"). Hoạt ảnh (animationConfig.ts + timeline.ts) tự dựng đường đi
 *   từ vị trí lắp tới trạm; file này là nguồn duy nhất của cả hai đầu. Hướng của vật thể không đổi trong hoạt ảnh.
 *
 * Mức bằng chứng kích thước:
 * - `measured-mesh`: đo từ STL của dự án.
 * - `reference-cad`: đo từ CAD bên thứ ba (MIT), không phải linh kiện thật của dự án.
 * - `assumed-format`: giả định theo một định dạng tiêu chuẩn, không phải linh kiện đã mua.
 * - `estimated`: ước lượng theo mô-đun điển hình, chưa đo.
 *
 * Mức bằng chứng vị trí:
 * - `verified-alignment`: căn với một đặc điểm có thật trong STL và được kiểm tra tự động (validate.ts).
 * - `feature-missing`: đặc điểm cần căn (lỗ USB-C, rãnh công tắc) KHÔNG có trong STL; vị trí là ước lượng hợp lý.
 * - `estimated`: đặt ở vùng trống hợp lý, không có trụ đỡ hay rãnh giữ trong vỏ.
 * - `stl-native`: vật thể là chính STL, nằm đúng toạ độ gốc.
 */
export type DimensionStatus = "measured-mesh" | "reference-cad" | "assumed-format" | "estimated";
export type PlacementStatus = "verified-alignment" | "feature-missing" | "estimated" | "stl-native";
export type PartSource = "enclosure-stl" | "cad-glb" | "procedural";

export const PART_IDS = [
  "enclosure-body",
  "enclosure-cap",
  "esp32-cam",
  "lipo-cell",
  "tp4056",
  "boost-converter",
  "gy521",
  "max98357a",
  "speaker",
  "slide-switch",
] as const;
export type PartId = (typeof PART_IDS)[number];

export interface AxisBox {
  x: readonly [number, number];
  y: readonly [number, number];
  z: readonly [number, number];
}

export interface ComponentConfig {
  id: PartId;
  label: string;
  group: "enclosure" | "electronics";
  source: PartSource;
  /** Đường dẫn trong `public/` (STL/GLB), không có với vật thể dựng bằng code. */
  asset?: string;
  credit?: string;
  dimensions: {
    /** Kích thước cứng theo trục cục bộ của mô hình (mm). */
    size: Vector3Tuple;
    status: DimensionStatus;
    basis: string;
  };
  assembled: { box: AxisBox; rotation: Vector3Tuple };
  exploded: { position: Vector3Tuple; rotation: Vector3Tuple };
  placement: { status: PlacementStatus; notes: string[] };
}

const ASSET_ROOT = "models/carelens";
const UPRIGHT_FRONT: Vector3Tuple = [90, 0, 0]; // mặt +Z cục bộ quay ra trước (−Y), trục +Y cục bộ hướng lên (+Z)

export const center = (b: AxisBox): Vector3Tuple => [(b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2];
export const extent = (b: AxisBox): Vector3Tuple => [b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]];

/**
 * Hai cấu hình pin. Pin thật của dự án chưa được đo.
 * - `reference-adafruit-2011`: đo từ CAD Adafruit 2000 mAh (37 × 60 × 7,5 mm). KHÔNG lắp vừa vỏ theo bất kỳ hướng nào.
 * - `format-103450`: GIẢ ĐỊNH theo quy ước tên pin túi 103450 (dày 10, rộng 34, dài 50 mm). Dùng mặc định để bố trí lắp ráp
 *   có thể lắp vừa; dung lượng thực tế tuỳ nhà sản xuất và chưa được xác minh.
 */
export const BATTERY_PROFILES = {
  "reference-adafruit-2011": { width: 37, length: 60, thickness: 7.5 },
  "format-103450": { width: 34, length: 50, thickness: 10 },
} as const satisfies Record<string, CellDimensions>;
export type BatteryProfile = keyof typeof BATTERY_PROFILES;
export const ACTIVE_BATTERY_PROFILE: BatteryProfile = "format-103450";

export const COMPONENTS: readonly ComponentConfig[] = [
  {
    id: "enclosure-body",
    label: "Thân vỏ",
    group: "enclosure",
    source: "enclosure-stl",
    asset: `${ASSET_ROOT}/enclosure/body.stl`,
    credit: "STL của dự án (bản sao nguyên vẹn của Body_CareLens_43x32x65.stl)",
    dimensions: { size: [43, 32, 53], status: "measured-mesh", basis: "Hộp bao mesh STL" },
    assembled: { box: { x: [0, 43], y: [0, 32], z: [0, 53] }, rotation: [0, 0, 0] },
    exploded: { position: [21.5, 16, 26.5], rotation: [0, 0, 0] },
    placement: {
      status: "stl-native",
      notes: [
        "Đặc điểm đo được: cửa sổ camera 8 × 8 mm; nhãn chìm 25 × 7 mm; rãnh khớp nắp sâu 0,5 mm ở hai thành ±Y (x 18,2–24,8, z 49,6–51).",
        "Không có lỗ USB-C, rãnh công tắc, lỗ loa, trụ đỡ, gân hay rãnh giữ linh kiện.",
      ],
    },
  },
  {
    id: "enclosure-cap",
    label: "Nắp trên",
    group: "enclosure",
    source: "enclosure-stl",
    asset: `${ASSET_ROOT}/enclosure/topcap.stl`,
    credit: "STL của dự án (bản sao nguyên vẹn của topcap_ CareLens_43x32x65.stl)",
    dimensions: { size: [43, 32, 16], status: "measured-mesh", basis: "Hộp bao mesh STL" },
    assembled: { box: { x: [0, 43], y: [0, 32], z: [49, 65] }, rotation: [0, 0, 0] },
    // Nắp nhấc thẳng lên theo trục Z (lẫy ±Y trượt khỏi rãnh), cao hơn mọi trạm linh kiện.
    exploded: { position: [21.5, 16, 130], rotation: [0, 0, 0] },
    placement: {
      status: "stl-native",
      notes: ["Vành cắm dày 1,2 mm và hai lẫy ±Y ăn vào rãnh của thân. Khe hở qua gờ vành: 36 × 25 mm (z 53–54,3). Mặt trong đỉnh nắp ở z = 63."],
    },
  },
  {
    id: "esp32-cam",
    label: "Bo ESP32-S3 CAM và ống kính",
    group: "electronics",
    source: "procedural",
    dimensions: {
      size: [27, 41.1, 8.775],
      status: "estimated",
      basis: "Bo 27 × 40 mm, ăng-ten nhô 1,1 mm; module WROOM-1 18 × 25,5 × 3,1 mm khớp hai nguồn CAD; vị trí camera trên bo là ước lượng",
    },
    assembled: { box: { x: [8, 35], y: [2.2, 10.975], z: [9.5, 50.6] }, rotation: UPRIGHT_FRONT },
    // Trạm nằm phía trước cửa sổ camera, trên trục quang (cùng x, z với lúc lắp), đủ xa để nhìn thấy cả cửa sổ lẫn ống kính.
    exploded: { position: [21.5, -40, 30.05], rotation: UPRIGHT_FRONT },
    placement: {
      status: "verified-alignment",
      notes: [
        "Tâm ống kính trùng tâm cửa sổ camera (x 21,5, z 20,5), trục quang hướng −Y ra ngoài; validate.ts kiểm tra tự động.",
        "Đầu ống kính cách mặt trong thành trước 0,2 mm. Không có gờ hay khung giữ bo trong vỏ.",
        "Trạm tách rời nằm trên trục quang, đúng chiều cao cửa sổ.",
      ],
    },
  },
  {
    id: "lipo-cell",
    label: "Pin Li-Po dẹt và dây",
    group: "electronics",
    source: "procedural",
    dimensions: {
      size: [34, 50, 10],
      status: "assumed-format",
      basis: "Giả định định dạng túi 103450 (10 × 34 × 50 mm). Pin tham chiếu Adafruit 2000 mAh 37 × 60 × 7,5 mm không lắp vừa",
    },
    assembled: { box: { x: [4.5, 38.5], y: [18, 28], z: [4.4, 54.4] }, rotation: UPRIGHT_FRONT },
    // Rút thẳng lên khỏi khoang (cùng x, y với lúc lắp), lơ lửng ngay trên miệng thân, giữa thân và nắp.
    exploded: { position: [21.5, 23, 83], rotation: UPRIGHT_FRONT },
    placement: {
      status: "estimated",
      notes: [
        "Đứng sát thành sau, nhãn quay ra trước. Vị trí lùi tối đa bị giới hạn bởi góc bo R6 bên trong.",
        "Lá tab và dây đi lên vòm nắp, đầu nối JST nằm sau mạch boost. Dây không được mô phỏng tới mạch sạc.",
      ],
    },
  },
  {
    id: "tp4056",
    label: "Mạch sạc TP4056 USB-C",
    group: "electronics",
    source: "procedural",
    dimensions: { size: [17, 29.1, 4.4], status: "estimated", basis: "Mô-đun TP4056 USB-C điển hình 17 × 28 mm, cổng nhô 1,1 mm qua mép" },
    // Cổng USB-C hướng ra thành trái (−X), bo đứng cạnh đáy.
    assembled: { box: { x: [2.25, 31.35], y: [11.3, 15.7], z: [6.2, 23.2] }, rotation: [90, 0, -90] },
    // Trạm nằm ngoài thành trái đúng trên trục cổng (cùng y, z với lúc lắp), đầu cổng hướng ra ngoài (−X).
    exploded: { position: [-47, 13.5, 14.7], rotation: [90, 0, -90] },
    placement: {
      status: "feature-missing",
      notes: [
        "STL không có lỗ USB-C. Cổng được hướng ra thành trái (−X), miệng cổng cách mặt trong thành 0,25 mm, tâm miệng tại y = 13,5, z = 14,7 (đặt trên đoạn bo tròn cạnh đáy của khoang, z ≥ 6,2).",
        "Lỗ đề xuất 9 × 3,5 mm trên thành trái tại y 12,0–15,0, z 12,9–16,5 (chưa có trong STL); validate.ts sẽ báo `openingFound` khi lỗ được thêm vào.",
      ],
    },
  },
  {
    id: "speaker",
    label: "Loa 8 Ω mini",
    group: "electronics",
    source: "cad-glb",
    asset: `${ASSET_ROOT}/components/speaker-adafruit-3923.glb`,
    credit: "Adafruit_CAD_Parts 3923 Mini Oval Speaker (MIT, © Adafruit Industries). STEP → GLB.",
    dimensions: { size: [19.9, 32.5, 6.5], status: "reference-cad", basis: "Đo từ GLB Adafruit 3923; loa thật chưa xác định" },
    assembled: { box: { x: [8, 40.5], y: [11.3, 17.8], z: [23.7, 43.6] }, rotation: [90, 0, 90] },
    // Sang phải (+X) cùng độ cao lúc lắp, ra khỏi vùng của bo camera khi nhìn chéo trước-trái.
    exploded: { position: [80, 14.55, 33.65], rotation: [90, 0, 90] },
    placement: {
      status: "estimated",
      notes: ["Nằm ngang trong lớp giữa, trên mạch sạc, màng loa quay ra trước. Vỏ không có lỗ thoát âm nên đường âm thanh chưa có lời giải."],
    },
  },
  {
    id: "gy521",
    label: "Cảm biến GY-521 MPU6050",
    group: "electronics",
    source: "procedural",
    dimensions: { size: [16, 21, 2.8], status: "estimated", basis: "Bo 16 × 21 mm (trang CAD bên thứ ba ghi 21 × 16 × 3,8 mm, chưa đo bo thật)" },
    assembled: { box: { x: [22.4, 38.4], y: [5.5, 26.5], z: [59.1, 61.9] }, rotation: [0, 0, 0] },
    // Các bo trong vòm nắp toả sang hai bên trên một tầng giữa thân và nắp: GY-521 (lúc lắp ở nửa phải) sang phải.
    exploded: { position: [60, 16, 99], rotation: [0, 0, 0] },
    placement: {
      status: "estimated",
      notes: [
        "Nằm phẳng trong vòm nắp, cạnh bo khuếch đại, trên mạch boost; lớp giữa không còn chỗ. Cách thành vòm 0,2 mm ở mép phải; góc bo R4,5 của gờ nắp buộc bo nằm cách mép 5,5 mm.",
        "Hướng các trục MPU6050 so với thiết bị chưa được xác minh.",
      ],
    },
  },
  {
    id: "slide-switch",
    label: "Công tắc trượt ON/OFF (chốt)",
    group: "electronics",
    source: "procedural",
    dimensions: { size: [8.6, 3.6, 10.45], status: "estimated", basis: "Công tắc trượt mini kiểu SS-12D00, kích thước ước lượng" },
    // Cần gạt hướng ra thành trái (−X), trượt theo trục đứng.
    assembled: { box: { x: [2.25, 12.7], y: [11.3, 14.9], z: [44.1, 52.7] }, rotation: [0, -90, 0] },
    // Trạm nằm ngoài thành trái đúng trên trục rãnh (cùng y, z với lúc lắp), cần gạt hướng ra ngoài.
    exploded: { position: [-24, 13.1, 48.4], rotation: [0, -90, 0] },
    placement: {
      status: "feature-missing",
      notes: [
        "STL không có rãnh công tắc. Cần gạt hướng ra thành trái (−X), mặt cần gạt cách mặt trong thành 0,25 mm.",
        "Rãnh đề xuất xuyên thành trái 2 mm × 8 mm tại y 12,4–13,8, z 44,9–51,9 (cần gạt 2 × 1,4 mm, hành trình 3 mm theo Z: TẮT ở dưới, BẬT ở trên). Chưa có trong STL.",
      ],
    },
  },
  {
    id: "boost-converter",
    label: "Mạch boost 3,7 → 5 V",
    group: "electronics",
    source: "procedural",
    dimensions: { size: [17, 35, 4.4], status: "estimated", basis: "Mô-đun boost kiểu MT3608 khoảng 17 × 35 mm (kích thước thương mại dao động 35–37 mm); biến thể thật chưa xác định" },
    assembled: { box: { x: [4, 39], y: [8.5, 25.5], z: [54.5, 58.9] }, rotation: [0, 0, 90] },
    // Sang phải, dưới GY-521, để cột giữa dành cho pin.
    exploded: { position: [64, 17, 82], rotation: [0, 0, 90] },
    placement: {
      status: "estimated",
      notes: ["Nằm phẳng trong vòm nắp, ngay trên đỉnh pin, linh kiện hướng lên, lọt khe hở 36 × 25 mm của vành nắp với 0,5 mm mỗi bên. Lớp giữa không đủ chỗ cho bo 36 mm."],
    },
  },
  {
    id: "max98357a",
    label: "Bo khuếch đại MAX98357A",
    group: "electronics",
    source: "cad-glb",
    asset: `${ASSET_ROOT}/components/max98357a-adafruit-3006.glb`,
    credit: "Adafruit_CAD_Parts 3006 (MIT, © Adafruit Industries). STEP → GLB.",
    dimensions: { size: [17.78, 19.05, 2.57], status: "reference-cad", basis: "Đo từ GLB Adafruit 3006; bo clone có thể khác" },
    assembled: { box: { x: [4.4, 22.18], y: [6, 25.05], z: [59.1, 61.67] }, rotation: [0, 0, 0] },
    // Lúc lắp ở nửa trái của vòm nắp: sang trái.
    exploded: { position: [-17, 15.525, 86], rotation: [0, 0, 0] },
    placement: { status: "estimated", notes: ["Nằm phẳng trên mạch boost, cạnh cảm biến GY-521, sát đỉnh vòm nắp (trần ở z = 63, vòm hẹp dần từ z = 57)."] },
  },
];

export const COMPONENT_BY_ID: Readonly<Record<PartId, ComponentConfig>> = Object.fromEntries(
  COMPONENTS.map((c) => [c.id, c]),
) as Record<PartId, ComponentConfig>;

/** URL tuyệt đối theo `BASE_URL` của Vite cho một đường dẫn trong `public/`. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}
