import { BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial } from "three";
import type { ReportRect } from "./reportTimeline";

/**
 * Bề mặt của bản báo cáo trong cảnh 3D: hình chữ nhật bo góc, màu phẳng đúng bằng nền của khung HTML, một đường viền mảnh.
 * Hình học dựng lại từ hình chữ nhật mỗi khi đổi (vài chục đỉnh), nên bề mặt mọc ra từ dải rút gọn mà vẫn bo góc đều.
 */

const SEG = 8;
const POINTS = SEG * 4;

export interface ReportSurfaceStyle {
  fill: string;
  border: string;
}

export class ReportSurface {
  readonly group = new Group();
  private readonly fillGeo = new BufferGeometry();
  private readonly lineGeo = new BufferGeometry();
  private readonly fillMat: MeshBasicMaterial;
  private readonly lineMat: LineBasicMaterial;
  private readonly fillPos = new Float32Array((POINTS + 1) * 3);
  private readonly linePos = new Float32Array(POINTS * 3 + 3);
  private lastKey = "";

  constructor(style: ReportSurfaceStyle) {
    this.group.name = "report-surface";
    const index: number[] = [];
    for (let i = 0; i < POINTS; i++) index.push(0, 1 + i, 1 + ((i + 1) % POINTS));
    this.fillGeo.setIndex(index);
    const fillAttr = new BufferAttribute(this.fillPos, 3);
    fillAttr.setUsage(DynamicDrawUsage);
    this.fillGeo.setAttribute("position", fillAttr);
    const lineAttr = new BufferAttribute(this.linePos, 3);
    lineAttr.setUsage(DynamicDrawUsage);
    this.lineGeo.setAttribute("position", lineAttr);

    // Không chịu sương mù và tone mapping: màu trên bề mặt phải đúng màu của nền HTML thế chỗ nó. Không kiểm tra độ sâu: bề mặt luôn phủ lên căn phòng
    // (hub, quầy) dù chúng ở gần camera hơn; các lớp của gói (ô lục giác, chuỗi ký tự) có thứ tự vẽ lớn hơn nên vẫn nằm trên bề mặt.
    this.fillMat = new MeshBasicMaterial({ color: new Color(style.fill), transparent: true, opacity: 0, toneMapped: false, fog: false, depthTest: false, depthWrite: false });
    this.lineMat = new LineBasicMaterial({ color: new Color(style.border), transparent: true, opacity: 0, toneMapped: false, fog: false, depthTest: false, depthWrite: false });
    const fill = new Mesh(this.fillGeo, this.fillMat);
    fill.renderOrder = 3;
    fill.frustumCulled = false;
    const line = new Line(this.lineGeo, this.lineMat);
    line.renderOrder = 4;
    line.frustumCulled = false;
    this.group.add(fill, line);
    this.group.visible = false;
  }

  /** Đặt hình chữ nhật (m, thế giới), bán kính bo góc (m), toạ độ z và độ hiện. */
  set(rect: ReportRect, radius: number, z: number, opacity: number, lineOpacity: number): void {
    this.group.visible = opacity > 0.002;
    this.fillMat.opacity = opacity;
    this.lineMat.opacity = opacity * lineOpacity;
    if (!this.group.visible) return;
    const key = `${rect.x0}|${rect.y0}|${rect.x1}|${rect.y1}|${radius}|${z}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const r = Math.max(1e-5, Math.min(radius, (rect.x1 - rect.x0) / 2, (rect.y1 - rect.y0) / 2));
    const cx = (rect.x0 + rect.x1) / 2;
    const cy = (rect.y0 + rect.y1) / 2;
    this.fillPos[0] = cx;
    this.fillPos[1] = cy;
    this.fillPos[2] = z;
    // Bốn góc theo chiều ngược kim đồng hồ, bắt đầu từ góc trên-phải.
    const corners: Array<[number, number, number]> = [
      [rect.x1 - r, rect.y1 - r, 0],
      [rect.x0 + r, rect.y1 - r, Math.PI / 2],
      [rect.x0 + r, rect.y0 + r, Math.PI],
      [rect.x1 - r, rect.y0 + r, (3 * Math.PI) / 2],
    ];
    let n = 0;
    for (const [ox, oy, a0] of corners) {
      for (let s = 0; s < SEG; s++) {
        const a = a0 + (s / (SEG - 1)) * (Math.PI / 2);
        const x = ox + Math.cos(a) * r;
        const y = oy + Math.sin(a) * r;
        this.fillPos[3 + n * 3] = x;
        this.fillPos[4 + n * 3] = y;
        this.fillPos[5 + n * 3] = z;
        this.linePos[n * 3] = x;
        this.linePos[n * 3 + 1] = y;
        this.linePos[n * 3 + 2] = z + 0.0002;
        n++;
      }
    }
    // Đóng vòng viền.
    this.linePos[n * 3] = this.linePos[0]!;
    this.linePos[n * 3 + 1] = this.linePos[1]!;
    this.linePos[n * 3 + 2] = this.linePos[2]!;
    this.fillGeo.attributes.position!.needsUpdate = true;
    this.lineGeo.attributes.position!.needsUpdate = true;
  }

  dispose(): void {
    this.fillGeo.dispose();
    this.lineGeo.dispose();
    this.fillMat.dispose();
    this.lineMat.dispose();
    this.group.removeFromParent();
  }
}
