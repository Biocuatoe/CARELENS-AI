import { beforeAll, describe, expect, it } from "vitest";
import { Group, Quaternion, Vector3 } from "three";
import { finalPacketPose, samplePacket } from "./dataPacket";
import { CareFigure } from "./figure";
import { DIGEST_SLOTS, HEX_HIDDEN, createHexLattice, digestHex, hexPose } from "./hexLattice";
import { PACKET_SPEC } from "./dataPacket";
import { COUNTER_TOP } from "./medicationLayout";
import { createMedicationTimeline, type MedicationTimeline } from "./medicationTimeline";
import { HUB_BOX, SEC, SECURE_SCALE, SHIELD, createSecurityTimeline, type SecurePhase, type SecurityTimeline } from "./securityTimeline";
import { SEC_STEPS, STORY_SPLIT, STORY_SPLIT_REPORT, STORY_STEPS, splitStory, storyStepAt } from "./storySteps";

let obs: MedicationTimeline;
let sec: SecurityTimeline;

beforeAll(() => {
  const world = new Group();
  const figure = new CareFigure({ detailedHands: true });
  world.add(figure.root);
  world.updateMatrixWorld(true);
  obs = createMedicationTimeline(figure);
  sec = createSecurityTimeline({ pose: finalPacketPose(obs.plan), camera: (layout) => obs.evaluate(1, layout).camera });
});

const samples = (step: number) => Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => Math.min(1, i * step));
const faceW = PACKET_SPEC.width * 0.92;
const faceH = PACKET_SPEC.height * 0.9;

describe("bàn giao giữa hai chương (cùng một gói, cùng hệ toạ độ)", () => {
  it("chương bảo vệ bắt đầu đúng tư thế và đúng các lớp hiển thị của gói ở cuối chương quan sát", () => {
    const end = samplePacket(obs.plan, 1);
    const start = sec.evaluate(0, "wide").packet;
    expect(start.position.distanceTo(end.position)).toBeLessThan(1e-12);
    expect(start.quaternion.angleTo(end.quaternion)).toBeLessThan(1e-7);
    expect(start.scale).toBe(end.scale);
    for (const k of ["opacity", "brackets", "snapshot", "mosaic", "slab", "transit"] as const) expect(start[k], k).toBeCloseTo(end[k], 12);
    expect(sec.evaluate(0, "wide").hex).toEqual(HEX_HIDDEN);
    expect(sec.evaluate(0, "wide").shield.opacity).toBe(0);
  });

  it("camera bắt đầu đúng camera cuối của chương quan sát, ở cả màn rộng và màn hẹp", () => {
    for (const layout of ["wide", "narrow"] as const) {
      const a = obs.evaluate(1, layout).camera;
      const b = sec.evaluate(0, layout).camera;
      expect(b.position.distanceTo(a.position), layout).toBeLessThan(1e-9);
      expect(b.target.distanceTo(a.target), layout).toBeLessThan(1e-9);
      expect(b.fov).toBe(a.fov);
      expect(b.fit).toBeCloseTo(a.fit, 12);
      expect(b.uiRoom).toBe(a.uiRoom);
    }
  });

  it("qua điểm nối của câu chuyện không có bước nhảy: gói và camera hai bên điểm nối gần như trùng nhau", () => {
    const eps = 1e-5;
    const left = splitStory(STORY_SPLIT - eps);
    const right = splitStory(STORY_SPLIT + eps);
    expect(left.chapter).toBe(0);
    expect(right.chapter).toBe(1);
    expect(splitStory(STORY_SPLIT)).toEqual({ chapter: 0, p: 1 });
    const a = samplePacket(obs.plan, left.p);
    const b = sec.evaluate(right.p, "wide");
    expect(b.packet.position.distanceTo(a.position)).toBeLessThan(1e-4);
    const ca = obs.evaluate(left.p, "wide").camera.position;
    expect(b.camera.position.distanceTo(ca)).toBeLessThan(1e-4);
  });
});

