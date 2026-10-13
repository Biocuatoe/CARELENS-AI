import {
  Box3,
  BoxHelper,
  Color,
  DoubleSide,
  Euler,
  FrontSide,
  Group,
  Mesh,
  MathUtils,
  Object3D,
  Plane,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
  type Vector3Tuple,
} from "three";
import { bakeCavityOcclusion, fetchBytes, parseEnclosureStl, parseGlb, type ByteLoader } from "./assets";
import {
  ACTIVE_BATTERY_PROFILE,
  BATTERY_PROFILES,
  COMPONENTS,
  assetUrl,
  center,
  type ComponentConfig,
  type PartId,
} from "./assemblyConfig";
import { CAP_WINDOW, EXPLODE_RANGE } from "./animationConfig";
import { checkFit, type FitEntry, type PartBox } from "./fit";
import { TEAL_ACCENT, createMaterials, type MaterialSet } from "./materials";
import {
  buildBoostConverter,
  buildEsp32Cam,
  buildFallbackBox,
  buildGy521,
  buildLipoCell,
  buildSlideSwitch,
  buildTp4056,
  setSwitchPosition,
  type SwitchPosition,
} from "./procedural";
import { createTimeline, type Timeline } from "./timeline";
import { CAD_TO_SCENE_ROTATION_X } from "./units";

export type PartStatus = "loaded" | "fallback";
/** Mặt cắt vỏ để nhìn bên trong: bỏ nửa trước (nhìn từ trước) hoặc nửa phải (nhìn từ phải). Chỉ cắt vỏ, không cắt linh kiện. */
export type SectionMode = "none" | "front-half" | "right-half";

export interface PartHandle {
  config: ComponentConfig;
  /** Nhóm gốc của vật thể; `name` và `userData.partId` là mã vật thể. */
  object: Group;
  status: PartStatus;
  error?: string;
  /** Hộp bao cứng đo từ hình học thật ở trạng thái lắp (khung CAD, mm). */
  assembledBox: PartBox;
  /** Sai lệch lớn nhất (mm) giữa hộp trong cấu hình và hình học thật. */
  configMismatchMm: number;
  /** Số byte đã tải (STL hoặc GLB); `undefined` với vật thể dựng bằng code. */
  assetBytes?: number;
}

export interface HardwareAssembly {
  /** Thêm nhóm này vào scene. Đã xoay từ khung CAD sang khung three.js. */
  root: Group;
  /** Khung CAD (mm, Z lên) bên trong `root`. */
  cadFrame: Group;
  parts: ReadonlyMap<PartId, PartHandle>;
  /** Kiểm tra hộp bao thô với khoang trong (xem validate.ts cho kiểm tra theo mesh). */
  fit: FitEntry[];
  /** Hình học STL của vỏ theo khung CAD, dùng cho kiểm tra va chạm. */
  enclosureGeometry: { body: BufferGeometry; cap: BufferGeometry };
  /** Dòng thời gian cuộn dùng chung (hàm thuần của tiến trình). */
  timeline: Timeline;
  /**
   * Đặt vị trí tâm các vật thể (khung CAD, mm). Chỉ ghi vị trí hiện hành của các nhóm; vị trí nhà và trạm trong `assemblyConfig.ts`
   * không bao giờ bị sửa, nên `applyPositions(homes)` luôn khôi phục đúng trạng thái lắp.
   */
  applyPositions(positions: Readonly<Record<PartId, Vector3>>): void;
  /** t ∈ [0, 1]: từ đóng kín (t = 0) tới tách hoàn toàn (t = 1) theo đúng dòng thời gian của cảnh cuộn (mở nắp rồi tách từng linh kiện). */
  setExplode(t: number): void;
  setPartVisible(id: PartId, visible: boolean): void;
  setEnclosureGhost(ghost: boolean): void;
  setSection(mode: SectionMode): void;
  setSwitchPosition(position: SwitchPosition): void;
  setHighlight(ids: PartId | readonly PartId[] | null): void;
  /**
   * Cho mọi vật thể không nằm trong `ids` lùi dần về tông nền (amount 0 → 1) để linh kiện đang giới thiệu nổi lên; null hoặc 0 trả lại màu gốc.
   * Chỉ đổi màu vật liệu (bản sao riêng của từng vật thể), không đổi hình học hay vị trí.
   */
  setFocus(ids: readonly PartId[] | null, amount: number): void;
  /** Hộp bao toàn bộ cảnh ở trạng thái hiện tại, theo khung scene (three.js). */
  getSceneBounds(): Box3;
  dispose(): void;
}

