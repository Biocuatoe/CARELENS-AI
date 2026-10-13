import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown, X } from "lucide-react";
import { cn } from "./cn";
import { SoftButton } from "./primitives";

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Không cho đóng bằng Esc/nút X khi đang gửi dữ liệu. */
  busy?: boolean;
  className?: string;
};

/**
 * Dùng <dialog> gốc: showModal() làm nền inert, giữ focus trong dialog, Esc phát sự kiện cancel.
 * Khi đóng, trả focus về phần tử đã mở dialog.
 */
function useModalDialog(open: boolean, onClose: () => void, busy?: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) {
        dialog.close();
        returnFocus.current?.focus?.();
      }
    };
  }, []);

  const onCancel = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!busy) onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!busy) onClose();
    }
  };

  return { ref, onCancel, onKeyDown };
}

export function Dialog({ open, onClose, title, description, children, footer, busy, className }: OverlayProps) {
  const { ref, onCancel, onKeyDown } = useModalDialog(open, onClose, busy);
  const titleId = useId();
  const descId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
      className={cn(
        "m-auto w-[calc(100%-2rem)] max-w-lg overflow-visible bg-transparent p-0 text-fg backdrop:bg-fg/30",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto rounded-container bg-surface p-6 shadow-extruded sm:p-8">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-xl font-bold">
                {title}
              </h2>
              {description ? (
                <div id={descId} className="mt-1 text-fg">
                  {description}
                </div>
              ) : null}
            </div>
            <SoftButton size="icon" aria-label="Đóng" onClick={onClose} disabled={busy}>
              <X className="size-5" aria-hidden />
            </SoftButton>
          </div>
          <div className="flex flex-col gap-4">{children}</div>
          {footer ? <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export function Drawer({ open, onClose, title, description, children, footer, busy, className }: OverlayProps) {
  const { ref, onCancel, onKeyDown } = useModalDialog(open, onClose, busy);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
      className={cn(
        "mt-0 mr-0 mb-0 ml-auto h-dvh max-h-dvh w-full max-w-xl overflow-visible bg-transparent p-0 text-fg backdrop:bg-fg/30",
        className,
      )}
    >
      {open ? (
        <div className="flex h-full flex-col overflow-y-auto bg-surface p-6 shadow-extruded sm:rounded-l-container sm:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 id={titleId} className="text-xl font-bold">
                {title}
              </h2>
              {description ? <div className="mt-1 text-fg">{description}</div> : null}
            </div>
            <SoftButton size="icon" aria-label="Đóng" onClick={onClose} disabled={busy}>
              <X className="size-5" aria-hidden />
            </SoftButton>
          </div>
          <div className="flex flex-1 flex-col gap-6">{children}</div>
          {footer ? <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

/* ------------------------------------------------------------------ Segmented tabs */

export type TabOption<T extends string> = { value: T; label: string };

/**
 * Nhóm lựa chọn dạng tab (raised → inset khi chọn).
 * - `semantics="radio"` (mặc định): bộ lọc đổi cùng một nội dung.
 * - `semantics="tabs"`: tab chuẩn ARIA, panel dùng `tabPanelId(idBase, value)` và `tabId(idBase, value)`.
 */
export const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`;
export const tabPanelId = (idBase: string, value: string) => `${idBase}-panel-${value}`;

export function SoftTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
  semantics = "radio",
  idBase = "tabs",
}: {
  label: string;
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  semantics?: "radio" | "tabs";
  idBase?: string;
}) {
  const isTabs = semantics === "tabs";
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number) => {
    const next = (index + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role={isTabs ? "tablist" : "radiogroup"}
      aria-label={label}
      className={cn("inline-flex max-w-full flex-wrap gap-2 p-1 sm:gap-3", className)}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role={isTabs ? "tab" : "radio"}
            id={isTabs ? tabId(idBase, option.value) : undefined}
            aria-controls={isTabs ? tabPanelId(idBase, option.value) : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(index + 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(index - 1);
              }
            }}
            className={cn(
              "min-h-11 rounded-inner px-3 text-sm font-medium text-fg transition-[box-shadow,transform] duration-300 ease-out sm:px-4",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              selected
                ? "bg-surface font-bold shadow-inset-sm"
                : "bg-surface shadow-extruded-sm hover:-translate-y-px hover:shadow-extruded",
            )}
          >
            <span className="inline-flex items-center gap-2">
              {selected ? <span aria-hidden className="size-2 rounded-full bg-accent" /> : null}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ Disclosure */

/**
 * Mục mở/đóng dùng <details>/<summary> gốc: thao tác bằng bàn phím và trình đọc màn hình sẵn có.
 * Đóng = raised nhỏ, mở = inset.
 */
export function Disclosure({
  summary,
  children,
  leading,
  className,
  headingLevel,
}: {
  summary: ReactNode;
  children: ReactNode;
  leading?: ReactNode;
  className?: string;
  headingLevel?: 3 | 4;
}) {
  const Heading = headingLevel ? (`h${headingLevel}` as const) : null;
  const label = <span className="flex-1">{summary}</span>;
  return (
    <details className={cn("group rounded-control bg-surface shadow-extruded-sm transition-shadow duration-300 ease-out open:shadow-inset-sm", className)}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-control px-4 py-3 font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        {leading}
        {Heading ? <Heading className="flex-1 font-sans text-base font-bold tracking-normal">{summary}</Heading> : label}
        <ChevronDown className="size-5 shrink-0 text-accent transition-transform duration-300 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
