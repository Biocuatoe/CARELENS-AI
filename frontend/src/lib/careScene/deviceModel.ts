import { Group, Mesh, type BufferGeometry } from "three";
import { fetchBytes, parseEnclosureStl } from "../hardware3d/assets";
import { assetUrl } from "../hardware3d/assemblyConfig";
import { createMaterials } from "../hardware3d/materials";

export interface DeviceModel {
  /** Thiết bị theo mét, tâm vỏ ở gốc, mặt trước (cửa sổ camera) hướng +Z cục bộ. Gắn thẳng vào điểm gắn trên ngực. */
  group: Group;
  dispose(): void;
}

/**
 * Thiết bị CareLens dựng từ đúng hai file STL vỏ của dự án (43 × 32 × 65 mm), cùng vật liệu polymer màu gốm với cảnh phần cứng.
 * Không có linh kiện bên trong (cảnh này chỉ cần vỏ ngoài). Hai file thường đã có trong bộ nhớ đệm từ cảnh phần cứng.
 */
export async function loadDeviceModel(): Promise<DeviceModel> {
  const [bodyBytes, capBytes] = await Promise.all([fetchBytes(assetUrl("models/carelens/enclosure/body.stl")), fetchBytes(assetUrl("models/carelens/enclosure/topcap.stl"))]);
  const set = createMaterials();
  const geometries: BufferGeometry[] = [];
  // Khung CAD (mm, Z lên, mặt trước −Y) → khung cảnh (m, Y lên, mặt trước +Z). Tâm vỏ (21,5; 16; 32,5) đặt đúng điểm gắn.
  const group = new Group();
  group.name = "carelens-device";
  group.scale.setScalar(0.001);
  group.rotation.x = -Math.PI / 2;
  const inner = new Group();
  inner.position.set(-21.5, -16, -32.5);
  group.add(inner);
  for (const bytes of [bodyBytes, capBytes]) {
    const geo = parseEnclosureStl(bytes);
    geometries.push(geo);
    const m = new Mesh(geo, set.printedPolymer);
    m.castShadow = true;
    inner.add(m);
  }
  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
      set.dispose();
      group.removeFromParent();
    },
  };
}
