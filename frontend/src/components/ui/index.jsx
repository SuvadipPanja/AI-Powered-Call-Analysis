import { createPortal } from "react-dom";
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

export function Modal({ open, onClose, children, maxWidth, className, flush }) {
  if (!open) return null;
  return createPortal(
    <div className="ui-modal-overlay" onClick={onClose} role="presentation">
      <div
        className={cx("ui-modal", flush && "ui-modal--flush", className)}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export function Spinner({ className }) {
  return <div className={cx("ui-spinner", className)} />;
}

export function Segmented({ options = [], value, onChange, className }) {
  return (
    <div className={cx("ui-segmented", className)} role="tablist">
      {options.map((opt) => {
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
    >
      {icon && <div className="ui-empty__icon">{icon}</div>}
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

export { default as ThemeToggle } from "./ThemeToggle";
export { default as StatCard } from "./StatCard";
export { default as PageSection } from "./PageSection";
export { default as ChartPanel } from "./ChartPanel";
export { default as FilterBar, FilterField } from "./FilterBar";
export { default as UserAvatar } from "./UserAvatar";
export { default as BrandedLoader } from "./BrandedLoader";
