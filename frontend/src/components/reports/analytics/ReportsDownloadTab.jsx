import { useEffect, useState } from "react";
import { Button, Spinner } from "../../ui";
import { LuDownload, LuTriangleAlert } from "../../../icons";
import { useAuth } from "../../../context/AuthContext";
import { triggerBlobDownload } from "../../../utils/reportPreviewParse";
import { downloadOfficialQualityWorkbook, listReportCards, previewQualityWorkbook, qualityReportFilename, qualityReportQuery } from "./reportCatalog";
import { peekQualityWorkbook, qualityWorkbookCacheKey } from "../../../utils/qualityWorkbookCache";
import ReportPreviewModal from "./ReportPreviewModal";

function DownloadCard({ title, format, description, periodLabel, onPreview, busy, error }) {
  return (
    <article className="analytics-dl-card">
      <header className="analytics-dl-card__head">
        <h3>{title}</h3>
        <span className="analytics-dl-card__badge">{format}</span>
      </header>
      <p className="analytics-dl-card__desc">{description}</p>
      <p className="analytics-dl-card__period">{periodLabel}</p>
      {error && (
        <p className="analytics-dl-card__error">
          <LuTriangleAlert aria-hidden size={14} />
          <span>{error}</span>
        </p>
      )}
      <Button variant="secondary" onClick={onPreview} disabled={busy}>
        <LuDownload aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
        {busy ? "Loading…" : "Preview & download"}
      </Button>
    </article>
  );
}

function QualityWorkbookCard({
  title,
  format,
  description,
  periodLabel,
  status,
  hasBlob,
  busy,
  error,
  onDownload,
}) {
  const preparing = busy || (status === "loading" && !hasBlob);
  return (
    <article className="analytics-dl-card">
      <header className="analytics-dl-card__head">
        <h3>{title}</h3>
        <span className="analytics-dl-card__badge">{format}</span>
      </header>
      <p className="analytics-dl-card__desc">{description}</p>
      <p className="analytics-dl-card__period">{periodLabel}</p>
      {preparing && (
        <p className="analytics-dl-card__status" aria-live="polite">
          Gathering call data and building sheets…
        </p>
      )}
      {error && (
        <p className="analytics-dl-card__error">
          <LuTriangleAlert aria-hidden size={14} />
          <span>{error}</span>
        </p>
      )}
      <div className="analytics-dl-card__actions">
        <Button
          variant="primary"
          onClick={onDownload}
          disabled={preparing}
          aria-busy={preparing}
        >
          {preparing ? (
            <>
              <Spinner decorative className="analytics-dl-card__spinner" />
              Preparing workbook…
            </>
          ) : (
            <>
              <LuDownload aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Download .xlsx
            </>
          )}
        </Button>
      </div>
    </article>
  );
}

