import { useId, useMemo } from "react";
import { LuInfo } from "../../../icons";
import CardExportMenu from "./CardExportMenu";
import styles from "./glassCharts.module.css";

const PALETTE = {
  coll: { light: "#B9C6FF", base: "#7088F8", deep: "#4A5CE0" },
  pdm: { light: "#DCC2FF", base: "#A474F3", deep: "#7648DE" },
  other: { light: "#BDF6E2", base: "#5FD8AD", deep: "#2FAE85" },
};
const EXTRA = [
  { light: "#BFEBFF", base: "#55B8EE", deep: "#2A8BC8" },
  { light: "#FFE3A8", base: "#F2B544", deep: "#C98A1A" },
];
const MAX_BARS = 4;

const BASE_Y = 112;
const PLATFORM = { x0: 10, x1: 290 };
const DX = 9;
const DY = -7;
const MAX_H = 78;
const MIN_H = 16;

function toneFor(name, index) {
  const key = String(name || "").trim().toLowerCase();
  if (key.startsWith("coll")) return PALETTE.coll;
  if (key.startsWith("pdm")) return PALETTE.pdm;
  if (key.startsWith("other")) return PALETTE.other;
  return EXTRA[index % EXTRA.length];
}

export function campaignRows(items) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => ({
      name: String(item?.name || item?.label || "Unknown").trim() || "Unknown",
      count: Math.max(0, Number(item?.count) || 0),
      drilldownToken: item?.drilldownToken || null,
    }))
    .filter((row) => row.count > 0);
  const isOther = (row) => /^other/i.test(row.name);
  let rows = [...list.filter((r) => !isOther(r)).sort((a, b) => b.count - a.count), ...list.filter(isOther)];
  if (rows.length > MAX_BARS) {
    const rest = rows.slice(MAX_BARS - 1);
    rows = [
      ...rows.slice(0, MAX_BARS - 1),
      {
        name: "Other",
        count: rest.reduce((sum, row) => sum + row.count, 0),
        drilldownToken: rest.length === 1 ? rest[0].drilldownToken : null,
      },
    ];
  }
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    total,
    rows: rows.map((row, index) => ({
      ...row,
      tone: toneFor(row.name, index),
      percent: total ? Math.round((row.count / total) * 100) : 0,
    })),
  };
}

