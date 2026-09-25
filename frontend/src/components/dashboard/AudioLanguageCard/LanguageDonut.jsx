import { useEffect, useId, useRef, useState } from "react";
import Globe from "./Globe";
import { languageDonutPalette } from "./languageColors";
import styles from "./AudioLanguageCard.module.css";

const CX = 100;
const CY = 80;
const OUTER = 84;
const INNER = 57.5;
const TILT = 0.87;
const DEPTH_BACK = 5;
const DEPTH_FRONT = 7;
/** Hindi starts at 12 o'clock so the small languages sit on top and Marathi sits on the left. */
const START = 1.5;
/** Width of the white gap between slices, the same at the inner and outer edge. */
const GAP = 5;
const FACE_ROUND = 1.8;
/** Tiny languages stay readable; exact values are in the legend and tooltip. */
const MIN_DEG = 10;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function radOf(deg) {
  return ((deg - 90) * Math.PI) / 180;
}

function depthAt(deg) {
  const front = (Math.sin(radOf(deg)) + 1) / 2;
  return DEPTH_BACK + (DEPTH_FRONT - DEPTH_BACK) * front;
}

function insetDeg(radius) {
  return ((GAP / 2) / radius) * (180 / Math.PI);
}

function mix(hex, amount) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  const adj = (v) => {
    const next = amount < 0 ? v * (1 + amount) : v + (255 - v) * amount;
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return `#${[adj((n >> 16) & 255), adj((n >> 8) & 255), adj(n & 255)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function rim(radius, deg, drop = 0) {
  const rad = radOf(deg);
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad) * TILT + drop];
}

function walk(radius, start, end, dropFn) {
  const steps = Math.max(6, Math.ceil(Math.abs(end - start) / 2));
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const deg = start + ((end - start) * i) / steps;
    pts.push(rim(radius, deg, dropFn(deg)));
  }
  return pts;
}

const fmt = (p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;

function toPath(forward, back) {
  if (forward.length < 2 || back.length < 2) return "";
  const parts = forward.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p)}`);
  for (let i = back.length - 1; i >= 0; i -= 1) parts.push(`L ${fmt(back[i])}`);
  return `${parts.join(" ")} Z`;
}

