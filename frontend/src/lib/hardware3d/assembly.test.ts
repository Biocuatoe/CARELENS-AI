// @vitest-environment node
/// <reference types="node" />
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildHardwareAssembly } from "./assembly";
import { BATTERY_PROFILES, COMPONENTS, PART_IDS, center, extent } from "./assemblyConfig";
import { checkFit, sizeOf } from "./fit";
import { SolidTester, validateAssembly } from "./validate";
import { CAMERA_WINDOW_MM, INTERIOR_MM } from "./units";
import { PUBLIC_DIR, diskLoader } from "./testing";

const assembly = await buildHardwareAssembly({ load: diskLoader });
const sorted = (v: readonly number[]) => [...v].sort((a, b) => a - b);
const round2 = (v: readonly number[]) => v.map((n) => +n.toFixed(2));

describe("cấu hình lắp ráp (assemblyConfig.ts)", () => {
  it("mỗi linh kiện có mã ổn định, dữ liệu kích thước, hai tư thế và ghi chú vị trí", () => {
    expect(COMPONENTS.map((c) => c.id).sort()).toEqual([...PART_IDS].sort());
    for (const c of COMPONENTS) {
      expect(c.dimensions.basis.length).toBeGreaterThan(0);
      expect(c.placement.notes.length).toBeGreaterThan(0);
      expect(c.assembled.rotation).toHaveLength(3);
      expect(c.exploded.rotation).toHaveLength(3);
      if (c.source !== "procedural") expect(c.asset).toBeTruthy();
    }
  });

  it("hộp lắp trong cấu hình khớp hình học dựng được (sai lệch ≤ 0,01 mm)", () => {
    for (const h of assembly.parts.values()) expect(h.configMismatchMm, h.config.id).toBeLessThanOrEqual(0.01);
  });

  it("kích thước cục bộ khai báo khớp hộp bao đo được", () => {
    for (const h of assembly.parts.values()) {
      const declared = sorted(h.config.dimensions.size);
      sorted(sizeOf(h.assembledBox)).forEach((v, i) => expect(v, h.config.id).toBeCloseTo(declared[i]!, 2));
      sorted(extent(h.config.assembled.box)).forEach((v, i) => expect(v, h.config.id).toBeCloseTo(declared[i]!, 2));
    }
  });
});

describe("cụm phần cứng", () => {
  it("có đủ 10 vật thể độc lập, tên trùng mã, mỗi vật thể có mesh", () => {
    expect([...assembly.parts.keys()].sort()).toEqual([...PART_IDS].sort());
    for (const id of PART_IDS) {
      const h = assembly.parts.get(id)!;
      expect(h.object.name).toBe(id);
      expect(assembly.root.getObjectByName(id)).toBe(h.object);
      let meshes = 0;
      h.object.traverse((o) => void ((o as Mesh).isMesh && meshes++));
      expect(meshes).toBeGreaterThan(0);
    }
  });

  it("linh kiện con truy cập được theo tên", () => {
    for (const n of ["lens", "lens-glass", "camera-module", "esp32-s3-wroom-1", "usb-c", "usb-c-mouth", "pouch", "wires", "slider", "slider-knob", "trimmer"]) {
      expect(assembly.root.getObjectByName(n), n).toBeTruthy();
    }
  });

  it("tải đúng hai GLB Adafruit, số byte khớp file", () => {
    for (const id of ["max98357a", "speaker"] as const) {
      const h = assembly.parts.get(id)!;
      expect(h.status).toBe("loaded");
      expect(h.assetBytes).toBe(statSync(resolve(PUBLIC_DIR, h.config.asset!)).size);
    }
  });

  it("GLB lỗi thì dùng hộp thay thế có đánh dấu; STL vỏ lỗi thì throw", async () => {
    const broken = await buildHardwareAssembly({
      load: async (url) => {
        if (url.endsWith(".glb")) throw new Error("mạng lỗi");
        return diskLoader(url);
      },
    });
    expect(broken.parts.get("speaker")!.status).toBe("fallback");
    expect(broken.parts.get("speaker")!.object.getObjectByName("fallback-box")).toBeTruthy();
    broken.dispose();
    await expect(
      buildHardwareAssembly({
        load: async () => {
          throw new Error("404");
        },
      }),
    ).rejects.toThrow("404");
  });

  it("công tắc là loại trượt chốt hai vị trí, cần gạt đi lên khi BẬT", () => {
    const sw = assembly.parts.get("slide-switch")!.object;
    const knob = sw.getObjectByName("slider-knob")!;
    const toCad = assembly.cadFrame.matrixWorld.clone().invert();
    const zOf = () => {
      sw.updateMatrixWorld(true);
      return new Box3().setFromObject(knob).applyMatrix4(toCad).getCenter(new Vector3()).z;
    };
    assembly.setSwitchPosition("off");
    const off = zOf();
    assembly.setSwitchPosition("on");
    const on = zOf();
    assembly.setSwitchPosition("off");
    expect(on - off).toBeCloseTo(3, 3);
    let tactile = false;
    sw.traverse((o) => void (/tactile|push/i.test(o.name) && (tactile = true)));
    expect(tactile).toBe(false);
  });

  it("tách rời đưa vật thể tới đúng tư thế trong cấu hình và trở về khi t = 0", () => {
    assembly.setExplode(1);
    for (const c of COMPONENTS) expect(round2(assembly.parts.get(c.id)!.object.position.toArray()), c.id).toEqual(round2(c.exploded.position));
    assembly.setExplode(0);
    for (const c of COMPONENTS) expect(assembly.parts.get(c.id)!.object.position.distanceTo(new Vector3(...center(c.assembled.box)))).toBeLessThan(1e-9);
  });

  it("vỏ trong suốt và mặt cắt chỉ đổi vật liệu của hai nửa vỏ", () => {
    const mats = (["enclosure-body", "enclosure-cap"] as const).map(
      (id) => (assembly.parts.get(id)!.object.getObjectByName(id === "enclosure-body" ? "body-mesh" : "cap-mesh") as Mesh).material as MeshStandardMaterial,
    );
    assembly.setEnclosureGhost(true);
    for (const m of mats) expect(m.transparent && m.opacity < 0.5).toBe(true);
    assembly.setEnclosureGhost(false);
    assembly.setSection("front-half");
    for (const m of mats) expect(m.clippingPlanes).toHaveLength(1);
    assembly.setSection("none");
    for (const m of mats) expect(m.clippingPlanes).toHaveLength(0);
  });
});

