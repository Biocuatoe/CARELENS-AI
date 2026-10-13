import { Link } from "react-router";
import { Badge, SoftSurface, buttonClasses } from "../../design-system/primitives";
import { HardwareScrollStory } from "../common/HardwareScrollStory";
import { useScrollMemory } from "../common/useScrollMemory";

/**
 * Trang thử nghiệm nội bộ cho cảnh cuộn "mở nắp và tách linh kiện". Chưa gắn vào landing: khi được duyệt, chỉ cần đặt
 * `<HardwareScrollStory />` vào vị trí mong muốn của landing (cảnh không phụ thuộc trang này).
 */
export function HardwareStoryPage() {
  useScrollMemory();
  return (
    <div className="min-h-dvh bg-surface text-fg">
      <a
        href="#sau-mo-phong"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-3 focus:shadow-extruded"
      >
        Bỏ qua phần mô phỏng 3D
      </a>

      <header className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-12 md:px-6 md:py-20">
        <Badge className="self-start">Bản thử nội bộ</Badge>
        <h1 className="font-display text-4xl font-extrabold tracking-tight md:text-6xl">Bên trong thiết bị CareLens</h1>
        <p className="max-w-2xl text-lg">
          Cuộn để mở nắp và xem từng linh kiện tách ra khỏi vỏ. Vỏ là hai file STL của dự án; mọi linh kiện bên trong là mô hình tham chiếu hoặc dựng
          bằng code theo kích thước điển hình, chưa phải phần cứng thật.
        </p>
      </header>

      <HardwareScrollStory />

      <footer className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-16 md:px-6">
        <SoftSurface className="flex flex-col gap-4">
          <h2 className="font-display text-2xl font-bold">Giới hạn của mô hình</h2>
          <ul className="flex list-disc flex-col gap-2 pl-6">
            <li>Vỏ hiện chỉ có cửa sổ camera 8 × 8 mm. Chưa có lỗ cổng sạc USB-C và rãnh công tắc; hai vị trí này là đề xuất.</li>
            <li>Kích thước pin, bo camera, mạch sạc, mạch boost, cảm biến và công tắc là ước lượng. Pin dùng định dạng giả định 10 × 34 × 50 mm.</li>
            <li>Vỏ không có trụ đỡ hay rãnh giữ nên các linh kiện chưa được giữ cố định trong mô hình.</li>
          </ul>
          <Link to="/hardware-inspector" className={buttonClasses({ className: "self-start" })}>
            Mở công cụ kiểm tra từng vật thể
          </Link>
        </SoftSurface>
      </footer>
    </div>
  );
}
