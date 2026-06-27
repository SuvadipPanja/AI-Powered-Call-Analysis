const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * KPI metric tile — token-driven, supports trend delta.
 */
export default function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon,
  variant = "default",
  className,
}) {
  const trend = delta == null ? null : delta >= 0 ? "up" : "down";

  return (
    <div className={cx("ui-stat", variant !== "default" && `ui-stat--${variant}`, className)}>
      <div className="ui-stat__top">
        {icon && <span className="ui-stat__icon" aria-hidden="true">{icon}</span>}
        <span className="ui-stat__label">{label}</span>
      </div>
      <div className="ui-stat__value">{value}</div>
      {trend != null && (
        <div className={cx("ui-stat__delta", `ui-stat__delta--${trend}`)}>
          {trend === "up" ? "↑" : "↓"} {Math.abs(delta)}%
          {deltaLabel && <span className="ui-stat__delta-label">{deltaLabel}</span>}
        </div>
      )}
    </div>
  );
}
