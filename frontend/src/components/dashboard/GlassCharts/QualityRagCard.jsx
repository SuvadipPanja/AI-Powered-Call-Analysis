import { useId, useMemo } from "react";
import { LuChartPie, LuInfo } from "../../../icons";
import CardExportMenu from "./CardExportMenu";
import styles from "./glassCharts.module.css";

const TONES = {
  green: { light: "#7DDE8E", base: "#3CB85C", deep: "#1E8A3E" },
  amber: { light: "#F6D56A", base: "#E6B325", deep: "#C49212" },
  red: { light: "#F07A72", base: "#E23B32", deep: "#B4231C" },
};
const ORDER = ["green", "amber", "red"];

const CX = 78;
const CY = 78;
const OUTER = 62;
const INNER = 38;
const DEPTH = 7;

function ring(outer, inner, start, end, drop) {
  const p = (radius, deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad) + drop];
  };
  const large = end - start > 180 ? 1 : 0;
  const [x0, y0] = p(outer, start);
  const [x1, y1] = p(outer, end);
  const [x2, y2] = p(inner, end);
  const [x3, y3] = p(inner, start);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${outer} ${outer} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
}

export function sphere(tone) {
  return `radial-gradient(circle at 35% 30%, ${tone.light} 0%, ${tone.base} 58%, ${tone.deep} 100%)`;
}

export default function QualityRagCard({ bands, onDrilldown, title = "Quality grade (RAG)" }) {
  const uid = useId().replace(/:/g, "");
  const { rows, total } = useMemo(() => {
    const list = ORDER.map((key) => {
      const band = (bands || []).find((item) => item.key === key) || { key, name: key };
      return { ...band, count: Math.max(0, Number(band.count) || 0) };
    });
    const sum = list.reduce((acc, row) => acc + row.count, 0);
    return {
      total: sum,
      rows: list.map((row) => ({ ...row, percent: sum ? Math.round((row.count / sum) * 100) : 0 })),
    };
  }, [bands]);

  const gap = rows.filter((row) => row.count > 0).length > 1 ? 2.2 : 0;
  let cursor = -8;
  const slices = rows.map((row) => {
    const sweep = total ? (row.count / total) * 360 : 0;
    const start = cursor + (sweep > gap ? gap / 2 : 0);
    const end = cursor + Math.max(sweep - (sweep > gap ? gap / 2 : 0), 0);
    cursor += sweep;
    return { ...row, start, end };
  }).filter((slice) => slice.end - slice.start > 0.4);

  const exportRows = rows.map((row) => ({ Band: row.name, Count: row.count, Percentage: `${row.percent}%` }));

  return (
    <article className={`quality-rag-card ${styles.card}`}>
      <header className={styles.head}>
        <div className={styles.headMain}>
          <span className={styles.badge} aria-hidden="true"><LuChartPie size={16} /></span>
          <div>
            <p className={styles.kicker}>Share of audited calls by score band</p>
            <h3 className={`${styles.title} ${styles.titlePlain}`}>
              {title}
              <LuInfo className={styles.info} size={14} title="Red is below 80%, Amber is 80–84.99%, and Green is 85% and above." aria-hidden="true" />
            </h3>
          </div>
        </div>
        <CardExportMenu title={title} fileBase="quality_grade_rag" columns={["Band", "Count", "Percentage"]} rows={total ? exportRows : []} />
      </header>
      {!total ? (
        <p className={styles.empty}>No graded calls yet.</p>
      ) : (
        <div className={styles.ragSplit}>
          <svg className={styles.donut} viewBox="0 0 156 168" role="img" aria-label={`${title}. ${total} calls. ${rows.map((row) => `${row.name} ${row.count}, ${row.percent}%`).join("; ")}`}>
            <defs>
              {ORDER.map((key) => (
                <linearGradient key={key} id={`${uid}-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TONES[key].light} />
                  <stop offset="55%" stopColor={TONES[key].base} />
                  <stop offset="100%" stopColor={TONES[key].deep} />
                </linearGradient>
              ))}
            </defs>
            <ellipse cx={CX} cy={CY + 58} rx="46" ry="7" className={styles.donutShadow} />
            {slices.map((slice) => (
              <path key={`${slice.key}-wall`} d={ring(OUTER, INNER, slice.start, slice.end, DEPTH)} fill={TONES[slice.key].deep} />
            ))}
            {slices.map((slice) => {
              const clickable = Boolean(onDrilldown && slice.drilldownToken && slice.count);
              const activate = () => onDrilldown(slice);
              return (
                <path
                  key={slice.key}
                  d={ring(OUTER, INNER, slice.start, slice.end, 0)}
                  fill={`url(#${uid}-${slice.key})`}
                  className={clickable ? styles.hit : undefined}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable ? `View ${slice.count} calls for ${slice.name}` : undefined}
                  onClick={clickable ? activate : undefined}
                  onKeyDown={clickable ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      activate();
                    }
                  } : undefined}
                >
                  <title>{`${slice.name}: ${slice.count} calls, ${slice.percent}%`}</title>
                </path>
              );
            })}
            <circle cx={CX} cy={CY} r={INNER - 1} className={styles.donutHole} />
            <text x={CX} y={CY - 2} textAnchor="middle" className={styles.donutTotal}>{total}</text>
            <text x={CX} y={CY + 16} textAnchor="middle" className={styles.donutLabel}>TOTAL</text>
          </svg>
          <div className={styles.ragRows}>
            {rows.map((row) => {
              const clickable = Boolean(onDrilldown && row.drilldownToken && row.count);
              const Tag = clickable ? "button" : "div";
              return (
                <Tag
                  key={row.key}
                  type={clickable ? "button" : undefined}
                  className={clickable ? styles.ragRowBtn : styles.ragRow}
                  onClick={clickable ? () => onDrilldown(row) : undefined}
                  aria-label={clickable ? `View ${row.count} calls for ${row.name}` : undefined}
                >
                  <span className={styles.ragName}>
                    <span className={styles.dot} style={{ background: sphere(TONES[row.key]) }} aria-hidden="true" />
                    {row.name}
                  </span>
                  <strong className={styles.ragCount}>{row.count}</strong>
                  <span className={styles.ragTrack} aria-hidden="true">
                    <span className={styles.ragFill} style={{ width: `${row.percent}%`, background: TONES[row.key].base }} />
                  </span>
                  <em className={styles.ragPct}>{row.percent}%</em>
                </Tag>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
