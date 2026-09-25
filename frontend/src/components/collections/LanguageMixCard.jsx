import { useMemo } from "react";
import LanguageDonut from "../dashboard/AudioLanguageCard/LanguageDonut";
import { languageDotBackground } from "../dashboard/AudioLanguageCard/languageColors";
import { buildLanguageMixBreakdown } from "../../utils/languageMixData";
import styles from "../dashboard/AudioLanguageCard/AudioLanguageCard.module.css";

export default function LanguageMixCard({
  items,
  subtitle = "AUDIO LANGUAGE",
  loading = false,
  onDrilldown,
}) {
  const { rows, hasData, missing } = useMemo(() => buildLanguageMixBreakdown(items), [items]);
  const emptyMessage = missing
    ? "Language mix needs the latest backend image."
    : "No language data for this period.";

  return (
    <article className={`language-mix-card ${styles.card}`}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>{subtitle}</span>
        <h3 className={styles.title}>Language mix</h3>
      </header>
      {loading ? (
        <p className={styles.title}>Loading analytics…</p>
      ) : !hasData ? (
        <p>{emptyMessage}</p>
      ) : (
        <div className={styles.layout}>
          <LanguageDonut rows={rows} />
          <div className={styles.legend}>
            {rows.map((row) => {
              const clickable = Boolean(onDrilldown && row.drilldownToken);
              const Tag = clickable ? "button" : "div";
              return (
                <Tag
                  key={row.name}
                  type={clickable ? "button" : undefined}
                  className={clickable ? styles.rowBtn : styles.row}
                  onClick={clickable ? () => onDrilldown(row) : undefined}
                  aria-label={clickable ? `View ${row.count} calls for ${row.name}` : undefined}
                >
                  <span className={styles.dot} style={{ background: languageDotBackground(row.name) }} aria-hidden="true" />
                  <span className={styles.name}>{row.name}</span>
                  <span className={styles.count}>{row.count}</span>
                  <span className={styles.pct}>{row.percent}%</span>
                </Tag>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}
