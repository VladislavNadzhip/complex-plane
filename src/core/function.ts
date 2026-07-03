import { C, c, cabs } from "./complex";
import { compileExpression } from "./expr";
import { FieldData, FieldOptions, Region, domainColor } from "./field";

export type FunctionDisplay = "domain" | "magnitude" | "real" | "imag" | "argument";

export interface CurveSpec {
  id: string;
  name: string;
  sample: (t: number) => C;
  tMin: number;
  tMax: number;
  samples: number;
}

export const SOURCE_CURVES: { id: string; name: string; params?: Record<string, number> }[] = [
  { id: "circle", name: "Окружность |z|=r", params: { r: 1 } },
  { id: "line_h", name: "Горизонталь Im z = b", params: { b: 0 } },
  { id: "line_v", name: "Вертикаль Re z = a", params: { a: 0 } },
  { id: "segment", name: "Отрезок [-1,1] на Re", params: {} },
];

export function curveFromSpec(id: string, params: Record<string, number> = {}): CurveSpec {
  switch (id) {
    case "circle": {
      const r = params.r ?? 1;
      const eps = 1e-4;
      return {
        id,
        name: `|z|=${r}`,
        tMin: -Math.PI + eps,
        tMax: Math.PI - eps,
        samples: 512,
        sample: (t) => c(r * Math.cos(t), r * Math.sin(t)),
      };
    }
    case "line_h": {
      const b = params.b ?? 0;
      return {
        id,
        name: `Im z=${b}`,
        tMin: -3,
        tMax: 3,
        samples: 300,
        sample: (t) => c(t, b),
      };
    }
    case "line_v": {
      const a = params.a ?? 0;
      return {
        id,
        name: `Re z=${a}`,
        tMin: -3,
        tMax: 3,
        samples: 300,
        sample: (t) => c(a, t),
      };
    }
    default:
      return {
        id: "segment",
        name: "Re z ∈ [-1,1]",
        tMin: -1,
        tMax: 1,
        samples: 200,
        sample: (t) => c(t, 0),
      };
  }
}

export function computeFunctionField(
  expr: string,
  region: Region,
  opts: FieldOptions,
  display: FunctionDisplay = "domain",
): FieldData {
  const { resolution: n, clip } = opts;
  const rgba = new Uint8ClampedArray(n * n * 4);
  const magnitude = new Float32Array(n * n);
  const phase = new Float32Array(n * n);
  const real = new Float32Array(n * n);
  const imag = new Float32Array(n * n);
  const fn = compileExpression(expr);

  for (let j = 0; j < n; j++) {
    const im = region.yMin + ((region.yMax - region.yMin) * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const re = region.xMin + ((region.xMax - region.xMin) * i) / (n - 1);
      const z = c(re, im);
      const w = fn(z);
      const idx = j * n + i;
      const pix = idx * 4;

      if (!w || !isFinite(w.re) || !isFinite(w.im)) {
        rgba[pix] = 24;
        rgba[pix + 1] = 24;
        rgba[pix + 2] = 32;
        rgba[pix + 3] = 255;
        magnitude[idx] = NaN;
        phase[idx] = NaN;
        real[idx] = NaN;
        imag[idx] = NaN;
        continue;
      }

      const mag = cabs(w);
      const arg = Math.atan2(w.im, w.re);
      magnitude[idx] = mag;
      phase[idx] = arg;
      real[idx] = w.re;
      imag[idx] = w.im;

      if (mag > clip) {
        rgba[pix] = 20;
        rgba[pix + 1] = 20;
        rgba[pix + 2] = 28;
        rgba[pix + 3] = 255;
        continue;
      }

      let rgb: [number, number, number];
      if (display === "domain") rgb = domainColor(mag, arg);
      else if (display === "real") rgb = scalarColor(w.re, -clip, clip);
      else if (display === "imag") rgb = scalarColor(w.im, -clip, clip);
      else if (display === "argument") rgb = domainColor(1, arg);
      else rgb = domainColor(mag, 0);

      rgba[pix] = rgb[0];
      rgba[pix + 1] = rgb[1];
      rgba[pix + 2] = rgb[2];
      rgba[pix + 3] = 255;
    }
  }

  return { width: n, height: n, rgba, magnitude, phase, real, imag };
}

function scalarColor(v: number, lo: number, hi: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  const r = Math.round(30 + t * 200);
  const g = Math.round(80 + (1 - Math.abs(t - 0.5) * 2) * 120);
  const b = Math.round(200 - t * 160);
  return [r, g, b];
}

export interface PlotCurve {
  zPoints: { x: number; y: number }[];
  wPoints: { x: number; y: number }[];
  color: number;
}

