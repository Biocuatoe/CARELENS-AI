import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Check, LoaderCircle, TriangleAlert } from "lucide-react";
import { cn } from "./cn";

/* ------------------------------------------------------------------ Surface */

export type Depth = "raised" | "raisedSm" | "inset" | "insetDeep" | "insetSm" | "flat";

const depthClass: Record<Depth, string> = {
  raised: "shadow-extruded",
  raisedSm: "shadow-extruded-sm",
  inset: "shadow-inset",
  insetDeep: "shadow-inset-deep",
  insetSm: "shadow-inset-sm",
  flat: "",
};

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "aside" | "header" | "nav" | "li" | "ul" | "form";
  depth?: Depth;
  radius?: "container" | "control" | "inner" | "full";
  padding?: "none" | "sm" | "md" | "lg";
};

const radiusClass = {
  container: "rounded-container",
  control: "rounded-control",
  inner: "rounded-inner",
  full: "rounded-full",
};

const paddingClass = { none: "", sm: "p-4", md: "p-4 sm:p-7 lg:p-8", lg: "p-6 sm:p-9 md:p-12" };

/** Bề mặt Neumorphism. Mặc định: panel raised 32px, padding 32px (SYSTEM_UI_PROMPT). */
export function SoftSurface({
  as: Tag = "div",
  depth = "raised",
  radius = "container",
  padding = "md",
  className,
  ...rest
}: SurfaceProps) {
  return (
    <Tag
      className={cn(
        "bg-surface",
        depthClass[depth],
        radiusClass[radius],
        paddingClass[padding],
        className,
      )}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ Button */

export type ButtonVariant = "primary" | "secondary";
export type ButtonSize = "md" | "sm" | "icon";

export function buttonClasses({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-control font-medium select-none",
    "transition-[transform,box-shadow] duration-300 ease-out",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    "disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    size === "md" && "min-h-12 px-6 text-base",
    size === "sm" && "min-h-11 px-4 text-sm",
    size === "icon" && "size-12 shrink-0",
    variant === "primary" &&
      "bg-accent-strong font-bold text-white shadow-extruded enabled:hover:-translate-y-px enabled:hover:shadow-extruded-hover enabled:active:translate-y-[0.5px] enabled:active:shadow-accent-pressed",
    variant === "secondary" &&
      "bg-surface text-fg shadow-extruded-sm enabled:hover:-translate-y-px enabled:hover:shadow-extruded enabled:active:translate-y-[0.5px] enabled:active:shadow-inset-sm",
    className,
  );
}

type SoftButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export const SoftButton = forwardRef<HTMLButtonElement, SoftButtonProps>(function SoftButton(
  { variant, size, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------ Icon well */

export function IconWell({
  children,
  size = "md",
  depth = "insetDeep",
  className,
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  depth?: "inset" | "insetDeep" | "insetSm";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-surface text-accent",
        depthClass[depth],
        size === "sm" && "size-10 rounded-inner [&_svg]:size-5",
        size === "md" && "size-12 rounded-control [&_svg]:size-6",
        size === "lg" && "size-16 rounded-control [&_svg]:size-7",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ Fields */

const fieldControl =
  "w-full rounded-control bg-surface px-4 text-base text-fg shadow-inset transition-shadow duration-300 ease-out " +
  "focus:shadow-inset-deep focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
  "disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:outline-2 aria-invalid:outline-fg";

type FieldFrameProps = {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
};

function FieldFrame({ id, label, hint, error, required, children, className }: FieldFrameProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="font-medium text-fg">
        {label}
        {required ? <span className="sr-only"> (bắt buộc)</span> : null}
        {required ? (
          <span aria-hidden className="ml-1 font-bold">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-fg">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="flex items-center gap-1.5 text-sm font-bold text-fg">
          <TriangleAlert className="size-4 shrink-0 text-accent" aria-hidden />
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

type InsetFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  trailing?: ReactNode;
  wrapperClassName?: string;
};

export const InsetField = forwardRef<HTMLInputElement, InsetFieldProps>(function InsetField(
  { label, hint, error, trailing, id, className, wrapperClassName, required, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          aria-required={required || undefined}
          className={cn(fieldControl, "min-h-12", trailing ? "pr-14" : "", className)}
          {...rest}
        />
        {trailing ? <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div> : null}
      </div>
    </FieldFrame>
  );
});

type InsetTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
};

export const InsetTextarea = forwardRef<HTMLTextAreaElement, InsetTextareaProps>(
  function InsetTextarea({ label, hint, error, id, className, wrapperClassName, required, ...rest }, ref) {
    const autoId = useId();
    const fieldId = id ?? autoId;
    return (
      <FieldFrame
        id={fieldId}
        label={label}
        hint={hint}
        error={error}
        required={required}
        className={wrapperClassName}
      >
        <textarea
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(fieldId, hint, error)}
          aria-required={required || undefined}
          className={cn(fieldControl, "min-h-28 py-3", className)}
          {...rest}
        />
      </FieldFrame>
    );
  },
);

type InsetSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  wrapperClassName?: string;
};

export const InsetSelect = forwardRef<HTMLSelectElement, InsetSelectProps>(function InsetSelect(
  { label, hint, error, id, className, wrapperClassName, required, children, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldFrame
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <select
        ref={ref}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        aria-required={required || undefined}
        className={cn(fieldControl, "min-h-12 appearance-none pr-10", className)}
        style={{
          backgroundImage:
            "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
          backgroundPosition: "calc(100% - 22px) 50%, calc(100% - 16px) 50%",
          backgroundSize: "6px 6px, 6px 6px",
          backgroundRepeat: "no-repeat",
        }}
        {...rest}
      >
        {children}
      </select>
    </FieldFrame>
  );
});

/* ------------------------------------------------------------------ Choice (checkbox / radio) */

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type?: "checkbox" | "radio";
  label: ReactNode;
  description?: ReactNode;
};

export const Choice = forwardRef<HTMLInputElement, ChoiceProps>(function Choice(
  { type = "checkbox", label, description, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "flex min-h-12 cursor-pointer items-start gap-3 rounded-control bg-surface p-3 shadow-extruded-sm transition-shadow duration-300 ease-out",
        "has-[:checked]:shadow-inset-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        className,
      )}
    >
      <input ref={ref} id={inputId} type={type} className="peer sr-only" {...rest} />
      <span
        aria-hidden
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center bg-surface shadow-inset-sm",
          type === "radio" ? "rounded-full" : "rounded-inner",
          "peer-checked:[&>*]:scale-100",
        )}
      >
        {type === "radio" ? (
          <span className="size-3 scale-0 rounded-full bg-accent transition-transform duration-300 ease-out" />
        ) : (
          <Check className="size-4 scale-0 text-accent transition-transform duration-300 ease-out" strokeWidth={3} />
        )}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-fg">{label}</span>
        {description ? <span className="text-sm text-fg">{description}</span> : null}
      </span>
    </label>
  );
});

/* ------------------------------------------------------------------ Misc */

export function Badge({
  children,
  icon,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full bg-surface px-3 text-sm font-medium text-fg shadow-inset-sm [&_svg]:size-4",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
