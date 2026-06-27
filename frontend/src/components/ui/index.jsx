import { createPortal } from "react-dom";
import { useEffect, useId, useRef } from "react";
import "./ui.css";

const cx = (...parts) => parts.filter(Boolean).join(" ");

export function Button({
  variant = "primary",
  size,
  className,
  type = "button",
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={cx("ui-btn", `ui-btn--${variant}`, size && `ui-btn--${size}`, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children, style, ...rest }) {
  return (
    <div className={cx("ui-card", className)} style={style} {...rest}>
      {children}
    </div>
  );
}

export function Input({ className, ...rest }) {
  return <input className={cx("ui-input", className)} {...rest} />;
}

export function Textarea({ className, ...rest }) {
  return <textarea className={cx("ui-textarea", className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx("ui-select", className)} {...rest}>
      {children}
    </select>
  );
}

export function Label({ className, children, ...rest }) {
  return (
    <label className={cx("ui-label", className)} {...rest}>
      {children}
    </label>
  );
}

export function Badge({ variant, className, children, ...rest }) {
  return (
    <span className={cx("ui-badge", variant && `ui-badge--${variant}`, className)} {...rest}>
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, className }) {
  return (
    <div className={cx("ui-page-header", className)}>
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="ui-page-header__subtitle">{subtitle}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  children,
  maxWidth,
  className,
  flush,
  title,
  ariaLabel,
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const focusable = dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );

    (focusable[0] || dialog).focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (typeof previousFocusRef.current?.focus === "function") {
        previousFocusRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="ui-modal-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cx("ui-modal", flush && "ui-modal--flush", className)}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
      >
        {title ? <h2 id={titleId} className="ui-sr-only">{title}</h2> : null}
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Spinner({ className, label = "Loading" }) {
  return (
    <div className={cx("ui-spinner", className)} role="status" aria-label={label}>
      <span className="ui-sr-only">{label}</span>
    </div>
  );
}

export function Segmented({ options = [], value, onChange, className, ariaLabel }) {
  const onKeyDown = (event, index) => {
    const last = options.length - 1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = options[Math.min(index + 1, last)];
      const val = typeof next === "string" ? next : next.value;
      onChange?.(val);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const prev = options[Math.max(index - 1, 0)];
      const val = typeof prev === "string" ? prev : prev.value;
      onChange?.(val);
    }
  };

  return (
    <div className={cx("ui-segmented", className)} role="tablist" aria-label={ariaLabel}>
      {options.map((opt, index) => {
        const val = typeof opt === "string" ? opt : opt.value;
        const label = typeof opt === "string" ? opt : opt.label;
        return (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={value === val}
            className={cx(value === val && "is-active")}
            onClick={() => onChange && onChange(val)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function Tooltip({ label, children, className }) {
  return (
    <span className={cx("ui-tip", className)}>
      {children}
      <span className="ui-tip__bubble" role="tooltip">{label}</span>
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
  variant,
  compact,
  fill,
}) {
  return (
    <div
      className={cx(
        "ui-empty",
        compact && "ui-empty--compact",
        fill && "ui-empty--fill",
        variant === "error" && "ui-empty--error",
        className,
      )}
      role={variant === "error" ? "alert" : "status"}
      aria-live={variant === "error" ? "assertive" : "polite"}
    >
      {icon && <div className="ui-empty__icon" aria-hidden="true">{icon}</div>}
      {title && <p className="ui-empty__title">{title}</p>}
      {children && <div className="ui-empty__body">{children}</div>}
      {action}
    </div>
  );
}

export function PageLoading({
  message = "Loading…",
  inline = false,
  spinner = true,
  className,
}) {
  return (
    <div
      className={cx(
        "ui-page-loading",
        inline && "ui-page-loading--inline",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {spinner && <Spinner />}
      {message && <p className="ui-page-loading__message">{message}</p>}
    </div>
  );
}

export function PageError({
  message,
  onRetry,
  retryLabel = "Retry",
  icon,
  className,
  children,
}) {
  return (
    <div className={cx("ui-page-error", className)} role="alert">
      {icon && <div className="ui-page-error__icon">{icon}</div>}
      {message && <p className="ui-page-error__message">{message}</p>}
      {children}
      {onRetry && (
        <Button variant="primary" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className, style }) {
  return <div className={cx("app-skeleton", className)} style={style} />;
}

export function ResponsiveTableWrap({
  className,
  children,
  stack = true,
  minWidth,
  style,
  label,
  ...rest
}) {
  return (
    <div
      className={cx("ui-table-wrap", stack && "ui-table-wrap--stack", className)}
      style={{
        ...(minWidth ? { "--ui-table-min-width": minWidth } : null),
        ...style,
      }}
      role={label ? "region" : undefined}
      aria-label={label || undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SkipLink({ href = "#main-content", children = "Skip to main content" }) {
  return (
    <a href={href} className="ui-skip-link">
      {children}
    </a>
  );
}

export function VisuallyHidden({ as: Tag = "span", children, ...rest }) {
  return (
    <Tag className="ui-sr-only" {...rest}>
      {children}
    </Tag>
  );
}

export { default as ThemeToggle } from "./ThemeToggle";
export { default as StatCard } from "./StatCard";
export { default as PageSection } from "./PageSection";
export { default as ChartPanel } from "./ChartPanel";
export { default as FilterBar, FilterField } from "./FilterBar";
export { default as UserAvatar } from "./UserAvatar";
export { default as BrandedLoader } from "./BrandedLoader";
