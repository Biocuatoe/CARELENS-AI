import { Link } from "react-router";
import { Compass } from "lucide-react";
import { EmptyState } from "../design-system/feedback";
import { buttonClasses } from "../design-system/primitives";

export function NotFoundPage({ inline = false }: { inline?: boolean }) {
  const content = (
    <EmptyState icon={<Compass />} title="Không tìm thấy trang" decorative={!inline}>
      <p>Đường dẫn không tồn tại hoặc đã thay đổi.</p>
      <Link to="/people" className={buttonClasses({ className: "mt-4" })}>
        Về danh sách hồ sơ
      </Link>
    </EmptyState>
  );
  if (inline) return content;
  return <main className="flex min-h-dvh items-center justify-center bg-surface px-4">{content}</main>;
}
