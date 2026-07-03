import { C, c, cabs, carg } from "./complex";
import { compileExpression } from "./expr";
import { FunctionDisplay } from "./function";
import { FieldData, FieldOptions, Region, domainColor } from "./field";
import { TransformStep, applyPipeline } from "./transforms";

const ROWS_PER_CHUNK = 24;

function yieldToUi(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function scalarColor(v: number, lo: number, hi: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  return [Math.round(30 + t * 200), Math.round(80 + (1 - Math.abs(t - 0.5) * 2) * 120), Math.round(200 - t * 160)];
}

export async function computeFieldAsync(
  steps: TransformStep[],
  region: Region,
  opts: FieldOptions,
  signal: { isCancelled: () => boolean },
): Promise<FieldData> {
  const { resolution: n, clip } = opts;
  const rgba = new Uint8ClampedArray(n * n * 4);
  const magnitude = new Float32Array(n * n);
  const phase = new Float32Array(n * n);
  const real = new Float32Array(n * n);
  const imag = new Float32Array(n * n);

  for (let j = 0; j < n; j++) {
    if (signal.isCancelled()) throw new Error("cancelled");
    const im = region.yMin + ((region.yMax - region.yMin) * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const re = region.xMin + ((region.xMax - region.xMin) * i) / (n - 1);
      const w = applyPipeline(c(re, im), steps);
      fillPixel(rgba, magnitude, phase, real, imag, j * n + i, w, clip);
    }
    if (j % ROWS_PER_CHUNK === ROWS_PER_CHUNK - 1) await yieldToUi();
  }

  return { width: n, height: n, rgba, magnitude, phase, real, imag };
}

export async function computeFunctionFieldAsync(
  expr: string,
  region: Region,
  opts: FieldOptions,
  display: FunctionDisplay,
  signal: { isCancelled: () => boolean },
): Promise<FieldData> {
  const { resolution: n, clip } = opts;
  const rgba = new Uint8ClampedArray(n * n * 4);
  const magnitude = new Float32Array(n * n);
  const phase = new Float32Array(n * n);
  const real = new Float32Array(n * n);
  const imag = new Float32Array(n * n);
  const fn = compileExpression(expr);

  for (let j = 0; j < n; j++) {
    if (signal.isCancelled()) throw new Error("cancelled");
    const im = region.yMin + ((region.yMax - region.yMin) * j) / (n - 1);
    for (let i = 0; i < n; i++) {
      const re = region.xMin + ((region.xMax - region.xMin) * i) / (n - 1);
      const w = fn(c(re, im));
      fillPixelFn(rgba, magnitude, phase, real, imag, j * n + i, w, clip, display);
    }
    if (j % ROWS_PER_CHUNK === ROWS_PER_CHUNK - 1) await yieldToUi();
  }

  return { width: n, height: n, rgba, magnitude, phase, real, imag };
}

function fillPixel(
  rgba: Uint8ClampedArray,
  magnitude: Float32Array,
  phase: Float32Array,
  real: Float32Array,
  imag: Float32Array,
  idx: number,
  w: C | null,
  clip: number,
): void {
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
    return;
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
    return;
  }
  const [r, g, b] = domainColor(mag, arg);
  rgba[pix] = r;
  rgba[pix + 1] = g;
  rgba[pix + 2] = b;
  rgba[pix + 3] = 255;
}

function fillPixelFn(
  rgba: Uint8ClampedArray,
  magnitude: Float32Array,
  phase: Float32Array,
  real: Float32Array,
  imag: Float32Array,
  idx: number,
  w: C | null,
  clip: number,
  display: FunctionDisplay,
): void {
  const pix = idx * 4;
  if (!w || !isFinite(w.re) || !isFinite(w.im)) {
    rgba[pix] = 24;
    rgba[pix + 1] = 24;
    rgba[pix + 2] = 32;
    rgba[pix + 3] = 255;
    magnitude[idx] = phase[idx] = real[idx] = imag[idx] = NaN;
    return;
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
    return;
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