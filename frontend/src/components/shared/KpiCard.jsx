/**
 * Single KPI tile — same look as Reports dashboard strip.
 * Used on upload page file card, processing console, etc.
 */
export default function KpiCard({
  label,
  value,
  icon: Icon,
  accent = "teal",
  className = "",
  style,
  children,
}) {
  return (
    <article
      className={`reports-kpi reports-kpi--${accent} ${className}`.trim()}
      style={style}
    >
      <div className="reports-kpi__glow" aria-hidden="true" />
      {Icon && (
        <div className="reports-kpi__icon" aria-hidden="true">
          {typeof Icon === "function" ? <Icon /> : Icon}
        </div>
      )}
      <div className="reports-kpi__content">
        {label && <div className="reports-kpi__label">{label}</div>}
        {value != null && <div className="reports-kpi__value">{value}</div>}
        {children}
      </div>
    </article>
  );
}
