import type { DimensionStatus, PartSource, PartStatus, PlacementStatus, SectionMode } from "../../lib/hardware3d";

export const SOURCE_LABEL: Record<PartSource, string> = {
  "enclosure-stl": "STL của dự án",
  "cad-glb": "CAD tham chiếu (GLB)",
  procedural: "Dựng bằng code",
};

export const DIMENSION_LABEL: Record<DimensionStatus, string> = {
  "measured-mesh": "Đo từ mesh STL của dự án",
  "reference-cad": "CAD tham chiếu, không phải linh kiện thật",
  "assumed-format": "Giả định theo định dạng tiêu chuẩn, chưa xác minh",
  estimated: "Ước lượng, chưa xác minh",
};

export const PLACEMENT_LABEL: Record<PlacementStatus, string> = {
  "verified-alignment": "Căn với đặc điểm có thật trong STL (kiểm tra tự động)",
  "feature-missing": "Ước lượng: STL không có đặc điểm cần căn",
  estimated: "Ước lượng: đặt ở vùng trống, không có chi tiết giữ",
  "stl-native": "Đúng toạ độ STL",
};

export const SECTION_OPTIONS: Array<{ value: SectionMode; label: string }> = [
  { value: "none", label: "Không cắt" },
  { value: "front-half", label: "Cắt nửa trước" },
  { value: "right-half", label: "Cắt nửa phải" },
];

export const STATUS_LABEL: Record<PartStatus, string> = {
  loaded: "Đã tải",
  fallback: "Hộp thay thế (tải CAD lỗi)",
};

export const VIEW_PRESETS = [
  { value: "iso", label: "Chéo trước" },
  { value: "iso-back", label: "Chéo sau" },
  { value: "front", label: "Trước" },
  { value: "back", label: "Sau" },
  { value: "left", label: "Trái" },
  { value: "right", label: "Phải" },
  { value: "top", label: "Trên" },
  { value: "bottom", label: "Dưới" },
] as const;

export function formatMm(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2).replace(".", ",")} MB`;
}
