import { useEffect, useRef, useState } from "react";
import { LuEllipsisVertical } from "react-icons/lu";
import styles from "./glassCharts.module.css";

/** Kebab menu that downloads the card rows as CSV or Excel. */
export default function CardExportMenu({ title, fileBase, columns, rows }) {
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

  const run = async (kind) => {
    const { buildExportFilename, downloadCsv, downloadExcel } = await import("../../../utils/reportExportUtils");
    const filename = buildExportFilename(fileBase);
    if (kind === "excel") downloadExcel(filename, columns, rows);
    else downloadCsv(filename, columns, rows);
    setOpen(false);
  };

  return (
    <div className={styles.menuWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.menuBtn}
        aria-label={`Export options for ${title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
        disabled={rows.length === 0}
      >
        <LuEllipsisVertical />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" role="menuitem" onClick={() => run("csv")}>Download CSV</button>
          <button type="button" role="menuitem" onClick={() => run("excel")}>Download Excel</button>
        </div>
      )}
    </div>
  );
}
