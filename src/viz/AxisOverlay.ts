import { Region } from "../core/field";

export interface AxisOverlayState {
  width: number;
  height: number;
  region: Region;
  visible: boolean;
  mathToScreen: (re: number, im: number) => { x: number; y: number };
  visibleBounds: () => { xMin: number; xMax: number; yMin: number; yMax: number };
}

const GRID_COLOR = "rgba(58, 58, 72, 0.38)";
const AXIS_COLOR = "rgba(232, 230, 240, 0.55)";
const TICK_COLOR = "rgba(232, 230, 240, 0.6)";
const LABEL_COLOR = "rgba(214, 218, 228, 0.95)";
const TITLE_COLOR = "rgba(255, 209, 102, 0.95)";
const CHIP_FILL = "rgba(12, 12, 18, 0.62)";
const ORIGIN_COLOR = "rgba(255, 209, 102, 0.95)";

const MIN_LABEL_PX = 46;
const EDGE_PAD = 10;
// Labels clamp further in than the plot edge on top/bottom, to stay clear of
// the view-tabs pill and the coords/hint chips docked in the viewport corners.
const LABEL_MARGIN_TOP = 44;
const LABEL_MARGIN_BOTTOM = 58;
const LABEL_MARGIN_SIDE = 16;

export class AxisOverlay {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "axis-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    parent.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
  }

  resize(width: number, height: number): void {
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw(state: AxisOverlayState): void {
    const { width, height, visible } = state;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, width, height);
    if (!visible || width < 80 || height < 80) return;

    const bounds = state.visibleBounds();
    const xSpan = bounds.xMax - bounds.xMin;
    const ySpan = bounds.yMax - bounds.yMin;
    if (xSpan <= 0 || ySpan <= 0) return;

    const plot = {
      left: EDGE_PAD,
      right: width - EDGE_PAD,
      top: EDGE_PAD,
      bottom: height - EDGE_PAD,
    };

    const xStep = niceStep(xSpan, (plot.right - plot.left) / MIN_LABEL_PX);
    const yStep = niceStep(ySpan, (plot.bottom - plot.top) / MIN_LABEL_PX);
    const xTicks = collectTicks(bounds.xMin, bounds.xMax, xStep);
    const yTicks = collectTicks(bounds.yMin, bounds.yMax, yStep);

    const origin = state.mathToScreen(0, 0);
    const xAxisVisible = origin.y >= plot.top && origin.y <= plot.bottom;
    const yAxisVisible = origin.x >= plot.left && origin.x <= plot.right;

    // Row/column the tick labels ride along — pinned to the real axis when
    // visible, clamped to the nearest edge (Desmos-style) when panned away.
    const labelRow = clamp(origin.y, plot.top + LABEL_MARGIN_TOP, plot.bottom - LABEL_MARGIN_BOTTOM);
    const labelCol = clamp(origin.x, plot.left + LABEL_MARGIN_SIDE, plot.right - LABEL_MARGIN_SIDE);
    const rowNearBottom = labelRow > plot.top + (plot.bottom - plot.top) * 0.62;
    const colNearRight = labelCol > plot.left + (plot.right - plot.left) * 0.62;

    ctx.lineWidth = 1;
    ctx.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace';

    // ── grid ──
    ctx.strokeStyle = GRID_COLOR;
    ctx.beginPath();
    for (const re of xTicks) {
      if (re === 0) continue;
      const p = state.mathToScreen(re, 0);
      if (p.x < plot.left - 2 || p.x > plot.right + 2) continue;
      ctx.moveTo(p.x, plot.top);
      ctx.lineTo(p.x, plot.bottom);
    }
    for (const im of yTicks) {
      if (im === 0) continue;
      const p = state.mathToScreen(0, im);
      if (p.y < plot.top - 2 || p.y > plot.bottom + 2) continue;
      ctx.moveTo(plot.left, p.y);
      ctx.lineTo(plot.right, p.y);
    }
    ctx.stroke();

    // ── axis lines (with arrow tips, Manim Axes style) ──
    ctx.strokeStyle = AXIS_COLOR;
    ctx.lineWidth = 1.4;
    if (xAxisVisible) {
      ctx.beginPath();
      ctx.moveTo(plot.left, origin.y);
      ctx.lineTo(plot.right - 8, origin.y);
      ctx.stroke();
      drawArrow(ctx, plot.right, origin.y, 0, AXIS_COLOR);
    }
    if (yAxisVisible) {
      ctx.beginPath();
      ctx.moveTo(origin.x, plot.bottom);
      ctx.lineTo(origin.x, plot.top + 8);
      ctx.stroke();
      drawArrow(ctx, origin.x, plot.top, -Math.PI / 2, AXIS_COLOR);
    }
    ctx.lineWidth = 1;

    // ── x ticks + labels, riding along the (clamped) horizontal axis row ──
    const tickSide = rowNearBottom ? -1 : 1; // 1 = ticks/labels below the row, -1 = above
    let lastXLabel = -Infinity;
    for (const re of xTicks) {
      const p = state.mathToScreen(re, 0);
      if (p.x < plot.left + 2 || p.x > plot.right - 2) continue;
      if (re === 0 && xAxisVisible && yAxisVisible) continue; // origin drawn once, below
      if (p.x - lastXLabel < MIN_LABEL_PX) continue;
      lastXLabel = p.x;

      ctx.strokeStyle = TICK_COLOR;
      ctx.beginPath();
      ctx.moveTo(p.x, labelRow - 4 * tickSide);
      ctx.lineTo(p.x, labelRow + 4 * tickSide);
      ctx.stroke();

      const label = formatTick(re, xStep);
      drawChipLabel(ctx, label, p.x, labelRow + 13 * tickSide, "center", re === 0 ? TITLE_COLOR : LABEL_COLOR);
    }

    // ── y ticks + labels, riding along the (clamped) vertical axis column ──
    const tickHSide = colNearRight ? -1 : 1; // 1 = ticks/labels right of column, -1 = left
    let lastYLabel = -Infinity;
    for (const im of yTicks) {
      const p = state.mathToScreen(0, im);
      if (p.y < plot.top + 2 || p.y > plot.bottom - 2) continue;
      if (im === 0 && xAxisVisible && yAxisVisible) continue;
      if (p.y - lastYLabel < MIN_LABEL_PX) continue;
      lastYLabel = p.y;

      ctx.strokeStyle = TICK_COLOR;
      ctx.beginPath();
      ctx.moveTo(labelCol - 4 * tickHSide, p.y);
      ctx.lineTo(labelCol + 4 * tickHSide, p.y);
      ctx.stroke();

      const label = formatTick(im, yStep);
      const anchor = tickHSide > 0 ? "left" : "right";
      drawChipLabel(ctx, label, labelCol + 15 * tickHSide, p.y, anchor, im === 0 ? TITLE_COLOR : LABEL_COLOR);
    }

    // ── shared origin "0" ── offset away from the y-label column so it never overlaps
    if (xAxisVisible && yAxisVisible) {
      const ox = tickHSide > 0 ? labelCol - 10 : labelCol + 10;
      const oAnchor = tickHSide > 0 ? "right" : "left";
      drawChipLabel(ctx, "0", ox, labelRow + 12 * tickSide, oAnchor, ORIGIN_COLOR);
    }

    // ── axis titles at the arrow tips ──
    if (xAxisVisible) {
      drawChipLabel(ctx, "Re z", plot.right - 4, origin.y + 15 * tickSide, "right", TITLE_COLOR, true);
    }
    if (yAxisVisible) {
      drawChipLabel(ctx, "Im z", origin.x + 15 * tickHSide, plot.top + 4, tickHSide > 0 ? "left" : "right", TITLE_COLOR, true);
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string): void {
  const size = 6.5;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-size, size * 0.55);
  ctx.lineTo(-size, -size * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawChipLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: "left" | "right" | "center",
  color: string,
  bold = false,
): void {
  ctx.font = bold
    ? '600 11.5px "EB Garamond", "JetBrains Mono", serif'
    : '500 10.5px "JetBrains Mono", ui-monospace, monospace';
  const metrics = ctx.measureText(text);
  const w = metrics.width;
  const padX = 4;
  const padY = 3;
  let left = x;
  if (align === "center") left = x - w / 2;
  else if (align === "right") left = x - w;

  ctx.fillStyle = CHIP_FILL;
  roundRect(ctx, left - padX, y - 7 - padY, w + padX * 2, 14 + padY * 2, 4);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function niceStep(span: number, targetTicks: number): number {
  const rough = span / Math.max(2, targetTicks);
  if (!isFinite(rough) || rough <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  if (norm <= 1) return pow;
  if (norm <= 2) return 2 * pow;
  if (norm <= 5) return 5 * pow;
  return 10 * pow;
}

function collectTicks(min: number, max: number, step: number): number[] {
  if (step <= 0) return [];
  const start = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    ticks.push(snapTick(v, step));
  }
  return ticks;
}

function snapTick(v: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return parseFloat(v.toFixed(decimals));
}

function formatTick(v: number, step: number): string {
  if (Math.abs(v) < step * 0.001) return "0";
  const decimals = step < 1 ? Math.max(0, Math.ceil(-Math.log10(step))) : 0;
  if (decimals > 0) return v.toFixed(decimals);
  return String(Math.round(v));
}
