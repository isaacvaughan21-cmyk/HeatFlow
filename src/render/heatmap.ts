// ── Temperature → color. The game's signature visual. ──────────────────────
const STOPS: [number, [number, number, number]][] = [
  [-25, [70, 110, 220]],   // sub-ambient: electric blue
  [15, [46, 84, 140]],     // cool blue-slate
  [60, [40, 140, 150]],    // teal
  [150, [220, 190, 60]],   // yellow
  [300, [235, 130, 40]],   // orange
  [550, [225, 60, 40]],    // red
  [900, [255, 240, 230]],  // white-hot
];

const cache = new Map<number, string>();

export function tempColor(tempC: number): string {
  const key = Math.round(tempC);
  const hit = cache.get(key);
  if (hit) return hit;
  let rgb: [number, number, number];
  if (key <= STOPS[0][0]) rgb = STOPS[0][1];
  else if (key >= STOPS[STOPS.length - 1][0]) rgb = STOPS[STOPS.length - 1][1];
  else {
    let i = 0;
    while (STOPS[i + 1][0] < key) i++;
    const [t0, c0] = STOPS[i];
    const [t1, c1] = STOPS[i + 1];
    const f = (key - t0) / (t1 - t0);
    rgb = [
      Math.round(c0[0] + (c1[0] - c0[0]) * f),
      Math.round(c0[1] + (c1[1] - c0[1]) * f),
      Math.round(c0[2] + (c1[2] - c0[2]) * f),
    ];
  }
  const s = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  cache.set(key, s);
  return s;
}

/** 0..1 how "hot" for glow effects */
export function heatIntensity(tempC: number): number {
  if (tempC <= 40) return 0;
  return Math.min(1, (tempC - 40) / 500);
}
