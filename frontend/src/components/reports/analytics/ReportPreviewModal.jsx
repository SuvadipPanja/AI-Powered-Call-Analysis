import { useEffect, useState } from "react";
import { Button, Input, Label, Modal, Segmented } from "../../ui";
import { LuDownload, LuTriangleAlert } from "../../../icons";
import { PREVIEW_ROW_LIMIT, blobToBase64, exportFilename, triggerBlobDownload } from "../../../utils/reportPreviewParse";
import { buildCsvBlob, buildExcelBlob, buildPdfBlob } from "../../../utils/reportPreviewExport";
import { protectAnalyticsExport } from "../../../services/reportsService";

const FORMATS = [
  { value: "xlsx", label: "Excel" },
  { value: "csv", label: "CSV" },
  { value: "pdf", label: "PDF" },
];

export default function ReportPreviewModal({
  open,
  onClose,
  title,
  periodLabel,
  slug,
  filters,
  preview,
  onFetchOfficial,
  prefetchStatus,
  prefetchError,
}) {
  const [format, setFormat] = useState("xlsx");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const columns = preview?.columns || [];
  const rows = preview?.rows || [];
  const previewRows = rows.slice(0, PREVIEW_ROW_LIMIT);
  const officialWorkbook = Boolean(preview?.keepOriginal);
  const formatOptions = preview?.formats?.length
    ? FORMATS.filter((item) => preview.formats.includes(item.value))
    : FORMATS;

  useEffect(() => {
    if (open && officialWorkbook) {
      setFormat("xlsx");
      setProtect(false);
      setPassword("");
    }
  }, [open, officialWorkbook]);

  const close = () => {
    setError("");
    setPassword("");
    setProtect(false);
    setFormat("xlsx");
    onClose?.();
  };

  const handleDownload = async () => {
    setError("");
    if (protect && String(password).trim().length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const base = exportFilename(slug || "report", filters?.fromDate, filters?.toDate);
      let blob;
      let filename;
      if (officialWorkbook) {
        if (preview?.rawBlob) {
          blob = preview.rawBlob;
          filename = preview.officialFilename || `${base}.xlsx`;
        } else if (onFetchOfficial) {
          const official = await onFetchOfficial();
          blob = official?.blob;
          filename = official?.filename || preview.officialFilename || `${base}.xlsx`;
        }
        if (!blob) {
          throw new Error("Could not prepare the official workbook. Please contact the administrator.");
        }
      } else if (format === "xlsx" && preview?.rawKind === "xlsx" && preview.rawBlob) {
        blob = preview.rawBlob;
        filename = preview.officialFilename || `${base}.xlsx`;
      } else if (format === "csv") {
        blob = buildCsvBlob(columns, rows);
        filename = `${base}.csv`;
      } else if (format === "pdf") {
        blob = buildPdfBlob(columns, rows, title);
        filename = `${base}.pdf`;
      } else {
        blob = await buildExcelBlob(columns, rows, title);
        filename = `${base}.xlsx`;
      }

      if (protect) {
        const payload = format === "pdf"
          ? { filename, contentBase64: await blobToBase64(blob), password: String(password) }
          : { filename, format, columns, rows, password: String(password) };
        const zipBlob = await protectAnalyticsExport(payload);
        triggerBlobDownload(zipBlob, `${base}.zip`);
      } else {
        triggerBlobDownload(blob, filename);
      }
    } catch (err) {
      setError(err?.status === 409
        ? "No collections-scored calls in this period. Adjust the date range or process a collections call first."
        : (err?.message || "Could not prepare the download. Please contact the administrator."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title={title || "Report preview"} maxWidth="56rem" className="report-preview-modal">
      <div className="report-preview">
        <header className="report-preview__head">
          <div>
            <p className="report-preview__kicker">Preview</p>
            <h2>{title}</h2>
            <p className="report-preview__meta">
              {officialWorkbook
                ? `${periodLabel}. Official formatted workbook — same ICICI HFC Excel as before. Sheets: ${(preview?.sheetNames || []).join(", ")}.${
                    prefetchStatus === "ready"
                      ? " Workbook is ready — download is instant."
                      : prefetchStatus === "loading"
                        ? " Preparing the official workbook in the background…"
                        : ""
                  }`
                : `${periodLabel}. ${rows.length} row${rows.length === 1 ? "" : "s"}${preview?.sheetNames?.length > 1 ? ` · sheets: ${preview.sheetNames.join(", ")}` : ""}. Showing the first ${Math.min(previewRows.length, PREVIEW_ROW_LIMIT)}.`}
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={close}>Close</Button>
        </header>

        <div className="report-preview__table ui-table-wrap">
          {columns.length === 0 ? (
            <p className="report-preview__empty">No rows in this range. Adjust the filters and try again.</p>
          ) : (
            <table className="ui-table" aria-label={`${title} preview`}>
              <thead>
                <tr>
                  {columns.map((col) => <th key={col}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr key={`${slug}-${idx}`}>
                    {columns.map((col) => <td key={col}>{row[col] || "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="report-preview__actions">
          <div>
            <Label>Format</Label>
            <Segmented options={formatOptions} value={format} onChange={setFormat} ariaLabel="Download format" />
          </div>
          {!officialWorkbook && (
          <label className="report-preview__protect">
            <input
              type="checkbox"
              checked={protect}
              onChange={(event) => setProtect(event.target.checked)}
            />
            Password protect the file
          </label>
          )}
          {!officialWorkbook && protect && (
            <div className="report-preview__password">
              <Label htmlFor="report-export-password">Password</Label>
              <Input
                id="report-export-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 6 characters"
              />
              <p className="report-preview__hint">
                The download is a password-protected ZIP. That password is needed to open the file.
              </p>
            </div>
          )}
        </div>

        {(error || (officialWorkbook && prefetchError && prefetchStatus === "error")) && (
          <p className="report-preview__error">
            <LuTriangleAlert aria-hidden size={14} />
            <span>{error || prefetchError}</span>
          </p>
        )}

        <div className="report-preview__footer">
          <Button variant="primary" onClick={handleDownload} disabled={busy || (!officialWorkbook && columns.length === 0)}>
            <LuDownload aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {busy ? (officialWorkbook ? "Building workbook…" : "Preparing…") : officialWorkbook ? "Download official Excel" : protect ? "Download protected ZIP" : `Download ${format.toUpperCase()}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
