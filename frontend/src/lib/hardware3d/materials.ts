import {
  Color,
  DoubleSide,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Material,
} from "three";

/** Teal của landing (#55B9A8): chỉ dùng cho viền nhấn, đèn viền phụ và khung chọn. */
export const TEAL_ACCENT = 0x55b9a8;

/**
 * Vật liệu dùng chung cho cảnh 3D. Màu của vật liệu 3D khai báo ở đây, một nơi duy nhất.
 * Hướng thẩm mỹ: đồ điện tử tiêu dùng cao cấp, trầm và chính xác. Không vật liệu phát sáng, không neon.
 * Dây pin đỏ/đen là quy ước cực dương/âm, không phải màu nhấn của giao diện.
 */
export interface MaterialSet {
  /** Vỏ in/đúc polymer màu gốm (#D0D0C8 tham chiếu): độ nhám vừa, một lớp phủ mỏng cho vệt sáng mềm trên mặt cong. */
  printedPolymer: MeshPhysicalMaterial;
  /** Phủ hàn (solder mask) xanh đậm, hơi bóng. */
  solderMask: MeshStandardMaterial;
  /** Phủ hàn đen (bo tham chiếu Adafruit; màu bo thật chưa xác định). */
  solderMaskBlack: MeshStandardMaterial;
  /** Mép bo lộ lõi FR4 sợi thuỷ tinh. */
  pcbEdge: MeshStandardMaterial;
  /** Nét in lụa trắng (chỉ khung linh kiện và dấu chân 1, không có chữ). */
  silkscreen: MeshStandardMaterial;
  copperGold: MeshStandardMaterial;
  /** Thiếc hàn / chân linh kiện mạ thiếc. */
  tin: MeshStandardMaterial;
  metalShield: MeshStandardMaterial;
  metalBright: MeshStandardMaterial;
  chip: MeshStandardMaterial;
  /** Lõi cuộn cảm ferrite. */
  ferrite: MeshStandardMaterial;
  /** Thân tụ gốm nhiều lớp (MLCC). */
  ceramicCap: MeshStandardMaterial;
  plasticBlack: MeshStandardMaterial;
  plasticWhite: MeshStandardMaterial;
  batteryFoil: MeshStandardMaterial;
  batteryLabel: MeshStandardMaterial;
  tabNickel: MeshStandardMaterial;
  wireRed: MeshStandardMaterial;
  wireBlack: MeshStandardMaterial;
  /** Cáp dẻo polyimide (FPC) của camera. */
  flexCable: MeshStandardMaterial;
  speakerCone: MeshStandardMaterial;
  speakerFrame: MeshStandardMaterial;
  /** Màng loa trắng ngà, mờ (không trắng chói). */
  speakerMembrane: MeshStandardMaterial;
  switchSlider: MeshStandardMaterial;
  ledPale: MeshStandardMaterial;
  trimmer: MeshStandardMaterial;
  opticalGlass: MeshPhysicalMaterial;
  /** Toàn bộ vật liệu của bộ này, để giải phóng. */
  all: Material[];
  dispose(): void;
}

function std(color: string, roughness: number, metalness = 0, envMapIntensity = 1): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness, metalness, envMapIntensity });
}

export function createMaterials(): MaterialSet {
  const set = {
    // Polymer màu gốm ấm. Clearcoat thấp và nhám tạo vệt sáng mềm chạy dọc góc bo, không thành nhựa bóng hay kim loại.
    printedPolymer: new MeshPhysicalMaterial({
      color: new Color("#d0d0c8"),
      roughness: 0.48,
      metalness: 0,
      clearcoat: 0.32,
      clearcoatRoughness: 0.42,
      specularIntensity: 0.55,
      envMapIntensity: 0.9,
    }),
    solderMask: std("#1b4a46", 0.36, 0, 0.9),
    solderMaskBlack: std("#15191c", 0.38, 0, 0.9),
    pcbEdge: std("#b8ad85", 0.7),
    silkscreen: std("#e9e7df", 0.75),
    copperGold: std("#d4a952", 0.28, 1),
    tin: std("#c3c8cc", 0.32, 1, 1.4),
    // Kim loại tham chiếu #9BAAB4: thép mạ, xước mịn, không phản chiếu gương.
    metalShield: std("#9baab4", 0.34, 1, 1.5),
    metalBright: std("#c4ccd2", 0.26, 1, 1.6),
    chip: std("#1a1d21", 0.42, 0),
    ferrite: std("#2c2f33", 0.62, 0),
    ceramicCap: std("#a58b62", 0.55, 0),
    plasticBlack: std("#1d2226", 0.5),
    plasticWhite: std("#e4e2da", 0.48),
    // Vỏ túi pin: màng nhôm nhiều lớp, ánh kim dịu.
    batteryFoil: std("#c8cdd1", 0.38, 0.7),
    // Nhãn pin để trống, màu xám xanh mờ (không in dung lượng hay mã vì pin thật chưa biết).
    batteryLabel: std("#7f8d97", 0.62, 0.15),
    tabNickel: std("#aab0b5", 0.32, 0.95),
    wireRed: std("#8f3a3a", 0.5),
    wireBlack: std("#1a1e22", 0.5),
    flexCable: std("#8a5a1f", 0.45),
    speakerCone: std("#252b30", 0.8),
    speakerFrame: std("#7d868f", 0.45, 0.8),
    speakerMembrane: std("#dcd9cf", 0.5),
    // Cần gạt xám trung tính để phân biệt với thân đen của công tắc (màu thật chưa xác định).
    switchSlider: std("#5d666d", 0.42),
    ledPale: std("#e8f0ee", 0.35),
    trimmer: std("#4f6c84", 0.5, 0.1),
    // Kính quang học: tối, phản chiếu mạnh nhờ clearcoat, không dùng transmission (tránh thêm một lượt render).
    opticalGlass: new MeshPhysicalMaterial({
      color: new Color("#0d2a30"),
      roughness: 0.04,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      ior: 1.5,
      envMapIntensity: 2,
      side: DoubleSide,
    }),
  };
  const all: Material[] = Object.values(set);
  return {
    ...set,
    all,
    dispose() {
      for (const m of all) m.dispose();
    },
  };
}