type FocusMaterial = Material & { color?: Color; envMapIntensity?: number };

/**
 * Mỗi vật thể dùng bản sao vật liệu của riêng nó (chia sẻ trong phạm vi vật thể), để có thể làm tối từng vật thể khi cảnh giới thiệu
 * một linh kiện khác. Lưu màu gốc vào `userData.baseColor`.
 */
function ownMaterials(holder: Object3D): FocusMaterial[] {
  const clones = new Map<Material, FocusMaterial>();
  holder.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const swap = (mat: Material): Material => {
      let c = clones.get(mat);
      if (!c) {
        c = mat.clone() as FocusMaterial;
        if (c.color) c.userData.baseColor = c.color.clone();
        c.userData.baseEnv = c.envMapIntensity ?? 1;
        clones.set(mat, c);
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
  return [...clones.values()];
}

/** Kích thước hộp thay thế (mm) khi một GLB không tải được, lấy từ cấu hình. */
const GHOST_OPACITY = 0.16;
/** Mức lùi tối đa của các vật thể không được giới thiệu về tông nền (0 → 1). */
const FOCUS_DIM = 0.62;
/** Tông lùi: nằm giữa hai màu nền #14232D và #233642 của landing. */
const FOCUS_RECEDE = new Color("#1b2c37");

/** Hộp bao bỏ qua các mesh đánh dấu `userData.flexible` (dây, đầu nối, lá tab). */
export function rigidBox(object: Object3D): Box3 {
  const box = new Box3();
  object.updateWorldMatrix(true, true);
  object.traverse((o) => {
    if ((o as Mesh).isMesh && !o.userData.flexible) box.expandByObject(o, true);
  });
  return box;
}

interface Built {
  object: Object3D;
  status: PartStatus;
  error?: string;
  bytes?: number;
}

async function buildContent(c: ComponentConfig, m: MaterialSet, load: ByteLoader): Promise<Built> {
  switch (c.id) {
    case "enclosure-body":
    case "enclosure-cap": {
      const bytes = await load(assetUrl(c.asset!));
      const geometry = parseEnclosureStl(bytes);
      bakeCavityOcclusion(geometry, c.id === "enclosure-body" ? "body" : "cap");
      const material = m.printedPolymer.clone();
      material.vertexColors = true;
      const mesh = new Mesh(geometry, material);
      mesh.name = c.id === "enclosure-body" ? "body-mesh" : "cap-mesh";
      return { object: mesh, status: "loaded", bytes: bytes.byteLength };
    }
    case "max98357a":
    case "speaker": {
      try {
        const bytes = await load(assetUrl(c.asset!));
        const object = await parseGlb(bytes);
        remapCadMaterials(object, c.id, m);
        return { object, status: "loaded", bytes: bytes.byteLength };
      } catch (e) {
        return {
          object: buildFallbackBox(c.id, c.dimensions.size, m),
          status: "fallback",
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }
    case "esp32-cam":
      return { object: buildEsp32Cam(m), status: "loaded" };
    case "lipo-cell":
      return { object: buildLipoCell(m, BATTERY_PROFILES[ACTIVE_BATTERY_PROFILE]), status: "loaded" };
    case "tp4056":
      return { object: buildTp4056(m), status: "loaded" };
    case "boost-converter":
      return { object: buildBoostConverter(m), status: "loaded" };
    case "gy521":
      return { object: buildGy521(m), status: "loaded" };
    case "slide-switch":
      return { object: buildSlideSwitch(m, "off"), status: "loaded" };
  }
}

/**
 * Vật liệu xuất từ STEP của hai GLB Adafruit chỉ là màu phẳng cùng độ nhám 0,6 cho mọi chi tiết. Gán lại theo tên mesh trong file
 * (hình học giữ nguyên): bo → phủ hàn, chân QFN → thiếc, thân IC → nhựa epoxy, linh kiện 0805 → gốm; loa: khung và nam châm đen,
 * màng loa trắng ngà mờ, dây đỏ/đen. Màu phủ hàn đen của bo khuếch đại là giả định hiển thị, không phải thông tin về bo thật.
 */
function remapCadMaterials(object: Object3D, id: "max98357a" | "speaker", m: MaterialSet): void {
  const rules: Array<[RegExp, Material]> =
    id === "max98357a"
      ? [
          [/^Board/, m.solderMaskBlack],
          [/^part_9/, m.chip],
          [/^part_\d/, m.tin],
          [/^0805/, m.ceramicCap],
        ]
      : [
          [/^part_[012](?!\d)/, m.plasticBlack],
          [/^part_[34](?!\d)/, m.speakerMembrane],
          [/^part_5/, m.plasticWhite],
          [/^part_6/, m.wireBlack],
          [/^part_7/, m.wireRed],
        ];
  object.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const rule = rules.find(([re]) => re.test(mesh.name) || re.test(mesh.parent?.name ?? ""));
    if (!rule) return;
    const old = mesh.material;
    for (const mat of Array.isArray(old) ? old : [old]) mat.dispose();
    mesh.material = rule[1];
  });
}

const toQuat = ([x, y, z]: Vector3Tuple) =>
  new Quaternion().setFromEuler(new Euler(MathUtils.degToRad(x), MathUtils.degToRad(y), MathUtils.degToRad(z), "XYZ"));

/**
 * Dựng toàn bộ cụm theo `assemblyConfig.ts`: vỏ + 8 nhóm linh kiện, mỗi nhóm là một `Group` độc lập đặt tên theo `PartId`.
 * Không tải được STL vỏ thì throw; GLB lỗi thì dùng hộp thay thế có đánh dấu.
 */
export async function buildHardwareAssembly(options: { load?: ByteLoader } = {}): Promise<HardwareAssembly> {
  const load = options.load ?? fetchBytes;
  const materials = createMaterials();
  const cad = new Group();
  cad.name = "carelens-cad-frame";
  const handles = new Map<PartId, PartHandle>();
  const partMaterials = new Map<PartId, FocusMaterial[]>();

  try {
    const built = await Promise.all(COMPONENTS.map(async (c) => ({ c, b: await buildContent(c, materials, load) })));
    for (const { c, b } of built) {
      // Nhóm gốc mang đúng mã; nhóm mô hình bên trong đổi tên để không trùng khi tìm theo tên.
      if (b.object.name === c.id) b.object.name = `${c.id}:model`;
      const holder = new Group();
      holder.name = c.id;
      holder.userData.partId = c.id;
      const inner = new Group();
      inner.name = `${c.id}:content`;
      inner.add(b.object);
      inner.position.copy(rigidBox(inner).getCenter(new Vector3()).negate());
      holder.add(inner);

      partMaterials.set(c.id, ownMaterials(holder));
      holder.position.set(...center(c.assembled.box));
      holder.quaternion.copy(toQuat(c.assembled.rotation));
      cad.add(holder);
      cad.updateMatrixWorld(true);

      const box = rigidBox(holder);
      const want = c.assembled.box;
      const mismatch = Math.max(
        Math.abs(box.min.x - want.x[0]), Math.abs(box.max.x - want.x[1]),
        Math.abs(box.min.y - want.y[0]), Math.abs(box.max.y - want.y[1]),
        Math.abs(box.min.z - want.z[0]), Math.abs(box.max.z - want.z[1]),
      );
      handles.set(c.id, {
        config: c,
        object: holder,
        status: b.status,
        ...(b.error ? { error: b.error } : {}),
        assembledBox: { id: c.id, min: box.min.toArray(), max: box.max.toArray() },
        configMismatchMm: mismatch,
        ...(b.bytes !== undefined ? { assetBytes: b.bytes } : {}),
      });
    }
  } catch (e) {
    materials.dispose();
    throw e;
  }

  const root = new Group();
  root.name = "carelens-hardware";
  root.rotation.x = CAD_TO_SCENE_ROTATION_X;
  root.add(cad);
  root.updateMatrixWorld(true);

  const enclosureMesh = (id: PartId) => handles.get(id)!.object.getObjectByName(id === "enclosure-body" ? "body-mesh" : "cap-mesh") as Mesh;
  const enclosureMeshes = [enclosureMesh("enclosure-body"), enclosureMesh("enclosure-cap")];
  const enclosureMaterials = enclosureMeshes.map((m) => m.material as Material);
  const electronics = [...handles.values()].filter((h) => h.config.group === "electronics").map((h) => h.assembledBox);

  const timeline = createTimeline();
  function applyPositions(positions: Readonly<Record<PartId, Vector3>>): void {
    for (const [id, h] of handles) h.object.position.copy(positions[id]);
    cad.updateMatrixWorld(true);
    for (const hl of highlights) hl.update();
  }

  function setHighlight(ids: PartId | readonly PartId[] | null): void {
    for (const hl of highlights) {
      hl.removeFromParent();
      hl.geometry.dispose();
      (hl.material as Material).dispose();
    }
    highlights = [];
    const list = ids === null ? [] : typeof ids === "string" ? [ids] : ids;
    for (const id of list) {
      const h = handles.get(id);
      if (!h) continue;
      const hl = new BoxHelper(h.object, TEAL_ACCENT);
      hl.name = "highlight";
      // BoxHelper dùng toạ độ thế giới nên gắn vào cha của `root` (scene), không gắn vào khung CAD đã xoay.
      (root.parent ?? root).add(hl);
      highlights.push(hl);
    }
  }

  const scratchFrame = timeline.createFrame();
  let highlights: BoxHelper[] = [];
  let section: SectionMode = "none";
  let focusKey = "";

  const applySection = () => {
    // Mặt cắt theo khung CAD, đổi sang toạ độ thế giới (clipping plane của three.js là toạ độ thế giới).
    const plane =
      section === "front-half" ? new Plane(new Vector3(0, 1, 0), -16) : section === "right-half" ? new Plane(new Vector3(-1, 0, 0), 21.5) : null;
    const world = plane?.clone().applyMatrix4(cad.matrixWorld);
    for (const mat of enclosureMaterials) {
      mat.clippingPlanes = world ? [world] : [];
      mat.side = world ? DoubleSide : FrontSide;
      mat.needsUpdate = true;
    }
  };

  return {
    root,
    cadFrame: cad,
    parts: handles,
    fit: checkFit(electronics),
    enclosureGeometry: { body: enclosureMeshes[0]!.geometry, cap: enclosureMeshes[1]!.geometry },
    timeline,
    applyPositions,
    setExplode(t) {
      const k = Math.min(1, Math.max(0, t));
      const p = CAP_WINDOW[0] + k * (EXPLODE_RANGE[1] - CAP_WINDOW[0]);
      timeline.evaluate(p, "wide", scratchFrame);
      applyPositions(scratchFrame.positions);
    },
    setPartVisible(id, visible) {
      const h = handles.get(id);
      if (h) h.object.visible = visible;
    },
    setEnclosureGhost(ghost) {
      for (const mat of enclosureMaterials) {
        mat.transparent = ghost;
        mat.opacity = ghost ? GHOST_OPACITY : 1;
        mat.depthWrite = !ghost;
        mat.needsUpdate = true;
      }
    },
    setSection(mode) {
      section = mode;
      applySection();
    },
    setSwitchPosition(position) {
      const h = handles.get("slide-switch");
      if (h) setSwitchPosition(h.object, position);
    },
    setHighlight,
    setFocus(ids, amount) {
      const k = ids && ids.length ? Math.min(1, Math.max(0, amount)) : 0;
      const key = k === 0 ? "" : `${ids!.join("|")}:${k.toFixed(2)}`;
      if (key === focusKey) return;
      focusKey = key;
      for (const [id, mats] of partMaterials) {
        const t = k > 0 && !ids!.includes(id) ? FOCUS_DIM * k : 0;
        for (const mat of mats) {
          const base = mat.userData.baseColor as Color | undefined;
          // Lùi về tông nền (xanh than) thay vì chỉ tối đi: vật thể phụ chìm vào nền, không ngả màu bùn.
          if (base && mat.color) mat.color.copy(base).lerp(FOCUS_RECEDE, t);
          if (mat.envMapIntensity !== undefined) mat.envMapIntensity = (mat.userData.baseEnv as number) * (1 - 0.7 * t);
        }
      }
    },
    getSceneBounds() {
      root.updateMatrixWorld(true);
      const box = new Box3();
      for (const h of handles.values()) if (h.object.visible) box.union(new Box3().setFromObject(h.object));
      return box;
    },
    dispose() {
      setHighlight(null);
      root.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) if (!materials.all.includes(mat)) mat.dispose();
        }
      });
      materials.dispose();
      root.removeFromParent();
    },
  };
}
