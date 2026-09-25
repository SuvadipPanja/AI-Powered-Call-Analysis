import { useId } from "react";
import styles from "./AuditCoverageCard.module.css";

const CX = 80;
const CY = 74;
const R = 58;

/** Upper semicircle. Dash length is the real score, so 74.1 fills 74.1% of the arch. */
export default function AuditGauge({ score, variant }) {
  const uid = useId().replace(/:/g, "");
  const length = Math.PI * R;
  const portion = score == null ? 0 : Math.min(100, Math.max(0, score)) / 100;
  const dash = `${(length * portion).toFixed(2)} ${length.toFixed(2)}`;
  const track = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  const colors = variant === "manual"
    ? ["#F3D7A2", "#E2B15A", "#C9923A"]
    : ["#7ED9C3", "#7DCCE8", "#6EB6E6"];

  return (
    <svg className={styles.gauge} viewBox="0 0 160 88" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={colors[2]} />
          <stop offset="50%" stopColor={colors[1]} />
          <stop offset="100%" stopColor={colors[0]} />
        </linearGradient>
      </defs>
      <path
        d={track}
        className={score == null && variant === "manual" ? styles.gaugeTrackManual : styles.gaugeTrack}
        transform="translate(0 5)"
      />
      <path
        d={track}
        className={score == null && variant === "manual" ? styles.gaugeTrackManual : styles.gaugeTrack}
      />
      {portion > 0 && (
        <path
          d={track}
          className={`${styles.gaugeValue} audit-gauge__value`}
          data-variant={variant}
          stroke={`url(#${uid}-fill)`}
          strokeDasharray={dash}
        />
      )}
      {portion > 0 && (
        <path d={track} className={styles.gaugeShine} strokeDasharray={dash} />
      )}
    </svg>
  );
}
