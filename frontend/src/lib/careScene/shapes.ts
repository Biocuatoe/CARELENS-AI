import { BufferGeometry, Float32BufferAttribute, LatheGeometry, Vector2, type Vector3Like } from "three";

/** Chi tròn thuôn: thân lathe có hai đầu bán cầu, bán kính r1 ở khớp trên và r2 ở khớp dưới, chạy dọc −Y từ gốc. */
export function limbGeometry(length: number, r1: number, r2: number, segments = 22): BufferGeometry {
  const pts: Vector2[] = [];
  const cap = 7;
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(Math.max(1e-4, r2 * Math.sin(a)), -length - r2 * Math.cos(a)));
  }
  for (let i = 0; i <= cap; i++) {
    const a = Math.PI / 2 - (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(Math.max(1e-4, r1 * Math.sin(a)), r1 * Math.cos(a)));
  }
  return new LatheGeometry(pts, segments);
}

/** Điểm dừng bán kính dọc theo chi: `t` từ 0 (khớp trên) tới 1 (khớp dưới). */
export interface LimbStop {
  t: number;
  r: number;
}

/** Nếp vải vòng quanh chi: rãnh gọn tại `t`, sâu `amp` (tỉ lệ bán kính), rộng `w` (tỉ lệ chiều dài). */
export interface LimbFold {
  t: number;
  amp: number;
  w: number;
}

/** Nội suy trơn (Catmull-Rom một chiều) bán kính theo các điểm dừng. */
function radiusAt(stops: readonly LimbStop[], t: number): number {
  const n = stops.length;
  if (t <= stops[0]!.t) return stops[0]!.r;
  if (t >= stops[n - 1]!.t) return stops[n - 1]!.r;
  let i = 0;
  while (i < n - 2 && t > stops[i + 1]!.t) i++;
  const p1 = stops[i]!;
  const p2 = stops[i + 1]!;
  const p0 = stops[Math.max(0, i - 1)]!;
  const p3 = stops[Math.min(n - 1, i + 2)]!;
  const u = (t - p1.t) / (p2.t - p1.t);
  // Hermite với độ dốc ở hai đầu lấy theo hiệu hai điểm lân cận (đã quy về cùng trục t).
  const m1 = ((p2.r - p0.r) / (p2.t - p0.t || 1)) * (p2.t - p1.t);
  const m2 = ((p3.r - p1.r) / (p3.t - p1.t || 1)) * (p2.t - p1.t);
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p1.r + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2.r + (u3 - u2) * m2;
}

/**
 * Chi có hồ sơ bán kính tuỳ ý (đùi, bắp chân, cánh tay…) và nếp vải vòng quanh ở khớp. Cùng quy ước với `limbGeometry`: chạy dọc −Y từ gốc,
 * hai đầu là bán cầu có bán kính bằng bán kính ở đầu đó. Hồ sơ là hàm thuần của tham số nên mọi lần dựng cho cùng hình.
 */
export function shapedLimbGeometry(length: number, stops: readonly LimbStop[], folds: readonly LimbFold[] = [], segments = 28, rings = 34): BufferGeometry {
  const rTop = stops[0]!.r;
  const rEnd = stops[stops.length - 1]!.r;
  const pts: Vector2[] = [];
  const cap = 8;
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(Math.max(1e-4, rEnd * Math.sin(a)), -length - rEnd * Math.cos(a)));
  }
  for (let i = rings; i >= 0; i--) {
    const t = i / rings;
    let r = radiusAt(stops, t);
    for (const f of folds) {
      const d = (t - f.t) / f.w;
      r *= 1 - f.amp * Math.exp(-d * d);
    }
    pts.push(new Vector2(Math.max(1e-4, r), -length * t));
  }
  for (let i = 0; i <= cap; i++) {
    const a = Math.PI / 2 - (i / cap) * (Math.PI / 2);
    pts.push(new Vector2(Math.max(1e-4, rTop * Math.sin(a)), rTop * Math.cos(a)));
  }
  // Điểm trùng giữa các đoạn làm lathe có mặt suy biến: bỏ những điểm gần như trùng nhau.
  const clean: Vector2[] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (!last || last.distanceToSquared(p) > 1e-10) clean.push(p);
  }
  return new LatheGeometry(clean, segments);
}

