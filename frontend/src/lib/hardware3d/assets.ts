import { BufferAttribute, Group, type BufferGeometry } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Cách tải byte của một tài sản; test thay bằng đọc file để chạy không cần mạng. */
export type ByteLoader = (url: string) => Promise<ArrayBuffer>;

export const fetchBytes: ByteLoader = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
};

/** Góc gập từ đó cạnh được giữ sắc khi làm mượt pháp tuyến STL (STL chỉ có pháp tuyến phẳng theo mặt). */
const CREASE_ANGLE = (30 * Math.PI) / 180;

/**
 * Đọc STL nhị phân của vỏ. Toạ độ giữ nguyên (mm, khung CAD). Pháp tuyến phẳng của STL được thay bằng
 * pháp tuyến làm mượt có giữ cạnh sắc, để các góc bo tròn không bị lộ múi.
 */
export function parseEnclosureStl(bytes: ArrayBuffer): BufferGeometry {
  const raw = new STLLoader().parse(bytes);
  raw.deleteAttribute("normal");
  const smooth = toCreasedNormals(raw, CREASE_ANGLE);
  raw.dispose();
  return smooth;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Che sáng khoang trong (ambient occlusion xấp xỉ) cho vỏ, ghi vào màu đỉnh; hình học và pháp tuyến không đổi.
 * Mặt trong được nhận ra nhờ pháp tuyến hướng về trục đứng của vỏ (thành trong), hướng lên ở đáy khoang (thân) hoặc hướng xuống ở trần
 * (nắp). Càng sâu trong khoang càng tối, giống ánh sáng thật khó lọt vào hộp hẹp; mặt ngoài giữ nguyên, chỉ tối nhẹ sát mặt sàn.
 * Toạ độ theo khung CAD (mm): trục đứng của vỏ ở x = 21,5, y = 16; thân z 0 → 53, nắp z 49 → 65.
 */
export function bakeCavityOcclusion(geometry: BufferGeometry, part: "body" | "cap"): void {
  const pos = geometry.getAttribute("position");
  const nor = geometry.getAttribute("normal");
  const colors = new Float32Array(pos.count * 3);
  const cx = 21.5;
  const cy = 16;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    const dx = cx - x;
    const dy = cy - y;
    const nh = Math.hypot(nx, ny);
    const towardAxis = nh > 0.5 && (nx * dx + ny * dy) / (nh * Math.hypot(dx, dy) + 1e-9) > 0.3;
    let ao = 1;
    if (part === "body") {
      const floor = nz > 0.5 && z < 40;
      if (towardAxis || floor) {
        const t = clamp01((53 - z) / 51) ** 0.8;
        ao = 0.92 - 0.46 * t - (z < 6 ? 0.06 : 0);
      } else {
        ao = 0.86 + 0.14 * clamp01(z / 6);
      }
    } else {
      const ceiling = nz < -0.5 && z > 50.5;
      if (towardAxis || ceiling) ao = 0.9 - 0.4 * clamp01((z - 49) / 14);
    }
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

/** Đọc GLB (đã lượng tử hoá KHR_mesh_quantization, three tự giải mã). Đơn vị mm, không co giãn. */
export function parseGlb(bytes: ArrayBuffer): Promise<Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      bytes,
      "",
      (gltf) => resolve(gltf.scene),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}
