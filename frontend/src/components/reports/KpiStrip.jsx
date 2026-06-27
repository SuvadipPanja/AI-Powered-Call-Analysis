import { LuTrendingDown, LuTrendingUp } from "react-icons/lu";

/**
 * Shared KPI strip — same visual system as Reports (gradient glow + icon + value).
 * Pass a `config` array to reuse on dashboard, reports, upload, etc.
 */
export default function KpiStrip({
  config = [],
  stats = {},
  comparison = {},
  formatDelta = (n, suffix = "%") => {
    const sign = Number(n) > 0 ? "+" : "";
    return `${sign}${Math.round(Number(n) * 10) / 10}${suffix}`;
  },
  gridClassName = "",
}) {
  return (
    <div className={`reports-kpi-grid app-stagger ${gridClassName}`.trim()}>
      {config.map((cfg, index) => {
        const delta = cfg.deltaKey != null ? comparison?.[cfg.deltaKey] : null;
        const isUp = (delta ?? 0) >= 0;
        const Icon = cfg.icon;
        const TrendIcon = isUp ? LuTrendingUp : LuTrendingDown;
        const value = cfg.formatValue
          ? cfg.formatValue(stats)
          : (stats[cfg.key] ?? "—");

        return (
          <article
            key={cfg.key}
            className={`reports-kpi reports-kpi--${cfg.accent}`}
            style={{ animationDelay: `${index * 0.06}s` }}
          >
            <div className="reports-kpi__glow" aria-hidden="true" />
            <div className="reports-kpi__icon" aria-hidden="true">
              {Icon && <Icon />}
            </div>
            <div className="reports-kpi__content">
              <div className="reports-kpi__label">{cfg.label}</div>
              <div className="reports-kpi__value">{value}</div>
              {cfg.showDelta && delta != null && (
                <div className={`reports-kpi__delta reports-kpi__delta--${isUp ? "up" : "down"}`}>
                  <TrendIcon aria-hidden="true" />
                  {formatDelta(delta, cfg.deltaSuffix || "%")} vs prior
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
