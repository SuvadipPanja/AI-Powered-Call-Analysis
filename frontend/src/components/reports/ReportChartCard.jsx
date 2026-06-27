import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { LuEllipsisVertical } from "react-icons/lu";
import { Spinner } from "../ui";
import {
  chartDataToRows,
  downloadChartPdf,
  downloadChartPng,
  downloadCsv,
  downloadExcel,
  downloadBackendCsv,
  buildExportFilename,
  tableToRows,
} from "../../utils/reportExportUtils";
import "./reports-page.css";
import ReportChartCanvas from "./ReportChartCanvas";

const VARIANT_ACCENTS = {
  volume: "volume",
  quality: "quality",
  agent: "agent",
  insight: "insight",
  default: "default",
};

export default function ReportChartCard({
  title,
  subtitle,
  insight,
  loading,
  empty,
  emptyMessage = "No data for the selected filters.",
  children,
  className = "",
  variant = "default",
  icon: Icon,
  stat,
  chartRef,
  chartData,
  tableColumns,
  tableRows,
  exportSlug,
  filters,
  apiBaseUrl,
  bulkExport,
  height = 320,
  stagger = 0,
  canvasWrapper = true,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuWrapRef = useRef(null);
  const menuPortalRef = useRef(null);
  const menuBtnRef = useRef(null);
  const accent = VARIANT_ACCENTS[variant] || VARIANT_ACCENTS.default;

  const updateMenuPosition = useCallback(() => {
    const btn = menuBtnRef.current;
    const menu = menuPortalRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = menu?.offsetWidth || 200;
    const menuHeight = menu?.offsetHeight || 180;
    const gap = 8;

    let top = rect.bottom + gap;
    if (top + menuHeight > window.innerHeight - gap) {
      top = Math.max(gap, rect.top - menuHeight - gap);
    }

    const left = Math.min(
      Math.max(gap, rect.right - menuWidth),
      window.innerWidth - menuWidth - gap
    );

    setMenuPos({ top, left });
  }, []);

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    updateMenuPosition();
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return undefined;
    updateMenuPosition();
    const raf = requestAnimationFrame(updateMenuPosition);
    const close = (e) => {
      const inWrap = menuWrapRef.current?.contains(e.target);
      const inMenu = menuPortalRef.current?.contains(e.target);
      if (!inWrap && !inMenu) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [menuOpen, updateMenuPosition]);

  const baseName = buildExportFilename(exportSlug || title?.toLowerCase().replace(/\s+/g, "_"), filters?.fromDate, filters?.toDate);

  const getExportTable = () => {
    if (tableColumns?.length && tableRows?.length) {
      return tableToRows(tableColumns, tableRows);
    }
    if (chartData) return chartDataToRows(chartData);
    return { columns: [], rows: [] };
  };

  const runExport = async (action) => {
    setExporting(true);
    try {
      const { columns, rows } = getExportTable();
      if (action === "csv") {
        if (!rows.length) throw new Error("No data to export.");
        downloadCsv(baseName, columns, rows);
      } else if (action === "excel") {
        if (!rows.length) throw new Error("No data to export.");
        await downloadExcel(baseName, columns, rows);
      } else if (action === "png") {
        downloadChartPng(chartRef, baseName);
      } else if (action === "pdf-chart") {
        downloadChartPdf(chartRef, baseName, title);
      } else if (action === "bulk-csv" && bulkExport) {
        await downloadBackendCsv(apiBaseUrl, bulkExport.endpoint, bulkExport.body, baseName);
      }
      setMenuOpen(false);
    } catch (err) {
      console.error("Export failed:", err);
      alert(err.message || "Export failed. Try again after the chart loads.");
    } finally {
      setExporting(false);
    }
  };

  const showChartExports = Boolean(chartRef);
  const canvasHeight = Math.max(220, (height || 320) - 100);

  const menuItems = (
    <>
      <button type="button" role="menuitem" onClick={() => runExport("csv")} disabled={exporting}>
        Download CSV
      </button>
      <button type="button" role="menuitem" onClick={() => runExport("excel")} disabled={exporting}>
        Download Excel
      </button>
      {showChartExports && (
        <>
          <button type="button" role="menuitem" onClick={() => runExport("pdf-chart")} disabled={exporting}>
            Download chart PDF
          </button>
          <button type="button" role="menuitem" onClick={() => runExport("png")} disabled={exporting}>
            Download chart PNG
          </button>
        </>
      )}
      {bulkExport && (
        <button type="button" role="menuitem" onClick={() => runExport("bulk-csv")} disabled={exporting}>
          {bulkExport.label || "Download full dataset CSV"}
        </button>
      )}
    </>
  );

  return (
    <article
      className={`report-chart-card report-chart-card--${accent} ${menuOpen ? "report-chart-card--menu-open" : ""} ${className}`.trim()}
      style={{ animationDelay: `${stagger}s` }}
    >
      <div className="report-chart-card__accent" aria-hidden="true" />
      <div className="report-chart-card__orb" aria-hidden="true" />

      <header className="report-chart-card__head">
        <div className="report-chart-card__titles">
          <div className="report-chart-card__title-row">
            {Icon && (
              <span className="report-chart-card__icon" aria-hidden="true">
                <Icon />
              </span>
            )}
            <div>
              {subtitle && <span className="report-chart-card__eyebrow">{subtitle}</span>}
              <h3 className="report-chart-card__title">{title}</h3>
            </div>
          </div>
          {insight && <p className="report-chart-card__insight">{insight}</p>}
          {stat && <div className="report-chart-card__stat">{stat}</div>}
        </div>
        <div className="report-chart-card__menu-wrap" ref={menuWrapRef}>
          <button
            ref={menuBtnRef}
            type="button"
            className="report-chart-card__menu-btn"
            aria-label={`Export options for ${title}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={toggleMenu}
            disabled={loading || empty}
          >
            <LuEllipsisVertical />
          </button>
        </div>
      </header>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <div
          ref={menuPortalRef}
          className="report-chart-card__menu report-chart-card__menu--portal"
          role="menu"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {menuItems}
        </div>,
        document.body
      )}

      <div className="report-chart-card__body" style={{ minHeight: height }}>
        {loading ? (
          <div className="report-chart-card__state">
            <Spinner />
            <span>Loading analytics…</span>
          </div>
        ) : empty ? (
          <div className="report-chart-card__state report-chart-card__state--empty">{emptyMessage}</div>
        ) : (
          <div className={`report-chart-frame ${chartRef ? "report-chart-frame--chart" : "report-chart-frame--table"}`}>
            {chartRef && canvasWrapper ? (
              <ReportChartCanvas height={canvasHeight}>{children}</ReportChartCanvas>
            ) : (
              children
            )}
          </div>
        )}
      </div>
    </article>
  );
}
