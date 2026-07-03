import { C } from "./complex";
import { TransformStep, applyPipeline } from "./transforms";
import { CurvePoint } from "./field";

export const CURVE_W_MAX = 40;
const CURVE_JUMP_ABS = 2.5;
const MAX_SUBDIV_DEPTH = 10;

export function isWPlotable(p: CurvePoint, maxR = CURVE_W_MAX): boolean {
  return Number.isFinite(p.wx) && Number.isFinite(p.wy) && Math.hypot(p.wx, p.wy) < maxR;
}

function wRadius(p: CurvePoint): number {
  return Math.hypot(p.wx, p.wy);
}

/** Разрывать ли ломаную w между соседними точками (полюс, ∞, скачок ветви). */
export function shouldBreakWChain(prev: CurvePoint, next: CurvePoint): boolean {
  if (!isWPlotable(prev) || !isWPlotable(next)) return true;

  const dx = next.wx - prev.wx;
  const dy = next.wy - prev.wy;
  const dist = Math.hypot(dx, dy);
  const r0 = wRadius(prev);
  const r1 = wRadius(next);

  if (dist > CURVE_JUMP_ABS) return true;
  if (dist > 0.45 * (r0 + r1 + 0.25)) return true;

  if ((r0 < 1e-3 && r1 > 0.08) || (r1 < 1e-3 && r0 > 0.08)) return true;

  if (r0 > 0.15 && r1 > 0.15) {
    const a0 = Math.atan2(prev.wy, prev.wx);
    const a1 = Math.atan2(next.wy, next.wx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) > Math.PI / 3 && dist > 0.08) return true;
  }

  if (r0 < 0.6 && r1 < 0.6) {
    const a0 = Math.atan2(prev.wy, prev.wx);
    const a1 = Math.atan2(next.wy, next.wx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) > Math.PI / 5) return true;
  }

  if (prev.wx * next.wx < -0.02 && prev.wy * next.wy < -0.02 && dist > 0.5) return true;

  return false;
}

function evalCurvePoint(steps: TransformStep[], sample: (t: number) => C, t: number): CurvePoint {
  const z = sample(t);
  const w = applyPipeline(z, steps);
  return {
    x: z.re,
    y: z.im,
    wx: w?.re ?? NaN,
    wy: w?.im ?? NaN,
  };
}

function needsSubdivide(pa: CurvePoint, pb: CurvePoint, depth: number): boolean {
  if (depth >= MAX_SUBDIV_DEPTH) return false;
  if (!isWPlotable(pa) || !isWPlotable(pb)) return true;
  if (shouldBreakWChain(pa, pb)) return true;
  if (wRadius(pa) > 6 || wRadius(pb) > 6) return true;
  return false;
}

function subdivideInterval(
  steps: TransformStep[],
  sample: (t: number) => C,
  ta: number,
  tb: number,
  depth: number,
): CurvePoint[] {
  const pa = evalCurvePoint(steps, sample, ta);
  const pb = evalCurvePoint(steps, sample, tb);
  if (!needsSubdivide(pa, pb, depth)) return [pa, pb];

  const tm = (ta + tb) / 2;
  const left = subdivideInterval(steps, sample, ta, tm, depth + 1);
  const right = subdivideInterval(steps, sample, tm, tb, depth + 1);
  return left.concat(right.slice(1));
}

export function annotateWBreaks(points: CurvePoint[]): void {
  for (let i = 0; i < points.length - 1; i++) {
    if (shouldBreakWChain(points[i], points[i + 1])) {
      points[i].breakAfter = true;
    }
  }
  if (points.length > 0) {
    points[points.length - 1].breakAfter = true;
  }
}

export function samplePipelineCurve(
  steps: TransformStep[],
  sample: (t: number) => C,
  tMin: number,
  tMax: number,
  baseSamples = 400,
  adaptive = true,
): CurvePoint[] {
  const result: CurvePoint[] = [];

  if (!adaptive) {
    for (let i = 0; i <= baseSamples; i++) {
      const t = tMin + ((tMax - tMin) * i) / baseSamples;
      result.push(evalCurvePoint(steps, sample, t));
    }
    annotateWBreaks(result);
    return result;
  }

  const segments = Math.max(32, baseSamples);
  for (let i = 0; i < segments; i++) {
    const ta = tMin + ((tMax - tMin) * i) / segments;
    const tb = tMin + ((tMax - tMin) * (i + 1)) / segments;
    const chunk = subdivideInterval(steps, sample, ta, tb, 0);
    if (i > 0 && chunk.length > 0) chunk.shift();
    result.push(...chunk);
  }

  annotateWBreaks(result);
  return result;
}