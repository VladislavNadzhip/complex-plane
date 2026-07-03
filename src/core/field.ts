import { C, c, cabs, carg } from "./complex";
import { samplePipelineCurve } from "./curveSample";
import { TransformStep, applyPipeline } from "./transforms";

export type ViewMode =
  | "domain"
  | "contour"
  | "grid"
  | "curve"
  | "phase"
  | "func-domain"
  | "func-isolines"
  | "func-curves";

export interface Region {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface FieldOptions {
  resolution: number;
  clip: number;
}

export interface FieldData {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  magnitude: Float32Array;
  phase: Float32Array;
  real: Float32Array;
  imag: Float32Array;
}

export function computeField(
  steps: TransformStep[],
  region: Region,
  opts: FieldOptions,
): FieldData {
  const { resolution: n, clip } = opts;
  const rgba = new Uint8ClampedArray(n * n * 4);
  const magnitude = new Float32Array(n * n);
  const phase = new Float32Array(n * n);
  const real = new Float32Array(n * n);
  const imag = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    const im = region.yMin + ((region.yMax - region.yMin) * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const re = region.xMin + ((region.xMax - region.xMin) * i) / (n - 1);
      const z = c(re, im);
      const w = applyPipeline(z, steps);
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
      const arg = carg(w);
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

      const [r, g, b] = domainColor(mag, arg);
      rgba[pix] = r;
      rgba[pix + 1] = g;
      rgba[pix + 2] = b;
      rgba[pix + 3] = 255;
    }
  }

  return { width: n, height: n, rgba, magnitude, phase, real, imag };
}

/** Manim-inspired domain coloring */
export function domainColor(mag: number, arg: number): [number, number, number] {
  if (mag < 1e-6) return [12, 12, 18];
  if (mag > 1e3) return [245, 245, 250];

  const hue = (arg + Math.PI) / (2 * Math.PI);
  const logMag = Math.log1p(mag);
  const v = Math.min(1, logMag / 2.2);
  const s = 0.82;

  return hsvToRgb(hue, s, 0.25 + 0.7 * v);
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i % 6) {
    case 0:
      r = v; g = t; b = p; break;
    case 1:
      r = q; g = v; b = p; break;
    case 2:
      r = p; g = v; b = t; break;
    case 3:
      r = p; g = q; b = v; break;
    case 4:
      r = t; g = p; b = v; break;
    case 5:
      r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function fieldToContour(field: FieldData, mode: "magnitude" | "real" | "imag" | "argument" = "magnitude"): FieldData {
  const n = field.width * field.height;
  const rgba = new Uint8ClampedArray(n * 4);
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    const mag = field.magnitude[i];
    let v = 0;
    if (mode === "real") v = field.real[i];
    else if (mode === "imag") v = field.imag[i];
    else if (mode === "argument") v = field.phase[i];
    else v = isFinite(mag) ? Math.log1p(mag) : NaN;
    vals.push(v);
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vals) {
    if (!isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    const pix = i * 4;
    if (!isFinite(v)) {
      rgba[pix] = 20; rgba[pix + 1] = 20; rgba[pix + 2] = 28; rgba[pix + 3] = 255;
      continue;
    }
    const t = hi > lo ? (v - lo) / (hi - lo) : 0;
    const [r, g, b] = viridis(t);
    rgba[pix] = r; rgba[pix + 1] = g; rgba[pix + 2] = b; rgba[pix + 3] = 255;
  }
  return { ...field, rgba };
}

function viridis(t: number): [number, number, number] {
  const r = Math.round(255 * (0.267 + t * (0.004 + t * (2.2 - 2.0 * t))));
  const g = Math.round(255 * (0.004 + t * (1.4 + t * (-0.4))));
  const b = Math.round(255 * (0.329 + t * (1.8 - 1.1 * t)));
  return [Math.min(255, r), Math.min(255, g), Math.min(255, b)];
}

export function blendFields(a: FieldData, b: FieldData, t: number): FieldData {
  const n = a.width * a.height;
  const rgba = new Uint8ClampedArray(n * 4);
  const magnitude = new Float32Array(n);
  const phase = new Float32Array(n);
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    for (let c = 0; c < 4; c++) rgba[p + c] = Math.round(a.rgba[p + c] * (1 - t) + b.rgba[p + c] * t);
    magnitude[i] = a.magnitude[i] * (1 - t) + b.magnitude[i] * t;
    phase[i] = a.phase[i] * (1 - t) + b.phase[i] * t;
    real[i] = a.real[i] * (1 - t) + b.real[i] * t;
    imag[i] = a.imag[i] * (1 - t) + b.imag[i] * t;
  }
  return { width: a.width, height: a.height, rgba, magnitude, phase, real, imag };
}

export interface GridLine {
  points: { x: number; y: number; wx: number; wy: number }[];
}

export function computeGrid(
  steps: TransformStep[],
  region: Region,
  lineCount = 16,
): { horizontal: GridLine[]; vertical: GridLine[] } {
  const horizontal: GridLine[] = [];
  const vertical: GridLine[] = [];
  const samples = 200;

  for (let k = 0; k < lineCount; k++) {
    const y = region.yMin + ((region.yMax - region.yMin) * k) / (lineCount - 1);
    const pts: GridLine["points"] = [];
    for (let s = 0; s < samples; s++) {
      const x = region.xMin + ((region.xMax - region.xMin) * s) / (samples - 1);
      const z = c(x, y);
      const w = applyPipeline(z, steps);
      pts.push({
        x,
        y,
        wx: w?.re ?? NaN,
        wy: w?.im ?? NaN,
      });
    }
    horizontal.push({ points: pts });
  }

  for (let k = 0; k < lineCount; k++) {
    const x = region.xMin + ((region.xMax - region.xMin) * k) / (lineCount - 1);
    const pts: GridLine["points"] = [];
    for (let s = 0; s < samples; s++) {
      const y = region.yMin + ((region.yMax - region.yMin) * s) / (samples - 1);
      const z = c(x, y);
      const w = applyPipeline(z, steps);
      pts.push({
        x,
        y,
        wx: w?.re ?? NaN,
        wy: w?.im ?? NaN,
      });
    }
    vertical.push({ points: pts });
  }

  return { horizontal, vertical };
}

export interface CurvePoint {
  x: number;
  y: number;
  wx: number;
  wy: number;
  /** Не соединять со следующей точкой в образе w (полюс, ∞, скачок ветви). */
  breakAfter?: boolean;
}

export function computePipelineCurve(
  steps: TransformStep[],
  sample: (t: number) => C,
  tMin: number,
  tMax: number,
  samples = 400,
  adaptive = true,
): CurvePoint[] {
  return samplePipelineCurve(steps, sample, tMin, tMax, samples, adaptive);
}