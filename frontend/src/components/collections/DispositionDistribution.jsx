import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  LuCheck,
  LuEllipsisVertical,
  LuFileText,
  LuHash,
  LuMessageSquare,
  LuPhone,
  LuTriangleAlert,
} from "react-icons/lu";
import "./disposition-distribution.css";

const STYLES = [
  { match: /promise\s*to\s*pay/i, color: "#16C784", Icon: LuCheck },
  { match: /call\s*back|no\s*promise/i, color: "#1597F3", Icon: LuPhone },
  { match: /ecs/i, color: "#159A96", Icon: LuFileText },
  { match: /claim\s*paid/i, color: "#4938EF", Icon: LuMessageSquare },
  { match: /will\s*not\s*clear|not\s*clear/i, color: "#F04438", Icon: LuTriangleAlert },
  { match: /wrong\s*number/i, color: "#64748B", Icon: LuHash },
];

const FALLBACK = { color: "#64748B", Icon: LuHash };

function styleFor(label) {
  return STYLES.find((entry) => entry.match.test(String(label || ""))) || FALLBACK;
}

function toRows(items) {
  const source = (Array.isArray(items) ? items : [])
    .map((item) => ({
      label: String(item?.label || item?.name || "Unknown").trim() || "Unknown",
      count: Math.max(0, Number(item?.count) || 0),
      color: item?.color,
      drilldownToken: item?.drilldownToken || null,
    }))
    .filter((item) => item.count > 0);
  const total = source.reduce((sum, item) => sum + item.count, 0);
  return {
    total,
    rows: source.map((item) => {
      const style = styleFor(item.label);
      const percentage = item.count && total
        ? (Number.isFinite(Number(item.percentage)) ? Number(item.percentage) : (item.count / total) * 100)
        : 0;
      return {
        ...item,
        color: item.color || style.color,
        Icon: style.Icon,
        percentage,
        percentLabel: `${Math.round(percentage)}%`,
      };
    }),
  };
}

function LiquidWave() {
  return (
    <svg className="disp-row__wave" viewBox="0 0 200 28" preserveAspectRatio="none" aria-hidden="true">
      <path
        fill="rgba(255,255,255,0.28)"
        d="M0 16 C12 6 38 6 50 16 C62 26 88 26 100 16 C112 6 138 6 150 16 C162 26 188 26 200 16 V28 H0 Z"
      />
      <path
        fill="rgba(255,255,255,0.2)"
        d="M0 12 C12 22 38 22 50 12 C62 2 88 2 100 12 C112 22 138 22 150 12 C162 2 188 2 200 12 V0 H0 Z"
      />
    </svg>
  );
}

function DispositionRow({ row, onSelect }) {
  const tipId = useId();
  const width = `${Math.max(0, Math.min(100, row.percentage))}%`;
  const Icon = row.Icon;
  const interactive = Boolean(onSelect && row.drilldownToken);
  const label = `${row.label}: ${row.count} calls, ${row.percentLabel}`;
  const body = (
    <>
      <span className="disp-row__icon" style={{ "--disp-color": row.color }} aria-hidden="true">
        <Icon />
      </span>
      <span className="disp-row__label">{row.label}</span>
      <span
        className="disp-row__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(row.percentage)}
        aria-valuetext={label}
        aria-label={label}
      >
        <span className="disp-row__fill-wrap" style={{ "--disp-color": row.color, "--disp-fill": width }}>
          <span className="disp-row__fill">
            <LiquidWave />
          </span>
          <span className="disp-row__dot" />
        </span>
      </span>
      <span className="disp-row__metric">
        <strong>{row.count}</strong>
        <span aria-hidden="true" />
        <em>{row.percentLabel}</em>
      </span>
      <span id={tipId} role="tooltip" className="disp-row__tip">
        {row.label}
        <br />
        {row.count} calls · {row.percentLabel}
      </span>
    </>
  );

  if (!interactive) {
    return (
      <div className="disp-row" aria-label={label} aria-describedby={tipId}>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="disp-row disp-row--button"
      aria-label={label}
      aria-describedby={tipId}
      onClick={() => onSelect(row)}
    >
      {body}
    </button>
  );
}

function ExportMenu({ rows, title }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const exportRows = () => rows.map((row) => ({
    Disposition: row.label,
    Count: row.count,
    Percentage: row.percentLabel,
  }));

  const run = async (kind) => {
    const { buildExportFilename, downloadCsv, downloadExcel } = await import("../../utils/reportExportUtils");
    const columns = ["Disposition", "Count", "Percentage"];
    const filename = buildExportFilename("disposition_distribution");
    if (kind === "excel") downloadExcel(filename, columns, exportRows());
    else downloadCsv(filename, columns, exportRows());
    setOpen(false);
  };

  return (
    <div className="disp-card__menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="disp-card__menu-btn"
        aria-label={`Export options for ${title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        disabled={rows.length === 0}
      >
        <LuEllipsisVertical />
      </button>
      {open && (
        <div className="disp-card__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => run("csv")}>Download CSV</button>
          <button type="button" role="menuitem" onClick={() => run("excel")}>Download Excel</button>
        </div>
      )}
    </div>
  );
}

export default function DispositionDistribution({
  items,
  title = "Disposition distribution",
  onSelect,
}) {
  const { rows } = useMemo(() => toRows(items), [items]);

  return (
    <article className="report-chart-card disp-card collections-dash__distribution-card" aria-label={title}>
      <header className="disp-card__head">
        <span className="disp-card__badge" aria-hidden="true">
          <LuPhone />
        </span>
        <div className="disp-card__titles">
          <h3 className="disp-card__title">{title}</h3>
        </div>
        <ExportMenu rows={rows} title={title} />
      </header>
      {rows.length === 0 ? (
        <p className="disp-card__empty">No dispositions yet — re-run AI on older calls if needed.</p>
      ) : (
        <div className="disp-card__list">
          {rows.map((row) => (
            <DispositionRow key={row.label} row={row} onSelect={onSelect} />
          ))}
        </div>
      )}
    </article>
  );
}

export { toRows, styleFor };