/** Một mặt cắt ngang của thân: elip bán trục `rx` (ngang), `rzF` (trước), `rzB` (sau), tâm lệch `cx`, `cz`, ở độ cao `y`. */
export interface TorsoSection {
  y: number;
  rx: number;
  rzF: number;
  rzB: number;
  cx?: number;
  cz?: number;
  /** Độ vuông của mặt cắt: 2 = elip, lớn hơn = vuông hơn (vai, hông). */
  n?: number;
}

/** Điểm trên mặt cắt tại góc `a` (0 = thẳng ra trước +Z, tăng dần về phía +X). */
export function torsoPoint(s: TorsoSection, a: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const sn = Math.sin(a);
  const cs = Math.cos(a);
  const e = 2 / (s.n ?? 2);
  out.x = (s.cx ?? 0) + s.rx * Math.sign(sn) * Math.abs(sn) ** e;
  out.y = s.y;
  out.z = (s.cz ?? 0) + (cs >= 0 ? s.rzF : s.rzB) * Math.sign(cs) * Math.abs(cs) ** e;
  return out;
}

/**
 * Nội suy trơn các thuộc tính của mặt cắt theo độ cao y (Hermite với độ dốc lấy từ hai mặt cắt lân cận, nên mặt thân liên tục cả đạo hàm:
 * không có "bậc thang" có độ dốc bằng không ở mỗi mặt cắt, vốn làm pháp tuyến dao động thành các dải sáng tối).
 */
export function torsoAt(sections: readonly TorsoSection[], y: number): TorsoSection {
  const n = sections.length;
  if (y <= sections[0]!.y) return sections[0]!;
  if (y >= sections[n - 1]!.y) return sections[n - 1]!;
  let i = 0;
  while (i < n - 2 && y > sections[i + 1]!.y) i++;
  const a = sections[i]!;
  const b = sections[i + 1]!;
  const prev = sections[Math.max(0, i - 1)]!;
  const next = sections[Math.min(n - 1, i + 2)]!;
  const h = b.y - a.y;
  const u = (y - a.y) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const hermite = (get: (s: TorsoSection) => number) => {
    const m1 = ((get(b) - get(prev)) / (b.y - prev.y || 1)) * h;
    const m2 = ((get(next) - get(a)) / (next.y - a.y || 1)) * h;
    return h00 * get(a) + h10 * m1 + h01 * get(b) + h11 * m2;
  };
  return {
    y,
    rx: hermite((s) => s.rx),
    rzF: hermite((s) => s.rzF),
    rzB: hermite((s) => s.rzB),
    cx: hermite((s) => s.cx ?? 0),
    cz: hermite((s) => s.cz ?? 0),
    n: hermite((s) => s.n ?? 2),
  };
}

/**
 * Thân dựng bằng cách nối các mặt cắt elip theo độ cao (không phải ống tròn dẹt): vai, ngực, bụng, hông có bề ngang và độ dày riêng, lưng và
 * ngực khác nhau. Hai đầu được bịt. Pháp tuyến ở mối nối được ghép lại nên không có đường vạch dọc lưng.
 */
