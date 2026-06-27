const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * Standard content section — Reports-aligned section headers.
 */
export default function PageSection({ title, subtitle, actions, children, className, id }) {
  return (
    <section className={cx("reports-section ui-section", className)} id={id}>
      {(title || subtitle || actions) && (
        <header className="reports-section__head ui-section__head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="ui-section__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
