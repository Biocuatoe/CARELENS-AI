// @vitest-environment node
/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Box3, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { parseEnclosureStl } from "./assets";
import { readPublic } from "./testing";
import { CAMERA_WINDOW_MM, ENCLOSURE_BOUNDS_MM, INTERIOR_MM, LIP_CLEARANCE_MM } from "./units";

const mat = new MeshBasicMaterial({ side: DoubleSide });
const body = new Mesh(parseEnclosureStl(readPublic("models/carelens/enclosure/body.stl")), mat);
const cap = new Mesh(parseEnclosureStl(readPublic("models/carelens/enclosure/topcap.stl")), mat);

function cast(mesh: Mesh, origin: [number, number, number], dir: [number, number, number]): number | null {
  const rc = new Raycaster(new Vector3(...origin), new Vector3(...dir).normalize());
  return rc.intersectObject(mesh, false)[0]?.distance ?? null;
}

describe("STL vỏ: đo từ mesh thật", () => {
  it("hộp bao khớp hằng số trong units.ts", () => {
    for (const [mesh, bounds] of [
      [body, ENCLOSURE_BOUNDS_MM.body],
      [cap, ENCLOSURE_BOUNDS_MM.cap],
    ] as const) {
      const box = new Box3().setFromObject(mesh);
      box.min.toArray().forEach((v, i) => expect(v).toBeCloseTo(bounds[0][i]!, 2));
      box.max.toArray().forEach((v, i) => expect(v).toBeCloseTo(bounds[1][i]!, 2));
    }
  });

  it("khoang trong khớp INTERIOR_MM (ray cast từ tâm tới thành trong)", () => {
    const [min, max] = INTERIOR_MM;
    const o: [number, number, number] = [21.5, 16, 30];
    expect(o[0] + cast(body, o, [1, 0, 0])!).toBeCloseTo(max[0], 1);
    expect(o[0] - cast(body, o, [-1, 0, 0])!).toBeCloseTo(min[0], 1);
    expect(o[1] + cast(body, o, [0, 1, 0])!).toBeCloseTo(max[1], 1);
    expect(16 - cast(body, [10, 16, 30], [0, -1, 0])!).toBeCloseTo(min[1], 1);
    expect(30 - cast(body, [21.5, 16, 30], [0, 0, -1])!).toBeCloseTo(min[2], 1);
  });

  it("mặt trong nắp ở z = 63 và vành cắm thu khe hở còn 36 × 25 mm", () => {
    expect(54.6 + cast(cap, [21.5, 16, 54.6], [0, 0, 1])!).toBeCloseTo(63, 1);
    const [lo, hi] = LIP_CLEARANCE_MM.box;
    const zMid = (LIP_CLEARANCE_MM.z[0] + LIP_CLEARANCE_MM.z[1]) / 2;
    expect(21.5 + cast(cap, [21.5, 16, zMid], [1, 0, 0])!).toBeCloseTo(hi[0], 1);
    expect(21.5 - cast(cap, [21.5, 16, zMid], [-1, 0, 0])!).toBeCloseTo(lo[0], 1);
    expect(16 + cast(cap, [21.5, 16, zMid], [0, 1, 0])!).toBeCloseTo(hi[1], 1);
    expect(16 - cast(cap, [21.5, 16, zMid], [0, -1, 0])!).toBeCloseTo(lo[1], 1);
  });

  it("có cửa sổ camera vuông 8 × 8 mm xuyên thành trước", () => {
    const { centerX, centerZ, size } = CAMERA_WINDOW_MM;
    expect(cast(body, [centerX, 16, centerZ], [0, -1, 0])).toBeNull();
    // Ngay ngoài mép cửa sổ thì thành vẫn kín.
    expect(cast(body, [centerX, 16, centerZ + size / 2 + 0.6], [0, -1, 0])).not.toBeNull();
    expect(cast(body, [centerX + size / 2 + 0.6, 16, centerZ], [0, -1, 0])).not.toBeNull();
    // Số tia lọt qua lưới 1 mm đúng bằng diện tích cửa sổ.
    let open = 0;
    for (let z = 9; z <= 40; z++) for (let x = 12; x <= 31; x++) if (cast(body, [x + 0.01, 16, z + 0.01], [0, -1, 0]) === null) open++;
    expect(open).toBe(size * size);
  });

  it("HIỆN CHƯA có lỗ cổng sạc hoặc lỗ công tắc ở ba thành còn lại", () => {
    for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0]] as const) {
      let escaped = 0;
      for (let z = 8; z <= 50; z++) for (let t = 6; t <= 26; t++) {
        const o: [number, number, number] = dir[0] !== 0 ? [21.5, t + 3, z] : [t + 8, 16, z];
        if (cast(body, o, [...dir]) === null) escaped++;
      }
      expect(escaped).toBe(0);
    }
  });

  // Hai file gốc ở thư mục gốc dự án đã gỡ; bản trong public/ là bản duy nhất. Hash SHA-256 của file gốc được ghim ở đây để vẫn phát hiện mọi thay đổi ngoài ý muốn.
  const pinned: Array<[string, string]> = [
    ["models/carelens/enclosure/body.stl", "7f9c49e62eb74790e90647fa2ab921782239fde4d839d91b60a7bd9780e208d6"],
    ["models/carelens/enclosure/topcap.stl", "bde49ec5ababb1ef369804ee5bbdfeb99069f87c2f8d2d6fb8e90e172c398c1e"],
  ];
  it("file STL vỏ trong public/ giống từng byte file gốc (hash SHA-256 ghim sẵn)", () => {
    for (const [copy, hash] of pinned) {
      expect(createHash("sha256").update(readFileSync(resolve(process.cwd(), "public", copy))).digest("hex")).toBe(hash);
    }
  });
});