describe("chương bảo vệ", () => {
  it("pha đi đúng thứ tự: nhấc lên → bay tới → vào khiên → lát ô → hội tụ → bản rút gọn → đứng yên", () => {
    const order: SecurePhase[] = ["lifting", "approaching", "entering", "fragmenting", "converging", "digest", "settled"];
    let rank = 0;
    const seen = new Set<SecurePhase>();
    for (const p of samples(0.0025)) {
      const r = order.indexOf(sec.evaluate(p, "wide").phase);
      expect(r, `p = ${p}`).toBeGreaterThanOrEqual(rank);
      rank = r;
      seen.add(order[r]!);
    }
    expect([...seen]).toEqual(order);
  });

  it("liên tục theo p: gói, camera, khiên và các lớp không nhảy giữa hai bước cuộn 0,0005", () => {
    for (const layout of ["wide", "narrow"] as const) {
      const prev = sec.evaluate(0, layout);
      const prevPos = prev.packet.position.clone();
      const prevQ = prev.packet.quaternion.clone();
      const prevCam = prev.camera.position.clone();
      let prevScale = prev.packet.scale;
      let prevLayers = [prev.packet.mosaic, prev.hex.fragment, prev.hex.spread, prev.hex.converge, prev.hex.digest, prev.shield.opacity, prev.roomDim];
      let maxPos = 0;
      let maxAngle = 0;
      let maxCam = 0;
      let maxScale = 0;
      let maxLayer = 0;
      for (const p of samples(0.0005).slice(1)) {
        const f = sec.evaluate(p, layout);
        maxPos = Math.max(maxPos, f.packet.position.distanceTo(prevPos));
        maxAngle = Math.max(maxAngle, f.packet.quaternion.angleTo(prevQ));
        maxCam = Math.max(maxCam, f.camera.position.distanceTo(prevCam));
        maxScale = Math.max(maxScale, Math.abs(f.packet.scale - prevScale));
        const layers = [f.packet.mosaic, f.hex.fragment, f.hex.spread, f.hex.converge, f.hex.digest, f.shield.opacity, f.roomDim];
        maxLayer = Math.max(maxLayer, ...layers.map((v, i) => Math.abs(v - prevLayers[i]!)));
        prevPos.copy(f.packet.position);
        prevQ.copy(f.packet.quaternion);
        prevCam.copy(f.camera.position);
        prevScale = f.packet.scale;
        prevLayers = layers;
      }
      expect(maxPos, layout).toBeLessThan(0.01);
      expect(maxAngle, layout).toBeLessThan(0.02);
      expect(maxCam, layout).toBeLessThan(0.03);
      expect(maxScale, layout).toBeLessThan(0.01);
      expect(maxLayer, layout).toBeLessThan(0.02);
    }
  });

  it("tất định: cùng p cho đúng cùng khung dù quét tới, lùi hay nhảy cóc", () => {
    const checkpoints = [0.1, 0.3, 0.42, 0.55, 0.7, 0.86, 1];
    const key = (p: number) => {
      const f = sec.evaluate(p, "wide");
      return [...f.packet.position.toArray(), ...f.packet.quaternion.toArray(), f.packet.scale, f.packet.mosaic, f.hex.fragment, f.hex.spread, f.hex.converge, f.hex.digest, ...f.camera.position.toArray(), f.shield.opacity, f.roomDim];
    };
    const reference = checkpoints.map(key);
    const out = sec.evaluate(0.5, "wide");
    for (const p of [...samples(0.0037), ...samples(0.0029).reverse(), 0.5, 0.99, 0.01, 0.73]) sec.evaluate(p, "wide", out);
    checkpoints.forEach((p, i) => expect(key(p), `p = ${p}`).toEqual(reference[i]));
  });

  it("đường bay không xuyên hub và không xuống dưới mặt quầy", () => {
    for (const p of samples(0.002)) {
      const s = sec.evaluate(p, "wide").packet.position;
      expect(s.y, `p = ${p}`).toBeGreaterThan(COUNTER_TOP);
      const inside = s.x > HUB_BOX.min.x && s.x < HUB_BOX.max.x && s.y > HUB_BOX.min.y && s.y < HUB_BOX.max.y && s.z > HUB_BOX.min.z && s.z < HUB_BOX.max.z;
      expect(inside, `p = ${p}`).toBe(false);
    }
  });

  it("khung cuối: gói nằm trong lòng khiên, mặt hướng người xem, độ lớn cuối; chỉ còn tám ô của dải rút gọn và chuỗi ký tự hiện đủ", () => {
    const f = sec.evaluate(1, "wide");
    expect(f.phase).toBe("settled");
    const pos = f.packet.position;
    expect(Math.abs(pos.x - SHIELD.center.x)).toBeLessThan(SHIELD.width * 0.3);
    expect(Math.abs(pos.y - SHIELD.center.y)).toBeLessThan(SHIELD.height * 0.3);
    expect(Math.abs(pos.z - SHIELD.center.z)).toBeLessThan(0.03);
    expect(new Vector3(0, 0, 1).applyQuaternion(f.packet.quaternion).z).toBeCloseTo(1, 9);
    expect(f.packet.scale).toBeCloseTo(SECURE_SCALE.final, 9);
    expect(f.packet.mosaic).toBe(0);
    expect(f.hex.digest).toBe(1);
    const lattice = createHexLattice(faceW, faceH);
    const visible = lattice.cells.filter((c) => hexPose(lattice, c, f.hex).scale > 1e-4);
    expect(visible.length).toBe(DIGEST_SLOTS);
    expect(visible.every((c) => c.representative)).toBe(true);
    // Dải rút gọn (ở độ lớn cuối) nằm trọn trong bề ngang bên trong của khiên.
    const stripHalf = ((DIGEST_SLOTS * lattice.slotSpacing) / 2) * SECURE_SCALE.final;
    expect(stripHalf).toBeLessThan((SHIELD.width * 0.85) / 2);
    // Camera nhìn thẳng vào khiên.
    expect(f.camera.target.distanceTo(SHIELD.center)).toBeLessThan(0.05);
  });

  it("cuộn ngược về trước chương bảo vệ: khiên ẩn, lớp lục giác ẩn, thẻ dữ liệu hiện đủ như cũ", () => {
    sec.evaluate(1, "wide");
    const f = sec.evaluate(0, "wide");
    expect(f.shield.opacity).toBe(0);
    expect(f.hex).toEqual(HEX_HIDDEN);
    expect(f.packet.mosaic).toBe(1);
    expect(f.packet.slab).toBe(1);
    expect(f.roomDim).toBe(0);
  });

  it("ô lục giác xuất hiện khi thẻ mờ dần (không có khoảnh khắc nào gói biến mất hẳn)", () => {
    const lattice = createHexLattice(faceW, faceH);
    for (const p of samples(0.002)) {
      const f = sec.evaluate(p, "wide");
      const hexes = lattice.cells.filter((c) => hexPose(lattice, c, f.hex).scale > 0.3).length;
      // Thẻ còn rõ, hoặc đã có ít nhất tám ô đủ lớn.
      expect(f.packet.mosaic > 0.5 || hexes >= DIGEST_SLOTS, `p = ${p}`).toBe(true);
    }
    expect(SEC.card[0]).toBeGreaterThanOrEqual(SEC.fragment[0]);
  });
});