describe("kiểm tra lắp ráp theo mesh STL (validate.ts)", () => {
  const report = validateAssembly(assembly);

  it("phép thử điểm phân loại đúng các điểm đã biết của vỏ", () => {
    const body = new SolidTester(assembly.enclosureGeometry.body);
    const cap = new SolidTester(assembly.enclosureGeometry.cap);
    expect(body.inside(new Vector3(21.5, 16, 30))).toBe(false); // khoang trong
    expect(body.inside(new Vector3(1, 16, 30))).toBe(true); // trong thành trái 2 mm
    expect(body.inside(new Vector3(21.5, 1, 20.5))).toBe(false); // trong cửa sổ camera
    expect(body.inside(new Vector3(21.5, 1, 30))).toBe(true); // thành trước
    expect(cap.inside(new Vector3(21.5, 16, 64))).toBe(true); // đỉnh nắp
    expect(cap.inside(new Vector3(21.5, 16, 60))).toBe(false); // vòm trong nắp
  });

  it("trạng thái lắp: không điểm nào của linh kiện cứng nằm trong thành vỏ hay ra ngoài vỏ", () => {
    expect(report.checkedPoints).toBeGreaterThan(5000);
    expect(report.shellIssues).toEqual([]);
  });

  it("trạng thái lắp: không có va chạm giữa các linh kiện", () => {
    expect(report.collisions.map((c) => `${c.a}/${c.meshA}∩${c.b}/${c.meshB}`)).toEqual([]);
  });

  it("trạng thái tách rời: không có va chạm giữa các linh kiện", () => {
    assembly.setExplode(1);
    const exploded = validateAssembly(assembly, { includeShell: false });
    assembly.setExplode(0);
    expect(exploded.collisions).toEqual([]);
  });

  it("camera: tâm ống kính trùng tâm cửa sổ, trục quang hướng −Y ra ngoài và nhìn qua cửa sổ", () => {
    expect(report.camera.offsetFromWindowMm).toBeLessThan(0.01);
    expect(report.camera.axisErrorDeg).toBeLessThan(0.01);
    expect(report.camera.openingFound).toBe(true);
    expect(report.camera.position[0]).toBeCloseTo(CAMERA_WINDOW_MM.centerX, 2);
    expect(report.camera.position[1]).toBeGreaterThan(INTERIOR_MM[0][1]);
    expect(report.camera.position[1]).toBeLessThan(INTERIOR_MM[0][1] + 0.5);
  });

  it("USB-C và công tắc: STL HIỆN KHÔNG CÓ lỗ; bộ phận hướng thẳng vào thành gần nhất", () => {
    expect(report.usbC.openingFound).toBe(false);
    expect(report.usbC.direction).toEqual([-1, 0, 0]);
    expect(report.usbC.gapToWallMm!).toBeLessThan(1);
    expect(report.switchActuator.openingFound).toBe(false);
    expect(report.switchActuator.direction).toEqual([-1, 0, 0]);
    expect(report.switchActuator.gapToWallMm!).toBeLessThan(0.5);
  });

  it("phát hiện được linh kiện bị đẩy vào thành và va chạm giữa linh kiện (kiểm tra âm)", () => {
    const sw = assembly.parts.get("slide-switch")!.object;
    const swBefore = sw.position.clone();
    sw.position.x -= 1.5; // cần gạt cắm vào thành trái
    assembly.cadFrame.updateMatrixWorld(true);
    const intoWall = validateAssembly(assembly);
    sw.position.copy(swBefore);

    const spk = assembly.parts.get("speaker")!.object;
    const spkBefore = spk.position.clone();
    spk.position.z -= 1.5; // đè xuống mạch sạc
    assembly.cadFrame.updateMatrixWorld(true);
    const overlap = validateAssembly(assembly, { includeShell: false });
    spk.position.copy(spkBefore);
    assembly.cadFrame.updateMatrixWorld(true);

    expect(intoWall.shellIssues.some((s) => s.id === "slide-switch" && s.kind === "wall")).toBe(true);
    expect(overlap.collisions.some((c) => [c.a, c.b].includes("speaker") && [c.a, c.b].includes("tp4056"))).toBe(true);
  });
});

describe("pin", () => {
  it("pin tham chiếu Adafruit 2000 mAh (37 × 60 × 7,5 mm) không vừa khoang theo bất kỳ hướng nào", () => {
    const ref = BATTERY_PROFILES["reference-adafruit-2011"];
    const [fit] = checkFit([{ id: "lipo-cell", min: [0, 0, 0], max: [ref.width, ref.thickness, ref.length] }]);
    expect(fit!.fitsInterior).toBe(false);
  });

  it("pin định dạng 103450 (giả định) được dựng đúng kích thước định dạng", () => {
    expect(round2(sorted(sizeOf(assembly.parts.get("lipo-cell")!.assembledBox)))).toEqual([10, 34, 50]);
  });
});