export default function CampaignMixCard({
  items,
  onDrilldown,
  title = "Campaign mix",
  subtitle = "AI inferred - not CRM campaign",
}) {
  const uid = useId().replace(/:/g, "");
  const { rows, total } = useMemo(() => campaignRows(items), [items]);
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const slotW = (PLATFORM.x1 - PLATFORM.x0 - 24) / Math.max(1, rows.length);
  const barW = Math.min(46, slotW * 0.5);
  const exportRows = rows.map((row) => ({ Campaign: row.name, Count: row.count, Percentage: `${row.percent}%` }));

  return (
    <article className={`campaign-mix-card ${styles.card}`}>
      <header className={styles.head}>
        <div>
          <h3 className={styles.title}>
            {title}
            <LuInfo className={styles.info} size={15} title="Drive type the AI inferred from the call. Not the CRM campaign name." aria-hidden="true" />
          </h3>
          <p className={styles.sub}>{subtitle}</p>
        </div>
        <CardExportMenu title={title} fileBase="campaign_mix" columns={["Campaign", "Count", "Percentage"]} rows={exportRows} />
      </header>
      {!total ? (
        <p className={styles.empty}>No campaign labels yet — re-run AI on older calls if needed.</p>
      ) : (
        <svg
          className={`${styles.chart} ${styles.campaignChart}`}
          viewBox="0 0 300 160"
          role="group"
          aria-label={`${title}. ${rows.map((r) => `${r.name} ${r.count} calls, ${r.percent}%`).join("; ")}`}
        >
          <defs>
            <linearGradient id={`${uid}-plate`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className={styles.plateTop} />
              <stop offset="100%" className={styles.plateBottom} />
            </linearGradient>
            <filter id={`${uid}-glow`} x="-60%" y="-200%" width="220%" height="500%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
            {rows.map((row, index) => (
              <linearGradient key={row.name} id={`${uid}-front-${index}`} x1="0" y1="0" x2="0.35" y2="1">
                <stop offset="0%" stopColor={row.tone.light} stopOpacity="0.92" />
                <stop offset="50%" stopColor={row.tone.base} stopOpacity="0.72" />
                <stop offset="100%" stopColor={row.tone.deep} stopOpacity="0.82" />
              </linearGradient>
            ))}
          </defs>
          <path
            d={`M ${PLATFORM.x0} ${BASE_Y + 6} L ${PLATFORM.x0 + 16} ${BASE_Y - 8} L ${PLATFORM.x1} ${BASE_Y - 8} L ${PLATFORM.x1 - 16} ${BASE_Y + 6} Z`}
            fill={`url(#${uid}-plate)`}
            className={styles.plate}
          />
          <path
            d={`M ${PLATFORM.x0} ${BASE_Y + 6} L ${PLATFORM.x1 - 16} ${BASE_Y + 6} L ${PLATFORM.x1 - 16} ${BASE_Y + 8.5} L ${PLATFORM.x0} ${BASE_Y + 8.5} Z`}
            className={styles.plateEdge}
          />
          {rows.map((row, index) => {
            const cx = PLATFORM.x0 + 12 + slotW * (index + 0.5);
            const h = Math.max(MIN_H, MAX_H * (row.count / maxCount));
            const x = cx - barW / 2 - DX / 2;
            const top = BASE_Y - h;
            const clickable = Boolean(onDrilldown && row.drilldownToken);
            const activate = () => onDrilldown(row);
            return (
              <g
                key={row.name}
                className={clickable ? styles.hit : undefined}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={clickable ? `View ${row.count} calls for ${row.name}` : undefined}
                onClick={clickable ? activate : undefined}
                onKeyDown={clickable ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                  }
                } : undefined}
              >
                <title>{`${row.name}: ${row.count} calls, ${row.percent}%`}</title>
                <ellipse cx={cx} cy={BASE_Y} rx={barW * 0.8} ry="5" fill={row.tone.base} className={styles.glow} filter={`url(#${uid}-glow)`} />
                <g className={styles.rise} style={{ animationDelay: `${index * 90}ms` }}>
                  <path
                    d={`M ${x + barW} ${top} L ${x + barW + DX} ${top + DY} L ${x + barW + DX} ${BASE_Y + DY} L ${x + barW} ${BASE_Y} Z`}
                    fill={row.tone.deep}
                    fillOpacity="0.7"
                    className={styles.edge}
                  />
                  <rect x={x} y={top} width={barW} height={h} fill={`url(#${uid}-front-${index})`} className={styles.edge} />
                  <rect x={x + 4} y={top + 4} width={barW - 8} height={Math.max(0, h - 8)} rx="2" fill="none" className={styles.innerEdge} />
                  <path
                    d={`M ${x} ${top} L ${x + DX} ${top + DY} L ${x + barW + DX} ${top + DY} L ${x + barW} ${top} Z`}
                    fill={row.tone.light}
                    fillOpacity="0.9"
                    className={styles.edge}
                  />
                  {h > 18 ? <rect x={x + 6} y={top + 7} width="4" height={h - 14} rx="2" fill="#fff" opacity="0.5" /> : null}
                </g>
                <text x={cx} y={top + DY - 6} textAnchor="middle" className={`${styles.barPct} ${styles.fade}`}>{`${row.percent}%`}</text>
                <text x={cx} y={BASE_Y + 28} textAnchor="middle" className={styles.barCount}>{row.count}</text>
                <text x={cx} y={BASE_Y + 42} textAnchor="middle" className={styles.barName}>{row.name}</text>
              </g>
            );
          })}
        </svg>
      )}
    </article>
  );
}