export function computeMappedCurve(expr: string, spec: CurveSpec): PlotCurve {
  const fn = compileExpression(expr);
  const zPoints: { x: number; y: number }[] = [];
  const wPoints: { x: number; y: number }[] = [];
  for (let i = 0; i <= spec.samples; i++) {
    const t = spec.tMin + ((spec.tMax - spec.tMin) * i) / spec.samples;
    const z = spec.sample(t);
    const w = fn(z);
    zPoints.push({ x: z.re, y: z.im });
    if (w && isFinite(w.re) && isFinite(w.im) && cabs(w) < 50) {
      wPoints.push({ x: w.re, y: w.im });
    }
  }
  return { zPoints, wPoints, color: 0xfc6255 };
}

export interface IsolineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "re" | "im";
}

export function computeIsolines(
  expr: string,
  region: Region,
  gridN = 48,
  levels = 8,
): IsolineSegment[] {
  const fn = compileExpression(expr);
  const xs = Array.from({ length: gridN }, (_, i) => region.xMin + ((region.xMax - region.xMin) * i) / (gridN - 1));
  const ys = Array.from({ length: gridN }, (_, j) => region.yMin + ((region.yMax - region.yMin) * j) / (gridN - 1));
  const reGrid: number[][] = [];
  const imGrid: number[][] = [];

  for (let j = 0; j < gridN; j++) {
    reGrid[j] = [];
    imGrid[j] = [];
    for (let i = 0; i < gridN; i++) {
      const w = fn(c(xs[i], ys[j]));
      reGrid[j][i] = w?.re ?? NaN;
      imGrid[j][i] = w?.im ?? NaN;
    }
  }

  const reLo = percentile(reGrid.flat().filter(isF), 5);
  const reHi = percentile(reGrid.flat().filter(isF), 95);
  const imLo = percentile(imGrid.flat().filter(isF), 5);
  const imHi = percentile(imGrid.flat().filter(isF), 95);

  const segs: IsolineSegment[] = [];
  for (let k = 1; k < levels; k++) {
    const reLvl = reLo + ((reHi - reLo) * k) / levels;
    const imLvl = imLo + ((imHi - imLo) * k) / levels;
    segs.push(...marchSquares(xs, ys, reGrid, reLvl, "re"));
    segs.push(...marchSquares(xs, ys, imGrid, imLvl, "im"));
  }
  return segs;
}

function isF(x: number) {
  return isFinite(x);
}

function percentile(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((s.length * p) / 100)] ?? 0;
}

function marchSquares(
  xs: number[],
  ys: number[],
  grid: number[][],
  level: number,
  kind: "re" | "im",
): IsolineSegment[] {
  const segs: IsolineSegment[] = [];
  const n = xs.length;
  const m = ys.length;
  for (let j = 0; j < m - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const v = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
      if (v.some((x) => !isFinite(x))) continue;
      const mask = v.map((x) => (x >= level ? 1 : 0)).join("");
      const edges: [number, number, number, number][] = [];
      const interp = (v0: number, v1: number, x0: number, y0: number, x1: number, y1: number) => {
        const t = (level - v0) / (v1 - v0);
        return { x: x0 + t * (x1 - x0), y: y0 + t * (y1 - y0) };
      };
      const x0 = xs[i];
      const x1 = xs[i + 1];
      const y0 = ys[j];
      const y1 = ys[j + 1];
      if (mask === "1000" || mask === "0111") edges.push([interp(v[0], v[1], x0, y0, x1, y0).x, interp(v[0], v[1], x0, y0, x1, y0).y, interp(v[3], v[0], x0, y1, x0, y0).x, interp(v[3], v[0], x0, y1, x0, y0).y]);
      if (mask === "0100" || mask === "1011") edges.push([interp(v[1], v[2], x1, y0, x1, y1).x, interp(v[1], v[2], x1, y0, x1, y1).y, interp(v[0], v[1], x0, y0, x1, y0).x, interp(v[0], v[1], x0, y0, x1, y0).y]);
      if (mask === "0010" || mask === "1101") edges.push([interp(v[2], v[3], x1, y1, x0, y1).x, interp(v[2], v[3], x1, y1, x0, y1).y, interp(v[1], v[2], x1, y0, x1, y1).x, interp(v[1], v[2], x1, y0, x1, y1).y]);
      if (mask === "0001" || mask === "1110") edges.push([interp(v[3], v[0], x0, y1, x0, y0).x, interp(v[3], v[0], x0, y1, x0, y0).y, interp(v[2], v[3], x1, y1, x0, y1).x, interp(v[2], v[3], x1, y1, x0, y1).y]);
      for (const [x1s, y1s, x2s, y2s] of edges) segs.push({ x1: x1s, y1: y1s, x2: x2s, y2: y2s, kind });
    }
  }
  return segs;
}