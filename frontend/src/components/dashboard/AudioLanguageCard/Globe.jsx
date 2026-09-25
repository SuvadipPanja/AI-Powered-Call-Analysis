import styles from "./AudioLanguageCard.module.css";

/** View centre of the globe: the Americas face the viewer, West Africa on the right limb. */
const LON0 = (-72 * Math.PI) / 180;
const LAT0 = (16 * Math.PI) / 180;

/** Simplified coastlines as [longitude, latitude]. */
const LAND = [
  [[-166, 68], [-163, 71], [-156, 71.3], [-145, 70], [-135, 69], [-128, 70], [-117, 69], [-108, 68.5], [-98, 68],
    [-94, 71], [-86, 69], [-82, 66], [-78, 62.5], [-72, 61], [-65, 60], [-61, 56], [-56, 52], [-59, 48], [-65, 49],
    [-64, 45], [-67, 44.5], [-70, 42], [-74, 40.5], [-76, 37], [-76, 35], [-79, 33.5], [-81, 31.5], [-80.5, 28],
    [-80, 25.5], [-81.5, 25.5], [-82.7, 28], [-84, 30], [-86, 30.4], [-89.5, 30], [-90, 29], [-94, 29.5], [-97, 27.8],
    [-97.5, 25], [-97.7, 22], [-96, 19.5], [-94.5, 18.3], [-91, 18.7], [-90.5, 21], [-87, 21.5], [-87.5, 18.5],
    [-88.3, 16], [-86, 15.8], [-83.3, 15], [-83.7, 11], [-82, 9], [-79.5, 9.5], [-77.8, 8.2], [-80, 7.3], [-83, 8.2],
    [-85.7, 10], [-87.5, 13], [-91.5, 14], [-94.5, 16], [-97, 15.8], [-101, 17.5], [-105.5, 20], [-105.5, 23],
    [-109, 25.5], [-112, 29], [-114.8, 31.7], [-114, 29], [-111.5, 25], [-110, 23], [-112.5, 26.5], [-115, 29.5],
    [-117, 32.5], [-120.5, 34.5], [-122.5, 37.5], [-124, 40.5], [-124.2, 46], [-124.7, 48.4], [-127.5, 50.5],
    [-130.5, 54.5], [-134, 58], [-139.5, 59.8], [-146, 60.8], [-152, 59.5], [-154, 57.5], [-158, 56.5], [-162, 55],
    [-158, 58.5], [-162, 60], [-165, 62.5], [-164.5, 65.5]],
  [[-80, 73.5], [-72, 71.5], [-67, 69], [-62, 66.5], [-64, 63], [-68, 62.5], [-73, 64.5], [-78, 65], [-77, 68],
    [-85, 70], [-89, 72.5]],
  [[-73, 78], [-66, 81.5], [-50, 82.5], [-30, 83.5], [-20, 81.5], [-18, 77], [-20, 72], [-22, 70], [-26, 68],
    [-33, 67], [-40, 65], [-43, 60], [-48, 61], [-51, 64], [-53.5, 67], [-54, 70], [-57, 74], [-65, 76.5]],
  [[-85, 21.8], [-82, 23.2], [-77.5, 22.6], [-74.2, 20.2], [-77.5, 19.9], [-80, 21.5]],
  [[-74.4, 19.8], [-70, 19.8], [-68.4, 18.5], [-71.5, 17.7], [-74.4, 18.3]],
  [[-77.5, 8.3], [-75.5, 10.5], [-71.5, 12.4], [-68, 10.5], [-62, 10.6], [-60, 8.5], [-57, 6], [-52, 4.5], [-50, 1.8],
    [-48.5, -1], [-44.5, -2.5], [-40, -2.8], [-35, -5.5], [-34.8, -8], [-37, -12], [-39, -17.5], [-40.5, -22],
    [-44.5, -23.3], [-48.5, -26.5], [-48.7, -28.5], [-52.5, -33.5], [-55, -35], [-57.5, -35.5], [-57, -38.5],
    [-62, -39], [-65, -41.5], [-64.5, -43], [-67.5, -46.5], [-66, -47.5], [-69, -51], [-68.5, -52.5], [-71, -54],
    [-74.5, -52.5], [-75.5, -48], [-74, -44], [-73.5, -40], [-73.3, -37], [-71.5, -32], [-71.3, -28], [-70.3, -23],
    [-70.2, -18.3], [-72, -17], [-76, -14], [-77, -12], [-79.3, -7.5], [-81.2, -5.5], [-80.2, -3.2], [-80.5, -0.5],
    [-79.8, 1.5], [-78.8, 1.8], [-77.2, 4], [-77.5, 6.5]],
  [[-17.5, 14.7], [-17, 21], [-16, 24], [-13, 27.8], [-9.8, 29.8], [-9.7, 32.5], [-6.5, 34.2], [-5.9, 35.8], [-2, 35.2],
    [3, 36.8], [10, 37.2], [11, 33], [15, 32], [15, 20], [15, 5], [9.5, 4], [6, 4.3], [2, 6.3], [-2, 4.8], [-7.5, 4.4],
    [-11.5, 6.8], [-13.5, 9.5], [-15.2, 11], [-16.8, 12.5]],
  [[-9, 37], [-8.9, 42.9], [-8, 43.7], [-1.8, 43.4], [-1.3, 46], [-2.5, 47.5], [-4.7, 48.5], [-1.5, 49.7], [2, 51],
    [4.5, 53], [8.5, 54], [9, 57], [12, 56], [14, 54.5], [14, 44], [12.5, 44], [8.5, 44.3], [3.2, 43.2], [3.2, 42],
    [0.8, 41], [-0.5, 38.8], [-2.1, 36.7], [-5.4, 36.1], [-7.4, 37.2]],
  [[-5.7, 50], [1.4, 51.2], [1.7, 52.7], [0, 53.5], [-1.6, 55.6], [-2, 57.5], [-4, 58.6], [-6.2, 56.5], [-5, 55],
    [-3, 54], [-4.6, 53.3], [-4.2, 52], [-5.3, 51.7]],
  [[-10, 51.6], [-6, 52], [-6, 54], [-8, 55.2], [-10.2, 54]],
];

