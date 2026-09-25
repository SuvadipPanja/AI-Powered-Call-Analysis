import { useMemo } from "react";
import { LuInfo } from "../../icons";
import AuditGauge from "../dashboard/AuditCoverageCard/AuditGauge";
import { buildAuditCoverageBreakdown } from "../../utils/auditCoverageData";
import styles from "../dashboard/AuditCoverageCard/AuditCoverageCard.module.css";

const formatScore = (score) => (score == null ? "\u2014" : score.toFixed(1));

function GaugeReadout({ row, onActivate }) {
  const clickable = Boolean(onActivate && row.drilldownToken);
  const Tag = clickable ? "button" : "div";
  const waiting = row.key === "manual" && row.score == null;
  return (
    <Tag
      type={clickable ? "button" : undefined}
      className={clickable ? styles.gaugeBtn : styles.gaugeRow}
      onClick={clickable ? () => onActivate(row) : undefined}
      aria-label={clickable ? `View ${row.count} call${row.count === 1 ? "" : "s"} for ${row.name}` : undefined}
    >
      <AuditGauge score={row.score} variant={row.key === "manual" ? "manual" : "ai"} />
      <span className={styles.readout}>
        <span className={styles.readoutLabel}>{row.name}</span>
        <strong className={waiting ? styles.readoutWait : (row.key === "manual" ? styles.readoutManual : styles.readoutAi)}>
          {waiting ? "Awaiting audit" : formatScore(row.score)}
        </strong>
        {!waiting ? <span className={styles.readoutNote}>{row.countLabel}</span> : <span className={styles.readoutDash}>{formatScore(row.score)}</span>}
      </span>
    </Tag>
  );
}

export default function AiVsManualCard({ coverage, tokens, loading = false, onDrilldown }) {
  const { rows, hasData, missing } = useMemo(
    () => buildAuditCoverageBreakdown(coverage, tokens),
    [coverage, tokens],
  );
  const ai = rows[0];
  const manual = rows[1];
  const emptyMessage = missing
    ? "AI vs Manual needs the latest backend image."
    : "No audit-coverage data for this period.";

  return (
    <article className={`ai-vs-manual-card ${styles.card}`}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>
          AUDIT COVERAGE
          <LuInfo className={styles.info} size={13} title="AI score is the average of scored calls. Manual score appears after a reviewer audits a call." aria-hidden="true" />
        </span>
        <h3 className={styles.title}>AI vs Manual</h3>
      </header>
      {loading ? (
        <p>Loading analytics…</p>
      ) : !hasData || !ai || !manual ? (
        <p>{emptyMessage}</p>
      ) : (
        <div className={styles.gaugeCol}>
          <GaugeReadout row={ai} onActivate={onDrilldown} />
          <GaugeReadout row={manual} onActivate={onDrilldown} />
        </div>
      )}
    </article>
  );
}
