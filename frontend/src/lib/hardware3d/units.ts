import type { Vector3Tuple } from "three";

/**
 * Quy ước toạ độ của mô hình phần cứng CareLens.
 *
 * - 1 đơn vị scene = 1 mm (cùng đơn vị với hai file STL vỏ).
 * - Khung CAD: Z hướng lên, mặt trước thiết bị là −Y (cửa sổ camera nằm ở mặt y = 0), X sang phải khi nhìn từ phía trước.
 *   Mọi vị trí trong `assemblyConfig.ts` dùng khung này, đúng như toạ độ của STL.
 * - Khi đưa vào three.js (Y hướng lên, nhìn từ +Z), nhóm gốc `assembly.root` xoay −90° quanh X:
 *   CAD (x, y, z) → scene (x, z, −y). Mặt trước của thiết bị quay về phía camera.
 */
export const CAD_TO_SCENE_ROTATION_X = -Math.PI / 2;

/** Hộp bao theo khung CAD: [min, max]. */
export type BoxMm = readonly [Vector3Tuple, Vector3Tuple];

/**
 * Khoang trong của vỏ, **đo từ mesh STL bằng ray cast** (test `enclosure.test.ts` kiểm lại mỗi lần chạy):
 * thành trong x = 2 và 41, y = 2 và 30; đáy phẳng ở z = 2; mặt trong nắp ở z = 63.
 * Mặt cắt đầy đủ 39 × 28 mm kéo dài tới z ≈ 57 (đo bằng lát cắt), phía trên là vòm nắp thu hẹp.
 */
export const INTERIOR_MM: BoxMm = [
  [2, 2, 2],
  [41, 30, 57],
];

/**
 * Vành cắm của nắp (z 53 → 54,3) thu khe hở còn 36 × 25 mm (đo bằng lát cắt STL nắp).
 * Linh kiện nằm trong dải z này phải nằm gọn trong hộp dưới đây.
 */
export const LIP_CLEARANCE_MM: { z: readonly [number, number]; box: BoxMm } = {
  z: [53, 54.3],
  box: [
    [3.5, 3.5, 53],
    [39.5, 28.5, 54.3],
  ],
};

/** Cửa sổ camera vuông 8 × 8 mm xuyên thành trước (đo từ STL thân). Tâm ở x = 21,5, z = 20,5. */
export const CAMERA_WINDOW_MM = { centerX: 21.5, centerZ: 20.5, size: 8 } as const;

/** Kích thước ngoài đo từ mesh: thân 43 × 32 × 53 (z 0 → 53), nắp 43 × 32 × 16 (z 49 → 65). */
export const ENCLOSURE_BOUNDS_MM = {
  body: [
    [0, 0, 0],
    [43, 32, 53],
  ],
  cap: [
    [0, 0, 49],
    [43, 32, 65],
  ],
} as const satisfies Record<string, BoxMm>;