const WATER = [
  [[-94.5, 59], [-92.5, 57], [-88, 56], [-82.5, 55], [-80, 51.5], [-79, 54.5], [-77, 58], [-78, 62], [-83, 63.5],
    [-87, 64], [-91, 63], [-94, 61]],
];

function project([lon, lat]) {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const x = Math.cos(p) * Math.sin(l - LON0);
  const y = Math.cos(LAT0) * Math.sin(p) - Math.sin(LAT0) * Math.cos(p) * Math.cos(l - LON0);
  const front = Math.sin(LAT0) * Math.sin(p) + Math.cos(LAT0) * Math.cos(p) * Math.cos(l - LON0);
  if (front >= 0) return [x, -y];
  const len = Math.hypot(x, y) || 1;
  return [x / len, -y / len];
}

function shapePath(points, r) {
  return `${points
    .map((pt, i) => {
      const [x, y] = project(pt);
      return `${i === 0 ? "M" : "L"} ${(x * r).toFixed(2)} ${(y * r).toFixed(2)}`;
    })
    .join(" ")} Z`;
}

/** Glass Earth drawn with SVG. No emoji and no bitmap. */
export default function Globe({ cx, cy, r, uid }) {
  const ocean = `${uid}-ocean`;
  const land = `${uid}-land`;
  const night = `${uid}-night`;
  const halo = `${uid}-halo`;
  const spec = `${uid}-spec`;
  const clip = `${uid}-gclip`;
  const s = r * 0.985;
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <ellipse cx="0" cy={r * 0.98} rx={r * 0.95} ry={r * 0.2} className={styles.globeShadow} filter={`url(#${uid}-soft)`} />
      <g className={styles.globeFloat}>
        <defs>
          <radialGradient id={ocean} cx="40%" cy="36%" r="70%">
            <stop offset="0%" stopColor="#5C8BDD" />
            <stop offset="40%" stopColor="#2F4C92" />
            <stop offset="80%" stopColor="#22366E" />
            <stop offset="100%" stopColor="#2A4284" />
          </radialGradient>
          <linearGradient id={land} x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="45%" stopColor="#DDEAF8" />
            <stop offset="100%" stopColor="#95ACD8" />
          </linearGradient>
          <radialGradient id={night} cx="30%" cy="26%" r="95%">
            <stop offset="45%" stopColor="#0B1636" stopOpacity="0" />
            <stop offset="100%" stopColor="#0B1636" stopOpacity="0.5" />
          </radialGradient>
          <radialGradient id={halo} cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="#7FA3F0" stopOpacity="0" />
            <stop offset="92%" stopColor="#7FA3F0" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#B4CBFA" stopOpacity="0.95" />
          </radialGradient>
          <radialGradient id={spec} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <clipPath id={clip}>
            <circle r={s} />
          </clipPath>
        </defs>
        <circle r={r} fill={`url(#${ocean})`} />
        <g clipPath={`url(#${clip})`}>
          <g fill={`url(#${land})`} stroke="#F2F7FF" strokeOpacity="0.55" strokeWidth="0.35" strokeLinejoin="round">
            {LAND.map((shape) => <path key={`${shape[0][0]}:${shape[0][1]}`} d={shapePath(shape, s)} />)}
          </g>
          <g fill="#223470">
            {WATER.map((shape) => <path key={`${shape[0][0]}:${shape[0][1]}`} d={shapePath(shape, s)} />)}
          </g>
        </g>
        <circle r={r} fill={`url(#${night})`} />
        <circle r={r} fill={`url(#${halo})`} />
        <ellipse
          cx={-r * 0.36}
          cy={-r * 0.46}
          rx={r * 0.34}
          ry={r * 0.18}
          transform={`rotate(-28 ${-r * 0.36} ${-r * 0.46})`}
          fill={`url(#${spec})`}
        />
        <path
          d={`M ${r * 0.52} ${r * 0.62} A ${r * 0.82} ${r * 0.82} 0 0 0 ${r * 0.86} ${r * 0.1}`}
          fill="none"
          stroke="#FFFFFF"
          strokeOpacity="0.3"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}
