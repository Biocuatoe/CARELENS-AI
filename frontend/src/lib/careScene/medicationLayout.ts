import { Vector3 } from "three";

/**
 * Bố cục thế giới của cảnh quan sát hoạt động (mét, gốc ở chân người, +Y lên, người nhìn về +Z, camera người xem ở phía +Z).
 * Một nơi duy nhất: cảnh, dòng thời gian, kiểm thử và phần sau đều đọc từ đây.
 */
export const COUNTER_TOP = 0.92;

export const GLASS = { height: 0.12, radiusTop: 0.034, radiusBottom: 0.029 } as const;

export const LAYOUT = {
  counter: { center: new Vector3(0.45, 0, 0.55), width: 4.2, depth: 0.7, frontZ: 0.2 },
  /** Tâm ly nước khi đặt trên quầy (cao nửa thân ly so với mặt quầy). */
  glassRest: new Vector3(-0.215, COUNTER_TOP + GLASS.height / 2, 0.37),
  bottle: new Vector3(-0.52, COUNTER_TOP, 0.47),
  cap: new Vector3(-0.64, COUNTER_TOP, 0.4),
  pills: [new Vector3(-0.585, COUNTER_TOP + 0.004, 0.33), new Vector3(-0.565, COUNTER_TOP + 0.004, 0.315)] as const,
  /** Hub trong nhà đứng trên quầy; khay nhận nằm phẳng ngay phía trước hub (phía người). */
  hub: new Vector3(1.74, COUNTER_TOP, 0.5),
  tray: new Vector3(1.28, COUNTER_TOP, 0.5),
} as const;

/** Khung ngắm: mặt phẳng vuông góc trục nhìn của camera thiết bị, cách ống kính này (m), nửa cạnh theo tỉ lệ 4:3. */
export const OBSERVATION = {
  distance: 0.42,
  halfWidth: 0.26,
  halfHeight: 0.195,
  /** Ống kính nằm trước mặt trước của vỏ (vỏ dày 32 mm: tâm cách mặt trước 16 mm). */
  lensForward: 0.017,
} as const;