export default function ReportsDownloadTab({
  filters,
  isCollections,
  periodLabel,
  buildBulkExportBody,
}) {
  const { username } = useAuth();
  const [busyKey, setBusyKey] = useState("");
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [qualityState, setQualityState] = useState({ status: "idle", blob: null, error: "" });

  const cards = listReportCards({ isCollections });
  const qualityPrefetchKey = isCollections
    ? JSON.stringify(qualityReportQuery(filters))
    : "";

  useEffect(() => {
    if (!isCollections) return undefined;
    let cancelled = false;
    const cached = peekQualityWorkbook(qualityWorkbookCacheKey("", qualityReportQuery(filters)));
    if (cached) {
      setQualityState({ status: "ready", blob: cached, error: "" });
      return undefined;
    }
    setQualityState((prev) => ({ status: "loading", blob: prev.blob, error: "" }));
    downloadOfficialQualityWorkbook(filters, username)
      .then((result) => {
        if (!cancelled) setQualityState({ status: "ready", blob: result.blob, error: "" });
      })
      .catch((err) => {
        if (cancelled) return;
        const status = err?.status || err?.response?.status;
        setQualityState({
          status: "error",
          blob: null,
          error: status === 409
            ? "No scored calls in this period. Adjust the date range or process a call first."
            : (err?.message || "Could not prepare the official workbook."),
        });
      });
    return () => { cancelled = true; };
  }, [isCollections, qualityPrefetchKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const downloadQuality = async () => {
    setErrors((prev) => ({ ...prev, quality: "" }));
    const params = qualityReportQuery(filters);
    const filename = qualityReportFilename(params.fromDate, params.toDate);
    if (qualityState.blob) {
      triggerBlobDownload(qualityState.blob, filename);
      return;
    }
    setBusyKey("quality");
    try {
      const result = await downloadOfficialQualityWorkbook(filters, username);
      triggerBlobDownload(result.blob, result.filename);
      setQualityState({ status: "ready", blob: result.blob, error: "" });
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const message = status === 409
        ? "No scored calls in this period. Adjust the date range or process a call first."
        : (err?.message || "Could not download the official workbook.");
      setErrors((prev) => ({ ...prev, quality: message }));
      setQualityState((prev) => ({ ...prev, status: "error", error: message }));
    } finally {
      setBusyKey("");
    }
  };

  const openPreview = async (card) => {
    setErrors((prev) => ({ ...prev, [card.key]: "" }));
    if (card.instantPreview || card.key === "quality") {
      setPreview({
        key: card.key,
        title: card.title,
        slug: card.key,
        data: {
          ...previewQualityWorkbook(filters),
          rawBlob: qualityState.blob || undefined,
        },
      });
      return;
    }
    setBusyKey(card.key);
    try {
      const data = await card.fetch(filters, buildBulkExportBody);
      setPreview({
        key: card.key,
        title: card.title,
        slug: card.key,
        data,
      });
    } catch (err) {
      const status = err?.status || err?.response?.status;
      setErrors((prev) => ({
        ...prev,
        [card.key]: status === 409
          ? "No scored calls in this period. Adjust the date range or process a call first."
          : (err?.message || "Could not load this report. Please contact the administrator."),
      }));
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div className="analytics-reports-tab" data-testid="analytics-reports-tab">
      <div className="reports-section__head">
        <h2>Report center</h2>
        <p>
          The Quality workbook downloads directly as Excel. Other extracts for{" "}
          {periodLabel} can be previewed, then saved as Excel, CSV, or PDF.
        </p>
      </div>
      <div className="analytics-dl-grid">
        {cards.map((card) => (
          card.key === "quality" ? (
            <QualityWorkbookCard
              key={card.key}
              title={card.title}
              format={card.format}
              description={card.description}
              periodLabel={periodLabel}
              status={qualityState.status}
              hasBlob={Boolean(qualityState.blob)}
              busy={busyKey === "quality"}
              error={errors.quality || (qualityState.status === "error" ? qualityState.error : "")}
              onDownload={downloadQuality}
            />
          ) : (
            <DownloadCard
              key={card.key}
              title={card.title}
              format={card.format}
              description={card.description}
              periodLabel={periodLabel}
              busy={busyKey === card.key}
              error={errors[card.key]}
              onPreview={() => openPreview(card)}
            />
          )
        ))}
      </div>
      <ReportPreviewModal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.title}
        periodLabel={periodLabel}
        slug={preview?.slug}
        filters={filters}
        preview={preview?.key === "quality"
          ? { ...preview.data, rawBlob: qualityState.blob || preview.data?.rawBlob }
          : preview?.data}
        officialBlob={preview?.key === "quality" ? qualityState.blob : undefined}
        prefetchStatus={preview?.key === "quality" ? qualityState.status : undefined}
        prefetchError={preview?.key === "quality" ? qualityState.error : undefined}
        onFetchOfficial={preview?.key === "quality"
          ? () => downloadOfficialQualityWorkbook(filters, username)
          : undefined}
      />
    </div>
  );
}