function linePath(pts) {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${fmt(p)}`).join(" ");
}

/** Visible angle range of a slice at a given radius, after the parallel gap. */
function spanAt(slice, radius) {
  const inset = slice.gapped ? insetDeg(radius) : 0;
  const start = slice.a0 + inset;
  const end = slice.a1 - inset;
  return end - start > 0.3 ? [start, end] : null;
}

function facePath(slice, outer = OUTER, inner = INNER) {
  const o = spanAt(slice, outer);
  const i = spanAt(slice, inner);
  if (!o || !i) return "";
  return toPath(walk(outer, o[0], o[1], () => 0), walk(inner, i[0], i[1], () => 0));
}

function wallBand(slice, radius, fromT, toT) {
  const span = spanAt(slice, radius);
  if (!span) return "";
  return toPath(
    walk(radius, span[0], span[1], (deg) => depthAt(deg) * fromT),
    walk(radius, span[0], span[1], (deg) => depthAt(deg) * toT),
  );
}

function capPath(slice, atEnd) {
  const o = spanAt(slice, OUTER);
  const i = spanAt(slice, INNER);
  if (!o || !i) return "";
  const degO = atEnd ? o[1] : o[0];
  const degI = atEnd ? i[1] : i[0];
  return `M ${fmt(rim(OUTER, degO))} L ${fmt(rim(INNER, degI))} L ${fmt(rim(INNER, degI, depthAt(degI)))} L ${fmt(rim(OUTER, degO, depthAt(degO)))} Z`;
}

/** Parts of [start, end] that fall inside the window [lo, hi] (degrees, clockwise from 12). */
function clipTo(span, lo, hi) {
  if (!span) return [];
  const parts = [];
  for (let k = -1; k <= 1; k += 1) {
    const s = Math.max(span[0], lo + k * 360);
    const e = Math.min(span[1], hi + k * 360);
    if (e - s > 1) parts.push([s, e]);
  }
  return parts;
}

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}

function displayShares(rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0) || 1;
  const raw = rows.map((row) => (row.count / total) * 360);
  if (rows.length < 2) return raw;
  const small = raw.map((deg) => deg > 0 && deg < MIN_DEG);
  const need = raw.reduce((sum, deg, i) => sum + (small[i] ? MIN_DEG - deg : 0), 0);
  const roomy = raw.reduce((sum, deg, i) => sum + (small[i] ? 0 : deg), 0);
  if (!need || roomy <= need) return raw;
  return raw.map((deg, i) => (small[i] ? MIN_DEG : deg - need * (deg / roomy)));
}

function segmentsFrom(rows, progress) {
  const shares = displayShares(rows);
  const gapped = rows.length > 1;
  let cursor = START;
  return rows.map((row, index) => {
    const drawn = shares[index] * (progress[index] ?? 1);
    const a0 = cursor;
    const a1 = cursor + (gapped ? drawn : Math.min(drawn, 359.9));
    cursor += shares[index];
    return {
      ...row,
      index,
      a0,
      a1,
      gapped,
      depthRank: Math.sin(radOf((a0 + a1) / 2)),
    };
  }).filter((slice) => slice.a1 - slice.a0 > 0.3);
}

export default function LanguageDonut({ rows }) {
  const uid = useId().replace(/:/g, "");
  const wrapRef = useRef(null);
  const [progress, setProgress] = useState(() => rows.map(() => (prefersReducedMotion() ? 1 : 0)));
  const [hover, setHover] = useState(null);

  useEffect(() => {
    let frame = 0;
    if (prefersReducedMotion()) {
      setProgress(rows.map(() => 1));
      return undefined;
    }
    const started = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - started) / 1100);
      setProgress(rows.map((_, index) => {
        const delay = index * 0.06;
        const local = Math.min(1, Math.max(0, (t - delay) / Math.max(0.2, 1 - delay)));
        return easeOut(local);
      }));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [rows]);

  const slices = segmentsFrom(rows, progress).slice().sort((a, b) => a.depthRank - b.depthRank);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const summary = rows.map((row) => `${row.name} ${row.count} calls, ${row.percent}%`).join("; ");
  const faceTop = CY - OUTER * TILT;
  const faceBottom = CY + OUTER * TILT;

  const showTip = (slice, event) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({
      name: slice.name,
      count: slice.count,
      percent: slice.percent,
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  };

  return (
    <div className={styles.donutWrap} ref={wrapRef}>
      <svg
        className={styles.donut}
        viewBox="0 0 200 170"
        role="img"
        aria-label={`Language mix, ${total} calls. ${summary}`}
      >
        <defs>
          <filter id={`${uid}-soft`} x="-40%" y="-80%" width="180%" height="260%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id={`${uid}-contact`} x="-20%" y="-150%" width="140%" height="400%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
          <radialGradient id={`${uid}-hole`} cx="50%" cy="72%" r="60%">
            <stop offset="0%" className={styles.holeStopTop} />
            <stop offset="100%" className={styles.holeStopEdge} />
          </radialGradient>
          {rows.map((row, index) => {
            const tone = languageDonutPalette(row.name);
            return (
              <linearGradient
                key={row.name}
                id={`${uid}-face-${index}`}
                gradientUnits="userSpaceOnUse"
                x1={CX + OUTER * 0.6}
                y1={faceTop}
                x2={CX - OUTER * 0.7}
                y2={faceBottom}
              >
                <stop offset="0%" stopColor={tone.face} />
                <stop offset="50%" stopColor={tone.face} />
                <stop offset="100%" stopColor={tone.deep} />
              </linearGradient>
            );
          })}
        </defs>
        <ellipse
          cx={CX}
          cy={faceBottom + DEPTH_FRONT - 2}
          rx={OUTER * 0.84}
          ry="4"
          className={styles.donutShadow}
          filter={`url(#${uid}-contact)`}
        />
        <ellipse cx={CX} cy={CY} rx={INNER} ry={INNER * TILT} fill={`url(#${uid}-hole)`} />
        {slices.map((slice) => {
          const tone = languageDonutPalette(slice.name);
          const face = `url(#${uid}-face-${slice.index})`;
          const outerSpan = spanAt(slice, OUTER);
          const innerSpan = spanAt(slice, INNER);
          return (
            <g
              key={`${slice.name}-body`}
              className={styles.segment}
              onMouseEnter={(event) => showTip(slice, event)}
              onMouseMove={(event) => showTip(slice, event)}
              onMouseLeave={() => setHover(null)}
            >
              <path d={wallBand(slice, OUTER, 0, 0.5)} fill={mix(tone.wall, 0.1)} />
              <path d={wallBand(slice, OUTER, 0.5, 1)} fill={tone.wall} />
              <path d={wallBand(slice, INNER, 0, 1)} fill={mix(tone.wall, -0.18)} />
              {slice.gapped ? <path d={capPath(slice, false)} fill={mix(tone.wall, 0.2)} /> : null}
              {slice.gapped ? <path d={capPath(slice, true)} fill={mix(tone.wall, 0.05)} /> : null}
              <path
                d={facePath(slice)}
                fill={face}
                stroke={face}
                strokeWidth={FACE_ROUND}
                strokeLinejoin="round"
              />
              {clipTo(outerSpan, -70, 70).map(([s, e]) => (
                <path
                  key={`band-${s.toFixed(1)}`}
                  d={toPath(walk(OUTER - 1.5, s, e, () => 0), walk(OUTER - 8, s, e, () => 0))}
                  fill={tone.light}
                  opacity="0.55"
                  pointerEvents="none"
                />
              ))}
              {clipTo(outerSpan, -70, 70).map(([s, e]) => (
                <path key={`hi-${s.toFixed(1)}`} d={linePath(walk(OUTER - 1.2, s, e, () => 0))} className={styles.rimLight} />
              ))}
              {clipTo(innerSpan, 100, 200).map(([s, e]) => (
                <path
                  key={`glow-${s.toFixed(1)}`}
                  d={toPath(walk(INNER + 1, s, e, () => 0), walk(INNER + 7, s, e, () => 0))}
                  className={styles.innerGlow}
                />
              ))}
              {clipTo(innerSpan, 40, 250).map(([s, e]) => (
                <path key={`lo-${s.toFixed(1)}`} d={linePath(walk(INNER + 1.2, s, e, () => 0))} className={styles.innerLight} />
              ))}
              {clipTo(outerSpan, 100, 260).map(([s, e]) => (
                <path key={`edge-${s.toFixed(1)}`} d={linePath(walk(OUTER, s, e, () => 0.4))} className={styles.edgeLight} />
              ))}
            </g>
          );
        })}
        <Globe cx={CX} cy={CY + 2} r={36} uid={uid} />
      </svg>
      {hover && hover.name && (
        <div className={styles.tip} style={{ left: hover.x, top: hover.y }} role="tooltip">
          <strong>{hover.name}</strong>
          <span>{hover.count} calls</span>
          <span>{hover.percent}%</span>
        </div>
      )}
    </div>
  );
}
