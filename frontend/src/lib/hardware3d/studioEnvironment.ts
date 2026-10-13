import { BackSide, BoxGeometry, DoubleSide, Color, Mesh, MeshBasicMaterial, PlaneGeometry, Scene, type Object3D } from "three";

/**
 * Phòng chụp sản phẩm dùng làm môi trường phản chiếu (chỉ dựng một lần qua PMREM, không vẽ ra màn hình).
 * Tường tối trung tính, một tấm softbox lớn phía trên-trước-phải, hai dải đèn dọc hai bên để tạo vệt sáng dài trên góc bo của vỏ,
 * và một tấm hắt sáng ấm, yếu phía dưới-trước. Không có màu teal ở đây: phản chiếu giữ trung tính.
 * Đơn vị tuỳ ý (PMREM chỉ dùng hướng); phòng đặt quanh gốc.
 */
export function createStudioScene(): Scene {
  const scene = new Scene();
  const geometries: Array<BoxGeometry | PlaneGeometry> = [];

  const room = new BoxGeometry(20, 14, 20);
  geometries.push(room);
  scene.add(new Mesh(room, new MeshBasicMaterial({ color: new Color(0x3b444c), side: BackSide })));

  const panel = (w: number, h: number, intensity: number, tint: number, place: (o: Object3D) => void) => {
    const geo = new PlaneGeometry(w, h);
    geometries.push(geo);
    // Màu > 1 để PMREM coi như nguồn sáng (môi trường HDR), không cần vật liệu phát sáng.
    const mat = new MeshBasicMaterial({ color: new Color(tint).multiplyScalar(intensity), side: DoubleSide });
    const m = new Mesh(geo, mat);
    place(m);
    scene.add(m);
  };

  // Softbox chính: lớn, mềm, phía trên-trước-phải, nghiêng nhìn xuống vật thể.
  panel(9, 6, 5.5, 0xfff8ee, (o) => {
    o.position.set(4, 6.4, 5);
    o.lookAt(0, 0, 0);
  });
  // Tấm phụ nhỏ trên-trước-trái: điểm sáng phản chiếu trên kính ống kính và mép bo trái, cân với softbox chính.
  panel(4, 3, 3, 0xf6f8fa, (o) => {
    o.position.set(-5, 5, 7.5);
    o.lookAt(0, 0, 0);
  });
  // Hai dải đèn dọc (strip light) hai bên, hơi lùi sau: vệt sáng hẹp trên mép bo dọc.
  panel(1.2, 10, 4.2, 0xf2f6fa, (o) => {
    o.position.set(-9.6, 1, -1.5);
    o.lookAt(0, 0, 0);
  });
  panel(1.2, 10, 3.2, 0xf2f6fa, (o) => {
    o.position.set(9.6, 1, -2.5);
    o.lookAt(0, 0, 0);
  });
  // Tấm hắt sáng ấm, yếu phía dưới-trước: mặt dưới không đen kịt.
  panel(10, 3, 0.9, 0xf2f0e9, (o) => {
    o.position.set(0, -6.8, 4);
    o.lookAt(0, 0, 0);
  });

  scene.userData.dispose = () => {
    for (const g of geometries) g.dispose();
    scene.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) (mesh.material as MeshBasicMaterial).dispose();
    });
  };
  return scene;
}