describe("lưới lục giác và chuỗi minh hoạ", () => {
  it("60 ô phủ mặt ảnh, mỗi ô đích có đúng một ô đại diện, toạ độ lấy màu nằm trong ảnh", () => {
    const l = createHexLattice(faceW, faceH);
    expect(l.cells.length).toBe(60);
    for (let k = 0; k < DIGEST_SLOTS; k++) expect(l.cells.filter((c) => c.slot === k && c.representative).length, `ô đích ${k}`).toBe(1);
    for (const c of l.cells) {
      expect(c.u).toBeGreaterThanOrEqual(0);
      expect(c.u).toBeLessThanOrEqual(1);
      expect(c.v).toBeGreaterThanOrEqual(0);
      expect(c.v).toBeLessThanOrEqual(1);
      expect(Math.abs(c.x)).toBeLessThan(faceW / 2 + l.radius);
      expect(Math.abs(c.y)).toBeLessThan(faceH / 2 + l.radius);
    }
  });

  it("ô đứng đúng tâm lưới khi vừa lát, và đúng tâm ô đích khi đã hội tụ", () => {
    const l = createHexLattice(faceW, faceH);
    const start = { fragment: 1, spread: 0, converge: 0, digest: 0, fade: 0 };
    const end = { fragment: 1, spread: 1, converge: 1, digest: 1, fade: 0 };
    for (const c of l.cells) {
      const a = hexPose(l, c, start);
      expect(a.x).toBeCloseTo(c.x, 12);
      expect(a.y).toBeCloseTo(c.y, 12);
      expect(a.scale).toBeCloseTo(1, 12);
      const b = hexPose(l, c, end);
      expect(b.x).toBeCloseTo(l.slots[c.slot]!.x, 12);
      expect(b.y).toBeCloseTo(l.slots[c.slot]!.y, 12);
      expect(b.mix).toBe(1);
    }
  });

  it("chuỗi minh hoạ là 16 ký tự hex, cố định theo dữ liệu ảnh và đổi khi ảnh đổi", () => {
    const img = Uint8Array.from({ length: 32 * 24 * 4 }, (_, i) => (i * 37) & 0xff);
    const a = digestHex(img);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(digestHex(img)).toBe(a);
    const other = img.slice();
    other[100] = (other[100]! + 1) & 0xff;
    expect(digestHex(other)).not.toBe(a);
  });
});