export function loftGeometry(sections: readonly TorsoSection[], segments = 44, subdiv = 3): BufferGeometry {
  // Chia nhỏ giữa các mặt cắt bằng nội suy trơn để mặt cong mượt mà không cần nhiều mặt cắt khai báo.
  const rows: TorsoSection[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    for (let k = 0; k < subdiv; k++) rows.push(torsoAt(sections, sections[i]!.y + ((sections[i + 1]!.y - sections[i]!.y) * k) / subdiv));
  }
  rows.push(sections[sections.length - 1]!);
  const pos: number[] = [];
  const uv: number[] = [];
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      torsoPoint(rows[i]!, a, p);
      pos.push(p.x, p.y, p.z);
      // v theo độ cao thật (không theo chỉ số hàng) để cỡ mắt len đều từ gấu tới cổ.
      uv.push(j / segments, (rows[i]!.y - rows[0]!.y) / (rows[rows.length - 1]!.y - rows[0]!.y));
    }
  }
  const idx: number[] = [];
  const stride = segments + 1;
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * stride + j;
      const b = a + stride;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // Bịt hai đầu bằng quạt tam giác về tâm mặt cắt.
  // Mép bịt dùng đỉnh riêng (không chung với thành thân) để mặt bịt không làm lệch pháp tuyến ở mép, nhờ đó hai nửa thân nối liền không có vạch tối.
  const cap = (row: number, flip: boolean) => {
    const s = rows[row]!;
    const c = pos.length / 3;
    pos.push(s.cx ?? 0, s.y, s.cz ?? 0);
    uv.push(0.5, row / (rows.length - 1));
    const ring = pos.length / 3;
    for (let j = 0; j <= segments; j++) {
      const a = row * stride + j;
      pos.push(pos[a * 3]!, pos[a * 3 + 1]!, pos[a * 3 + 2]!);
      uv.push(j / segments, row / (rows.length - 1));
    }
    for (let j = 0; j < segments; j++) {
      if (flip) idx.push(c, ring + j + 1, ring + j);
      else idx.push(c, ring + j, ring + j + 1);
    }
  };
  cap(0, true);
  cap(rows.length - 1, false);

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nor = g.getAttribute("normal");
  // Hai hàng ngoài cùng: pháp tuyến nằm ngang (theo mặt cắt, bỏ độ dốc) để hai nửa thân dùng chung mặt cắt ở chỗ nối có cùng pháp tuyến, không có vạch đổi tông.
  for (const row of [0, rows.length - 1]) {
    const s = rows[row]!;
    const n = s.n ?? 2;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      torsoPoint(s, a, p);
      const dx = p.x - (s.cx ?? 0);
      const dz = p.z - (s.cz ?? 0);
      const rz = dz >= 0 ? s.rzF : s.rzB;
      const gx = (Math.sign(dx) * Math.abs(dx / s.rx) ** (n - 1)) / s.rx;
      const gz = (Math.sign(dz) * Math.abs(dz / rz) ** (n - 1)) / rz;
      const l = Math.hypot(gx, gz) || 1;
      nor.setXYZ(row * stride + j, gx / l, 0, gz / l);
    }
  }
  // Mối nối dọc (j = 0 và j = segments cùng một điểm): lấy trung bình pháp tuyến.
  for (let i = 0; i < rows.length; i++) {
    const a = i * stride;
    const b = a + segments;
    const x = nor.getX(a) + nor.getX(b);
    const y = nor.getY(a) + nor.getY(b);
    const z = nor.getZ(a) + nor.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / l, y / l, z / l);
    nor.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

/**
 * Dải mỏng nằm sát mặt thân, đi dọc từ `y0` tới `y1` ở góc `a0 ± halfAngle` (viền cài khuy, cổ áo). Nâng lên `lift` theo pháp tuyến xấp xỉ
 * (hướng ra từ trục) để không bị mặt thân che hay xuyên qua.
 */
export function torsoStripGeometry(sections: readonly TorsoSection[], y0: number, y1: number, a0: number, halfAngle: number, lift: number, rows = 24, cols = 4): BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const p = { x: 0, y: 0, z: 0 };
  for (let i = 0; i <= rows; i++) {
    const y = y0 + ((y1 - y0) * i) / rows;
    const s = torsoAt(sections, y);
    for (let j = 0; j <= cols; j++) {
      const a = a0 - halfAngle + (2 * halfAngle * j) / cols;
      torsoPoint(s, a, p);
      const dx = p.x - (s.cx ?? 0);
      const dz = p.z - (s.cz ?? 0);
      const l = Math.hypot(dx, dz) || 1;
      pos.push(p.x + (dx / l) * lift, p.y, p.z + (dz / l) * lift);
      uv.push(j / cols, i / rows);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j;
      const b = a + cols + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vị trí (x, z) của mặt trước thân tại độ cao `y` và góc `a`, để đặt khuy và thiết bị đúng trên vải. */
export function torsoSurface(sections: readonly TorsoSection[], y: number, a = 0): Vector3Like {
  const p = { x: 0, y, z: 0 };
  return torsoPoint(torsoAt(sections, y), a, p);
}
