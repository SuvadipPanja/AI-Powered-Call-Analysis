const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * Horizontal filter toolbar for dashboards and list pages.
 */
export default function FilterBar({ children, className, onSubmit, onReset, submitLabel = "Apply", resetLabel = "Reset" }) {
  return (
    <div className={cx("ui-filter-bar", className)}>
      <div className="ui-filter-bar__fields">{children}</div>
      {(onSubmit || onReset) && (
        <div className="ui-filter-bar__actions">
          {onSubmit && (
            <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={onSubmit}>
              {submitLabel}
            </button>
          )}
          {onReset && (
            <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onReset}>
              {resetLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function FilterField({ label, children, className }) {
  return (
    <div className={cx("ui-filter-field", className)}>
      {label && <span className="ui-filter-field__label">{label}</span>}
      {children}
    </div>
  );
}
