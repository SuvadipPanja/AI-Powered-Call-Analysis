const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * Chart container with fixed aspect ratio and loading/empty states.
 */
export default function ChartPanel({
  title,
  subtitle,
  height = 280,
  loading,
  empty,
  emptyMessage = "No data available",
  children,
  className,
  ...rest
}) {
  return (
    <div className={cx("ui-chart-panel", className)} {...rest}>
      {(title || subtitle) && (
        <div className="ui-chart-panel__head">
          {title && <h3 className="ui-chart-panel__title">{title}</h3>}
          {subtitle && <p className="ui-chart-panel__subtitle">{subtitle}</p>}
        </div>
      )}
      <div className="ui-chart-panel__body" style={{ height }}>
        {loading ? (
          <div className="ui-chart-panel__state">
            <div className="ui-spinner" />
            <span>Loading chart…</span>
          </div>
        ) : empty ? (
          <div className="ui-chart-panel__state ui-chart-panel__state--empty">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
