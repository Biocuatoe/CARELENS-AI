import type { Vector3Tuple } from "three";
import { INTERIOR_MM, LIP_CLEARANCE_MM, type BoxMm } from "./units";
import type { PartId } from "./assemblyConfig";

/** Hộp bao một linh kiện trong khung CAD (mm). */
export interface PartBox {
  id: PartId;
  min: Vector3Tuple;
  max: Vector3Tuple;
}

export interface FitEntry {
  id: PartId;
  /** Kích thước hộp bao theo X, Y, Z (mm). */
  size: Vector3Tuple;
  /** Mỗi phần tử mô tả một chỗ vượt ra ngoài khoang trong, ví dụ "Z vượt 8,5 mm". */
  exceedsInterior: string[];
  /** Linh kiện cắt qua dải z của vành cắm nắp nhưng rộng hơn khe 36 × 25 mm. */
  blocksLip: boolean;
  /** Kích thước lớn nhất không nhỏ hơn cạnh dài nhất của khoang trong: không đặt vừa theo bất kỳ hướng nào. */
  fitsInterior: boolean;
}

export interface OverlapEntry {
  a: PartId;
  b: PartId;
  volumeMm3: number;
}

const AXES = ["X", "Y", "Z"] as const;

export function sizeOf(box: Pick<PartBox, "min" | "max">): Vector3Tuple {
  return [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
}

function fmt(n: number): string {
  return n.toFixed(1).replace(".", ",");
}

/**
 * So từng linh kiện với khoang trong đo từ STL. Đây chỉ là kiểm tra hộp bao song song trục:
 * `fitsInterior = true` KHÔNG có nghĩa lắp được thật (không có trụ đỡ, dây, khe hở lắp ráp).
 */
export function checkFit(
  boxes: readonly PartBox[],
  interior: BoxMm = INTERIOR_MM,
  lip: typeof LIP_CLEARANCE_MM = LIP_CLEARANCE_MM,
): FitEntry[] {
  const interiorSize = sizeOf({ min: interior[0], max: interior[1] });
  return boxes.map((b) => {
    const size = sizeOf(b);
    const exceeds: string[] = [];
    AXES.forEach((axis, i) => {
      const lo = interior[0][i]! - b.min[i]!;
      const hi = b.max[i]! - interior[1][i]!;
      if (lo > 0.05) exceeds.push(`${axis} thấp hơn khoang ${fmt(lo)} mm`);
      if (hi > 0.05) exceeds.push(`${axis} vượt khoang ${fmt(hi)} mm`);
    });
    const crossesLip = b.min[2]! < lip.z[1] && b.max[2]! > lip.z[0];
    const blocksLip =
      crossesLip &&
      (b.min[0]! < lip.box[0][0] || b.max[0]! > lip.box[1][0] || b.min[1]! < lip.box[0][1] || b.max[1]! > lip.box[1][1]);
    // Không đặt vừa theo mọi hướng: cạnh dài nhất của linh kiện lớn hơn cạnh dài nhất của khoang,
    // hoặc sắp xếp kích thước tăng dần có một cạnh lớn hơn cạnh tương ứng của khoang.
    const sortedPart = [...size].sort((x, y) => x - y);
    const sortedInterior = [...interiorSize].sort((x, y) => x - y);
    const fitsInterior = sortedPart.every((s, i) => s <= sortedInterior[i]! + 0.05);
    return { id: b.id, size, exceedsInterior: exceeds, blocksLip, fitsInterior };
  });
}

/** Các cặp hộp bao giao nhau. Hộp bao thô nên chỉ là cảnh báo bố trí, không phải xung đột cơ khí chắc chắn. */
export function findOverlaps(boxes: readonly PartBox[], minVolumeMm3 = 1): OverlapEntry[] {
  const out: OverlapEntry[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      let vol = 1;
      for (let k = 0; k < 3; k++) {
        const d = Math.min(a.max[k]!, b.max[k]!) - Math.max(a.min[k]!, b.min[k]!);
        if (d <= 0) {
          vol = 0;
          break;
        }
        vol *= d;
      }
      if (vol >= minVolumeMm3) out.push({ a: a.id, b: b.id, volumeMm3: vol });
    }
  }
  return out;
}