describe("bước của câu chuyện", () => {
  it("bảy bước theo đúng thứ tự, ảnh tĩnh của từng bước thuộc đúng bước đó, chương bảo vệ bắt đầu sau điểm nối", () => {
    expect(STORY_STEPS.map((s) => s.id)).toEqual(["action", "observe", "packet", "send", "shield", "fragment", "digest"]);
    STORY_STEPS.forEach((s, i) => expect(storyStepAt(s.rest), s.id).toBe(i));
    expect(storyStepAt(STORY_SPLIT)).toBe(3);
    expect(STORY_STEPS[4]!.from).toBeGreaterThan(STORY_SPLIT);
    let last = 0;
    for (const s of samples(0.002)) {
      const k = storyStepAt(s);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
  });

  it("ảnh tĩnh của giảm chuyển động nói đúng điều cần thấy ở từng bước bảo vệ", () => {
    const at = (i: number) => sec.evaluate(SEC_STEPS[i]!.rest, "wide");
    expect(at(0).phase).toBe("entering");
    expect(at(0).shield.opacity).toBeGreaterThan(0.99);
    expect(at(1).phase).toBe("fragmenting");
    expect(at(1).hex.fragment).toBeGreaterThan(0.99);
    expect(at(2).phase).toBe("digest");
    expect(at(2).hex.digest).toBe(1);
  });

  it("đầu và cuối của mỗi chương khớp p của chương đó", () => {
    expect(splitStory(0)).toEqual({ chapter: 0, p: 0 });
    expect(splitStory(STORY_SPLIT_REPORT)).toEqual({ chapter: 1, p: 1 });
    expect(splitStory(1)).toEqual({ chapter: 2, p: 1 });
    const q = new Quaternion();
    expect(q.angleTo(sec.evaluate(1, "narrow").packet.quaternion)).toBeLessThan(1e-9);
  });
});
