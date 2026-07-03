import gsap from "gsap";
import { MANIM_EASE_NAMES } from "../core/manimEase";

export interface CameraState {
  panX: number;
  panY: number;
  zoom: number;
}

const ZOOM_MIN = 0.15;
const ZOOM_MAX = 80;
const FLING_MIN_SPEED = 0.35; // world units / s below which we don't bother flinging
const HISTORY_WINDOW_MS = 120;

export class CameraController {
  state: CameraState = { panX: 0, panY: 0, zoom: 1 };
  private targetZoom = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private onChange: () => void;
  private onResetView: (() => void) | null;
  private active = true;

  private zoomTween: gsap.core.Tween | null = null;
  private flingTween: gsap.core.Tween | null = null;
  private resetTween: gsap.core.Tween | null = null;
  private history: { t: number; x: number; y: number }[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    onChange: () => void,
    onResetView?: () => void,
  ) {
    this.onChange = onChange;
    this.onResetView = onResetView ?? null;
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", () => this.onUp());
    canvas.addEventListener("pointerleave", () => this.onUp());
    canvas.addEventListener("dblclick", () => {
      if (this.onResetView) this.onResetView();
      else this.reset();
    });
  }

  setEnabled(on: boolean): void {
    this.active = on;
    if (!on) {
      this.dragging = false;
      this.killTweens();
      this.canvas.style.cursor = "default";
    } else {
      this.canvas.style.cursor = "grab";
    }
  }

  private killTweens(): void {
    this.zoomTween?.kill();
    this.flingTween?.kill();
    this.resetTween?.kill();
    this.zoomTween = this.flingTween = this.resetTween = null;
  }

  reset(): void {
    this.killTweens();
    this.targetZoom = 1;
    this.resetTween = gsap.to(this.state, {
      panX: 0,
      panY: 0,
      zoom: 1,
      duration: 0.65,
      ease: MANIM_EASE_NAMES.smooth,
      onUpdate: () => this.onChange(),
      onComplete: () => (this.resetTween = null),
    });
  }

  /** NDC точки на плоскости контента (до масштаба z в локальных координатах). */
  screenToWorld(sx: number, sy: number, aspect: number): { x: number; y: number } {
    const ndcX = (sx / this.canvas.clientWidth) * 2 - 1;
    const ndcY = 1 - (sy / this.canvas.clientHeight) * 2;
    const wx = ndcX * aspect;
    const wy = ndcY;
    const z = this.state.zoom;
    return {
      x: (wx - this.state.panX) / z,
      y: (wy - this.state.panY) / z,
    };
  }

  private onWheel(e: WheelEvent): void {
    if (!this.active) return;
    e.preventDefault();
    this.flingTween?.kill();
    this.flingTween = null;

    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;

    const ndcX = (mx / rect.width) * 2 - 1;
    const ndcY = 1 - (my / rect.height) * 2;
    const wx = ndcX * aspect;
    const wy = ndcY;

    // Anchor off the point currently under the cursor (live tween value),
    // so rapid wheel bursts keep re-targeting smoothly without jumping.
    const localX = (wx - this.state.panX) / this.state.zoom;
    const localY = (wy - this.state.panY) / this.state.zoom;

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.targetZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.targetZoom * factor));

    const targetPanX = wx - localX * this.targetZoom;
    const targetPanY = wy - localY * this.targetZoom;

    this.zoomTween?.kill();
    this.zoomTween = gsap.to(this.state, {
      zoom: this.targetZoom,
      panX: targetPanX,
      panY: targetPanY,
      duration: 0.32,
      ease: "power3.out",
      overwrite: true,
      onUpdate: () => this.onChange(),
      onComplete: () => (this.zoomTween = null),
    });
  }

  private onDown(e: PointerEvent): void {
    if (!this.active) return;
    if (e.button !== 0 && e.button !== 1) return;
    this.flingTween?.kill();
    this.flingTween = null;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.history = [{ t: performance.now(), x: this.state.panX, y: this.state.panY }];
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = "grabbing";
  }

  private onMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = (e.clientX - this.lastX) / this.canvas.clientWidth;
    const dy = (e.clientY - this.lastY) / this.canvas.clientHeight;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    // 1:1 с движением курсора на экране (не зависит от zoom)
    this.state.panX += dx * 2 * aspect;
    this.state.panY -= dy * 2;
    this.onChange();

    this.history.push({ t: performance.now(), x: this.state.panX, y: this.state.panY });
    const cutoff = performance.now() - HISTORY_WINDOW_MS;
    while (this.history.length > 2 && this.history[0].t < cutoff) this.history.shift();
  }

  private onUp(): void {
    if (this.dragging) this.launchFling();
    this.dragging = false;
    this.canvas.style.cursor = this.active ? "grab" : "default";
  }

  /** Momentum: on release, keep coasting in the direction the pan was moving, easing to a stop. */
  private launchFling(): void {
    if (this.history.length < 2) return;
    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return;

    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed < FLING_MIN_SPEED) return;

    const coast = 0.22;
    this.flingTween = gsap.to(this.state, {
      panX: this.state.panX + vx * coast,
      panY: this.state.panY + vy * coast,
      duration: 0.75,
      ease: "power3.out",
      onUpdate: () => this.onChange(),
      onComplete: () => (this.flingTween = null),
    });
  }
}
