import katex from "katex";
import gsap from "gsap";
import {
  FieldData,
  Region,
  ViewMode,
  blendFields,
  computeField,
  computeGrid,
  computePipelineCurve,
  CurvePoint,
  fieldToContour,
} from "../core/field";
import { computeFieldAsync, computeFunctionFieldAsync } from "../core/fieldAsync";
import {
  FunctionDisplay,
  SOURCE_CURVES,
  computeFunctionField,
  computeIsolines,
  computeMappedCurve,
  curveFromSpec,
} from "../core/function";
import { collapseParams, defaultUiParams } from "../core/params";
import {
  PRESETS,
  TRANSFORMS,
  TransformParams,
  TransformStep,
  applyPipeline,
  evaluateExpression,
  getTransform,
  pipelineLatex,
  stepLabel,
  uid,
} from "../core/transforms";
import { c, formatComplex } from "../core/complex";
import { resolveEase } from "../core/manimEase";
import { SceneManager } from "../viz/SceneManager";
import { renderParamEditor } from "./ParamEditor";

type AppMode = "transform" | "function";
type PlaybackMode = "full" | "steps";

export class AppController {
  private appMode: AppMode = "transform";
  private steps: TransformStep[] = [];
  private selectedStepId: string | null = null;
  private currentField: FieldData | null = null;
  private rawField: FieldData | null = null;
  private viewMode: ViewMode = "domain";
  private animating = false;
  private morphTween: gsap.core.Tween | null = null;
  private rebuildGen = 0;
  private lastFormulaHtml = "";
  private lastChainSig = "";

  private functionExpr = "sin(z)";
  private functionDisplay: FunctionDisplay = "domain";
  private curveParam = 1;
  private transformCurveParam = 1;
  private playbackMode: PlaybackMode = "full";
  private playbackStep = 0;

  private els = {
    modeTabs: document.getElementById("mode-tabs")!,
    panelTransform: document.getElementById("panel-transform")!,
    panelFunction: document.getElementById("panel-function")!,
    transformSelect: document.getElementById("transform-select") as HTMLSelectElement,
    paramFields: document.getElementById("param-fields")!,
    stepEditor: document.getElementById("step-editor")!,
    stepEditorTitle: document.getElementById("step-editor-title")!,
    btnAdd: document.getElementById("btn-add")!,
    btnClear: document.getElementById("btn-clear")!,
    chainList: document.getElementById("chain-list")!,
    presetGrid: document.getElementById("preset-grid")!,
    formulaBar: document.getElementById("formula-bar")!,
    viewTabs: document.getElementById("view-tabs")!,
    viewTabsFn: document.getElementById("view-tabs-fn")!,
    coordsReadout: document.getElementById("coords-readout")!,
    btnAnimate: document.getElementById("btn-animate")!,
    btnExport: document.getElementById("btn-export")!,
    btnResetView: document.getElementById("btn-reset-view")!,
    functionExpr: document.getElementById("function-expr") as HTMLInputElement,
    functionDisplay: document.getElementById("function-display") as HTMLSelectElement,
    curveSelect: document.getElementById("curve-select") as HTMLSelectElement,
    curveParam: document.getElementById("curve-param") as HTMLInputElement,
    curveParamLabel: document.getElementById("curve-param-label")!,
    btnApplyFn: document.getElementById("btn-apply-fn")!,
    xMin: document.getElementById("x-min") as HTMLInputElement,
    xMax: document.getElementById("x-max") as HTMLInputElement,
    yMin: document.getElementById("y-min") as HTMLInputElement,
    yMax: document.getElementById("y-max") as HTMLInputElement,
    resolution: document.getElementById("resolution") as HTMLInputElement,
    clip: document.getElementById("clip") as HTMLInputElement,
    resLabel: document.getElementById("res-label")!,
    clipLabel: document.getElementById("clip-label")!,
    duration: document.getElementById("duration") as HTMLInputElement,
    durLabel: document.getElementById("dur-label")!,
    easing: document.getElementById("easing") as HTMLSelectElement,
    loopAnim: document.getElementById("loop-anim") as HTMLInputElement,
    canvas: document.getElementById("viz-canvas") as HTMLCanvasElement,
    loadingOverlay: document.getElementById("loading-overlay")!,
    transformCurveSelect: document.getElementById("transform-curve-select") as HTMLSelectElement,
    transformCurveParam: document.getElementById("transform-curve-param") as HTMLInputElement,
    transformCurveParamLabel: document.getElementById("transform-curve-param-label")!,
    viewportHint: document.getElementById("viewport-hint")!,
    playbackSection: document.getElementById("playback-section")!,
    playbackMode: document.getElementById("playback-mode")!,
    stepSliderWrap: document.getElementById("step-slider-wrap")!,
    playbackStepSlider: document.getElementById("playback-step") as HTMLInputElement,
    stepLabel: document.getElementById("step-label")!,
    stepHint: document.getElementById("step-hint")!,
  };

  private scene: SceneManager;

  constructor() {
    this.scene = new SceneManager(this.els.canvas);
    this.populateTransforms();
    this.populatePresets();
    this.populateCurves();
    this.populateTransformCurves();
    this.bindEvents();
    this.renderAddParams();
    this.updatePlaybackUI();
    this.rebuild(false);
    this.loop();
    this.playEntranceAnimation();
  }

  /** Manim-style cascading intro so the app doesn't just snap into view on load. */
  private playEntranceAnimation(): void {
    const tl = gsap.timeline({ defaults: { ease: resolveEase("manim") } });
    tl.from(".topbar", { opacity: 0, y: -14, duration: 0.45 })
      .from(".panel-left", { opacity: 0, x: -16, duration: 0.45 }, "<0.05")
      .from(".panel-right", { opacity: 0, x: 16, duration: 0.45 }, "<")
      .from(".viewport", { opacity: 0, scale: 0.985, duration: 0.55 }, "<0.05");
  }

  /** Шаги, применяемые к визуализации (с учётом пошагового режима). */
  private activeSteps(): TransformStep[] {
    if (this.appMode !== "transform" || this.playbackMode === "full") return this.steps;
    return this.steps.slice(0, this.playbackStep);
  }

  private updatePlaybackUI(): void {
    const n = this.steps.length;
    this.els.playbackStepSlider.max = String(n);
    this.els.playbackStepSlider.value = String(Math.min(this.playbackStep, n));

    const showSlider = this.playbackMode === "steps" && this.appMode === "transform";
    this.els.stepSliderWrap.classList.toggle("hidden", !showSlider);

    if (this.playbackStep === 0) {
      this.els.stepLabel.textContent = "w = z";
    } else if (this.playbackMode === "full" || this.playbackStep >= n) {
      this.els.stepLabel.textContent = `1…${n} (все)`;
    } else {
      this.els.stepLabel.textContent = `${this.playbackStep} / ${n}: ${stepLabel(this.steps[this.playbackStep - 1])}`;
    }

    if (this.playbackMode === "full") {
      this.els.stepHint.textContent = "Показан полный результат всех преобразований";
    } else if (this.playbackStep === 0) {
      this.els.stepHint.textContent = "Тождество — ещё нет преобразований";
    } else {
      this.els.stepHint.textContent = `Применены первые ${this.playbackStep} шаг(ов) из ${n}`;
    }
  }

  private populateTransforms(): void {
    for (const t of TRANSFORMS.filter((x) => x.id !== "identity")) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      this.els.transformSelect.appendChild(opt);
    }
    this.els.transformSelect.value = "shift";
  }

  private populatePresets(): void {
    for (const p of PRESETS) {
      const btn = document.createElement("button");
      btn.className = "preset-btn";
      btn.textContent = p.name;
      btn.addEventListener("click", () => {
        this.steps = p.steps.map((s) => ({
          id: uid(),
          defId: s.defId,
          params: { ...getTransform(s.defId).defaults, ...s.params },
        }));
        this.selectedStepId = null;
        this.playbackStep = this.playbackMode === "steps" ? 0 : p.steps.length;
        this.updatePlaybackUI();
        this.rebuild(true);
      });
      this.els.presetGrid.appendChild(btn);
    }
  }

  private populateCurves(): void {
    for (const c of SOURCE_CURVES) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      this.els.curveSelect.appendChild(opt);
    }
    this.updateCurveParamLabel(this.els.curveSelect, this.els.curveParamLabel);
  }

  private populateTransformCurves(): void {
    for (const c of SOURCE_CURVES) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      this.els.transformCurveSelect.appendChild(opt);
    }
    this.updateCurveParamLabel(this.els.transformCurveSelect, this.els.transformCurveParamLabel);
  }

  private updateCurveParamLabel(select: HTMLSelectElement, labelEl: HTMLElement): void {
    const id = select.value;
    if (id === "circle") labelEl.textContent = "r";
    else if (id === "line_h") labelEl.textContent = "Im z = b";
    else if (id === "line_v") labelEl.textContent = "Re z = a";
    else labelEl.textContent = "—";
  }

  private transformCurveParams(): { r: number; b: number; a: number } {
    const v = this.transformCurveParam;
    return { r: v, b: v, a: v };
  }

  private pipelineCurvePoints(): CurvePoint[] {
    return this.pipelineCurvePointsFor(this.activeSteps());
  }

  private pipelineCurvePointsFor(steps: TransformStep[], adaptive = true): CurvePoint[] {
    const spec = curveFromSpec(this.els.transformCurveSelect.value, this.transformCurveParams());
    return computePipelineCurve(steps, spec.sample, spec.tMin, spec.tMax, spec.samples, adaptive);
  }

  private renderAddParams(): void {
    const defId = this.els.transformSelect.value;
    const def = getTransform(defId);
    renderParamEditor(this.els.paramFields, defId, defaultUiParams(defId, def.defaults), () => {}, 99999);
  }

  private readAddParams(): TransformParams {
    const defId = this.els.transformSelect.value;
    const ui: TransformParams = {};
    this.els.paramFields.querySelectorAll("input").forEach((inp) => {
      const key = (inp as HTMLInputElement).dataset.key!;
      const raw = (inp as HTMLInputElement).value;
      ui[key] = inp.type === "range" || /^-?\d*\.?\d+$/.test(raw) ? parseFloat(raw) : raw;
    });
    return collapseParams(defId, ui);
  }

  private region(): Region {
    return {
      xMin: parseFloat(this.els.xMin.value),
      xMax: parseFloat(this.els.xMax.value),
      yMin: parseFloat(this.els.yMin.value),
      yMax: parseFloat(this.els.yMax.value),
    };
  }

  private fieldOpts() {
    return {
      resolution: parseInt(this.els.resolution.value, 10),
      clip: parseFloat(this.els.clip.value),
    };
  }

  private setAppMode(mode: AppMode): void {
    this.appMode = mode;
    this.els.modeTabs.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-mode") === mode);
    });

    const showingPanel = mode === "transform" ? this.els.panelTransform : this.els.panelFunction;
    const hidingPanel = mode === "transform" ? this.els.panelFunction : this.els.panelTransform;
    hidingPanel.classList.add("hidden");
    showingPanel.classList.remove("hidden");
    gsap.fromTo(
      showingPanel,
      { opacity: 0, y: 6 },
      { opacity: 1, y: 0, duration: 0.32, ease: resolveEase("manim") },
    );

    this.els.playbackSection.classList.toggle("hidden", mode !== "transform");
    document.getElementById("view-tabs")!.classList.toggle("hidden", mode !== "transform");
    document.getElementById("view-tabs-fn")!.classList.toggle("hidden", mode !== "function");
    if (mode === "function") {
      this.viewMode = "func-domain";
      this.els.viewTabsFn.querySelectorAll("button").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-view") === "func-domain");
      });
    } else {
      this.viewMode = "domain";
    }
    this.crossfadeCanvas(() => this.scene.setViewMode(this.viewMode));
    this.renderFormula();
    void this.rebuild(false);
  }

  /** Brief dip-and-recover on the canvas so view/mode swaps read as a transition, not a cut. */
  private crossfadeCanvas(apply: () => void): void {
    gsap.killTweensOf(this.els.canvas);
    gsap.to(this.els.canvas, {
      opacity: 0.2,
      duration: 0.14,
      ease: "power2.in",
      onComplete: () => {
        apply();
        gsap.to(this.els.canvas, { opacity: 1, duration: 0.38, ease: resolveEase("manim") });
      },
    });
  }

  private isCancelled(gen: number): boolean {
    return gen !== this.rebuildGen;
  }

  private setLoading(visible: boolean): void {
    this.els.loadingOverlay.classList.toggle("hidden", !visible);
  }

  private bindEvents(): void {
    this.els.modeTabs.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => this.setAppMode(btn.getAttribute("data-mode") as AppMode));
    });

    this.els.transformSelect.addEventListener("change", () => this.renderAddParams());

    this.els.btnAdd.addEventListener("click", () => {
      const defId = this.els.transformSelect.value;
      const step: TransformStep = { id: uid(), defId, params: this.readAddParams() };
      this.steps.push(step);
      this.selectedStepId = step.id;
      if (this.playbackMode === "steps") this.playbackStep = this.steps.length;
      this.updatePlaybackUI();
      this.rebuild(true);
    });

    this.els.btnClear.addEventListener("click", () => {
      this.steps = [];
      this.selectedStepId = null;
      this.playbackStep = 0;
      this.els.stepEditor.innerHTML = "";
      this.updatePlaybackUI();
      this.rebuild(true);
    });

    this.els.viewTabs.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => this.switchView(btn.getAttribute("data-view") as ViewMode, this.els.viewTabs));
    });

    this.els.viewTabsFn.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => this.switchView(btn.getAttribute("data-view") as ViewMode, this.els.viewTabsFn));
    });

    for (const el of [this.els.xMin, this.els.xMax, this.els.yMin, this.els.yMax, this.els.resolution, this.els.clip]) {
      el.addEventListener("change", () => this.rebuild(false));
      el.addEventListener("input", () => {
        this.els.resLabel.textContent = this.els.resolution.value;
        this.els.clipLabel.textContent = this.els.clip.value;
      });
    }

    this.els.duration.addEventListener("input", () => {
      this.els.durLabel.textContent = `${this.els.duration.value}s`;
    });

    this.els.btnAnimate.addEventListener("click", () => this.runAnimation());
    this.els.btnExport.addEventListener("click", () => {
      const a = document.createElement("a");
      a.download = "complex-plane.png";
      a.href = this.scene.exportPng();
      a.click();
    });

    this.els.btnResetView.addEventListener("click", () => this.scene.resetCamera());

    this.els.canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));

    this.els.btnApplyFn.addEventListener("click", () => {
      this.functionExpr = this.els.functionExpr.value;
      this.functionDisplay = this.els.functionDisplay.value as FunctionDisplay;
      this.rebuild(true);
    });

    this.els.functionExpr.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.functionExpr = this.els.functionExpr.value;
        this.rebuild(true);
      }
    });

    this.els.functionDisplay.addEventListener("change", () => {
      this.functionDisplay = this.els.functionDisplay.value as FunctionDisplay;
      this.rebuild(false);
    });

    this.els.curveSelect.addEventListener("change", () => {
      this.updateCurveParamLabel(this.els.curveSelect, this.els.curveParamLabel);
      if (this.viewMode === "func-curves") this.rebuild(false);
    });

    this.els.curveParam.addEventListener("input", () => {
      this.curveParam = parseFloat(this.els.curveParam.value) || 1;
      if (this.viewMode === "func-curves") this.rebuild(false);
    });

    this.els.transformCurveSelect.addEventListener("change", () => {
      this.updateCurveParamLabel(this.els.transformCurveSelect, this.els.transformCurveParamLabel);
      if (this.viewMode === "curve") this.rebuild(true);
    });

    this.els.transformCurveParam.addEventListener("input", () => {
      this.transformCurveParam = parseFloat(this.els.transformCurveParam.value) || 1;
      if (this.viewMode === "curve") this.rebuild(true);
    });

    this.els.playbackMode.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-playback") as PlaybackMode;
        this.playbackMode = mode;
        this.els.playbackMode.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        if (mode === "steps") this.playbackStep = Math.min(this.playbackStep, this.steps.length) || 0;
        this.updatePlaybackUI();
        this.rebuild(true);
      });
    });

    this.els.playbackStepSlider.addEventListener("input", () => {
      this.playbackStep = parseInt(this.els.playbackStepSlider.value, 10);
      this.updatePlaybackUI();
      this.rebuild(true);
    });
  }

  private switchView(mode: ViewMode, tabEl: HTMLElement): void {
    tabEl.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    tabEl.querySelector(`[data-view="${mode}"]`)?.classList.add("active");
    this.viewMode = mode;
    this.crossfadeCanvas(() => this.scene.setViewMode(mode));
    this.updateViewportHint();
    this.rebuild(false);
  }

  private updateViewportHint(): void {
    if (this.viewMode === "phase") {
      this.els.viewportHint.textContent =
        "3D: ЛКМ — вращение · ПКМ/Shift — пан · Колёсико — зум · Двойной клик — сброс";
    } else {
      this.els.viewportHint.textContent =
        "Колёсико — зум · Перетаскивание — пан · Двойной клик — сброс";
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const rect = this.els.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const w = this.scene.worldFromScreen(sx, sy);
    const z = c(w.x, w.y);

    if (this.appMode === "function") {
      const fv = evaluateExpression(this.functionExpr, z);
      const fStr = fv ? formatComplex(fv) : "—";
      this.els.coordsReadout.textContent = `z = ${formatComplex(z)}  →  f(z) = ${fStr}`;
    } else {
      const wv = applyPipeline(z, this.activeSteps());
      const wStr = wv ? formatComplex(wv) : "—";
      this.els.coordsReadout.textContent = `z = ${formatComplex(z)}  →  w = ${wStr}`;
    }
  }

  private renderChain(): void {
    this.els.chainList.innerHTML = "";
    this.steps.forEach((step, idx) => {
      const li = document.createElement("li");
      li.className = `chain-item${step.id === this.selectedStepId ? " selected" : ""}`;
      li.innerHTML = `
        <span class="chain-index">${idx + 1}</span>
        <span class="chain-name">${stepLabel(step)}</span>
        <div class="chain-actions">
          <button data-act="edit" data-idx="${idx}" title="Параметры">⚙</button>
          <button data-act="up" data-idx="${idx}">↑</button>
          <button data-act="down" data-idx="${idx}">↓</button>
          <button data-act="del" data-idx="${idx}">×</button>
        </div>`;
      li.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const i = parseInt(b.getAttribute("data-idx")!, 10);
          const act = b.getAttribute("data-act");
          if (act === "del") {
            this.steps.splice(i, 1);
            if (this.selectedStepId === this.steps[i]?.id) this.selectedStepId = null;
          } else if (act === "edit") {
            this.selectedStepId = this.steps[i].id;
            this.renderStepEditor(this.steps[i]);
          } else if (act === "up" && i > 0) {
            [this.steps[i], this.steps[i - 1]] = [this.steps[i - 1], this.steps[i]];
          } else if (act === "down" && i < this.steps.length - 1) {
            [this.steps[i], this.steps[i + 1]] = [this.steps[i + 1], this.steps[i]];
          }
          this.renderChain();
          if (act !== "edit") {
            this.updatePlaybackUI();
            this.rebuild(true);
          }
        });
      });
      li.addEventListener("click", () => {
        this.selectedStepId = step.id;
        this.renderStepEditor(step);
        this.renderChain();
      });
      this.els.chainList.appendChild(li);
    });

    const sig = this.steps.map((s) => s.id).join(",");
    if (sig !== this.lastChainSig) {
      this.lastChainSig = sig;
      gsap.fromTo(
        this.els.chainList.querySelectorAll(".chain-item"),
        { opacity: 0, x: -10 },
        { opacity: 1, x: 0, duration: 0.3, ease: resolveEase("manim"), stagger: 0.035 },
      );
    }

    if (this.selectedStepId) {
      const step = this.steps.find((s) => s.id === this.selectedStepId);
      if (step) this.renderStepEditor(step);
      else {
        this.selectedStepId = null;
        this.els.stepEditor.innerHTML = "";
      }
    }
    this.updatePlaybackUI();
  }

  private renderStepEditor(step: TransformStep): void {
    this.els.stepEditorTitle.textContent = `Параметры: ${getTransform(step.defId).name}`;
    renderParamEditor(this.els.stepEditor, step.defId, step.params, (params) => {
      step.params = params;
      this.renderChain();
      this.rebuild(true);
    }, 400);
  }

  private renderFormula(): void {
    try {
      const tex =
        this.appMode === "function"
          ? `f(z) = ${this.functionExpr.replace(/\*/g, " \\cdot ").replace(/sin/g, "\\sin").replace(/cos/g, "\\cos").replace(/exp/g, "\\exp").replace(/log/g, "\\log")}`
          : (() => {
              const vis = this.activeSteps();
              return vis.length ? `w = ${pipelineLatex(vis)}` : "w = z";
            })();
      const html = katex.renderToString(tex, { throwOnError: false, displayMode: false });
      if (html === this.lastFormulaHtml) return;
      this.lastFormulaHtml = html;
      this.els.formulaBar.innerHTML = html;
      this.animateFormulaReveal();
    } catch {
      this.els.formulaBar.textContent = this.appMode === "function" ? `f(z) = ${this.functionExpr}` : "w = z";
    }
  }

  /** Manim `Write`-flavored reveal: glyphs cascade in instead of popping in as a block. */
  private animateFormulaReveal(): void {
    const leaves = Array.from(this.els.formulaBar.querySelectorAll<HTMLElement>(".katex-html *")).filter(
      (el) => el.children.length === 0,
    );
    if (!leaves.length) return;
    gsap.fromTo(
      leaves,
      { opacity: 0, y: 5 },
      { opacity: 1, y: 0, duration: 0.32, ease: resolveEase("manim"), stagger: 0.014 },
    );
  }

  private async computeRawFieldAsync(gen: number): Promise<FieldData> {
    const region = this.region();
    const opts = this.fieldOpts();
    const signal = { isCancelled: () => this.isCancelled(gen) };
    if (this.appMode === "function") {
      return computeFunctionFieldAsync(this.functionExpr, region, opts, this.functionDisplay, signal);
    }
    return computeFieldAsync(this.activeSteps(), region, opts, signal);
  }

  private prepareDisplayField(field: FieldData): FieldData {
    if (this.viewMode === "contour") return fieldToContour(field, "magnitude");
    return field;
  }

  private refreshOverlays(morphT = 1): void {
    const region = this.region();
    if (this.viewMode === "curve") {
      this.scene.updatePipelineCurve(this.pipelineCurvePoints(), morphT);
    } else if (this.viewMode === "grid") {
      const grid = computeGrid(this.activeSteps(), region, 14);
      this.scene.updateGrid(grid.horizontal, grid.vertical, true, morphT);
    } else if (this.viewMode === "func-isolines") {
      const segs = computeIsolines(this.functionExpr, region);
      this.scene.updateIsolines(segs);
    } else if (this.viewMode === "func-curves") {
      const v = this.curveParam;
      const spec = curveFromSpec(this.els.curveSelect.value, { r: v, b: v, a: v });
      const mapped = computeMappedCurve(this.functionExpr, spec);
      this.scene.updateCurves(mapped.zPoints, mapped.wPoints, true, true);
    }
  }

  private async rebuild(animate: boolean): Promise<void> {
    const gen = ++this.rebuildGen;
    const region = this.region();
    this.scene.setRegion(region);
    this.scene.setViewMode(this.viewMode);

    if (this.appMode === "transform") this.renderChain();
    this.renderFormula();
    this.updateViewportHint();

    if (this.viewMode === "curve") {
      const pts = this.pipelineCurvePoints();
      if (animate) await this.morphCurve(pts);
      else this.scene.updatePipelineCurve(pts, 1);
      return;
    }

    if (this.viewMode === "func-isolines") {
      this.setLoading(true);
      await new Promise((r) => setTimeout(r, 0));
      if (this.isCancelled(gen)) return;
      this.refreshOverlays();
      this.setLoading(false);
      return;
    }

    if (this.viewMode === "func-curves") {
      this.setLoading(true);
      try {
        this.refreshOverlays();
        if (this.isCancelled(gen)) return;
        const newField = await this.computeRawFieldAsync(gen);
        if (this.isCancelled(gen)) return;
        this.rawField = newField;
        this.currentField = newField;
        this.scene.updateField(newField);
      } catch {
        if (!this.isCancelled(gen)) console.warn("compute cancelled");
      } finally {
        if (!this.isCancelled(gen)) this.setLoading(false);
      }
      return;
    }

    this.setLoading(true);
    try {
      const newField = await this.computeRawFieldAsync(gen);
      if (this.isCancelled(gen)) return;

      this.rawField = newField;
      const displayField = this.prepareDisplayField(newField);

      if (animate && this.currentField && !this.animating) {
        this.setLoading(false);
        await this.morphFields(this.currentField, displayField);
      } else {
        this.currentField = displayField;
        this.scene.updateField(displayField);
      }

      if (this.isCancelled(gen)) return;
      this.refreshOverlays();
    } catch (e) {
      if (!this.isCancelled(gen)) console.error(e);
    } finally {
      if (!this.isCancelled(gen)) this.setLoading(false);
    }
  }

  private async morphFields(
    from: FieldData,
    to: FieldData,
    gridMorph = true,
    stepMorph?: { fromSteps: TransformStep[]; toSteps: TransformStep[] },
  ): Promise<void> {
    const duration = parseFloat(this.els.duration.value);
    const ease = this.els.easing.value;
    this.animating = true;
    this.morphTween?.kill();

    const state = { t: 0 };
    const easeName = resolveEase(ease);

    const region = this.region();
    const stepGrid =
      stepMorph && gridMorph
        ? {
            from: computeGrid(stepMorph.fromSteps, region, 14),
            to: computeGrid(stepMorph.toSteps, region, 14),
          }
        : null;
    const stepCurve = stepMorph
      ? {
          from: this.pipelineCurvePointsFor(stepMorph.fromSteps, false),
          to: this.pipelineCurvePointsFor(stepMorph.toSteps, false),
        }
      : null;

    await new Promise<void>((resolve) => {
      this.morphTween = gsap.to(state, {
        t: 1,
        duration,
        ease: easeName,
        onUpdate: () => {
          const blended = blendFields(from, to, state.t);
          this.scene.updateField(blended);
          if (gridMorph && this.viewMode === "grid") {
            if (stepGrid) {
              this.scene.updateGridMorph(stepGrid.from, stepGrid.to, state.t);
            } else {
              const grid = computeGrid(this.activeSteps(), region, 14);
              this.scene.updateGrid(grid.horizontal, grid.vertical, true, state.t);
            }
          }
          if (this.viewMode === "curve") {
            if (stepCurve) {
              this.scene.updatePipelineCurveMorph(stepCurve.from, stepCurve.to, state.t);
            } else {
              this.scene.updatePipelineCurve(this.pipelineCurvePoints(), state.t);
            }
          }
        },
        onComplete: () => {
          this.currentField = to;
          this.animating = false;
          this.morphTween = null;
          resolve();
        },
      });
    });
  }

  private async morphCurve(pts: CurvePoint[]): Promise<void> {
    const duration = parseFloat(this.els.duration.value);
    const ease = this.els.easing.value;
    const state = { t: 0 };
    const easeName = resolveEase(ease);
    this.animating = true;
    await new Promise<void>((resolve) => {
      gsap.to(state, {
        t: 1,
        duration,
        ease: easeName,
        onUpdate: () => this.scene.updatePipelineCurve(pts, state.t),
        onComplete: () => {
          this.animating = false;
          resolve();
        },
      });
    });
  }

  private stopAnim = false;

  private async runAnimation(): Promise<void> {
    if (this.animating) {
      this.stopAnim = true;
      this.morphTween?.kill();
      this.animating = false;
      this.els.btnAnimate.textContent = "▶ Анимировать";
      return;
    }

    this.stopAnim = false;
    this.els.btnAnimate.textContent = "■ Стоп";

    if (this.appMode === "transform" && this.playbackMode === "steps" && this.steps.length > 0) {
      await this.runStepChainAnimation();
    } else if (this.viewMode === "curve") {
      await this.runCurveAnimation();
    } else {
      const from = this.appMode === "function"
        ? computeFunctionField("z", this.region(), this.fieldOpts(), this.functionDisplay)
        : computeField([], this.region(), this.fieldOpts());
      const raw = this.appMode === "function"
        ? computeFunctionField(this.functionExpr, this.region(), this.fieldOpts(), this.functionDisplay)
        : computeField(this.activeSteps(), this.region(), this.fieldOpts());
      const to = this.prepareDisplayField(raw);

      while (!this.stopAnim) {
        await this.morphFields(from, to);
        if (!this.els.loopAnim.checked || this.stopAnim) break;
        await this.morphFields(to, from);
      }
    }

    this.els.btnAnimate.textContent = "▶ Анимировать";
  }

  private async runStepChainAnimation(): Promise<void> {
    const region = this.region();
    const opts = this.fieldOpts();
    const n = this.steps.length;

    const fieldAt = (k: number) =>
      this.prepareDisplayField(computeField(this.steps.slice(0, k), region, opts));

    do {
      let prev = fieldAt(0);
      this.playbackStep = 0;
      this.updatePlaybackUI();
      this.scene.updateField(prev);
      this.refreshOverlays(1);

      for (let k = 1; k <= n && !this.stopAnim; k++) {
        const fromSteps = this.steps.slice(0, k - 1);
        const toSteps = this.steps.slice(0, k);
        const next = fieldAt(k);
        this.playbackStep = k - 1;
        this.updatePlaybackUI();
        await this.morphFields(prev, next, true, { fromSteps, toSteps });
        this.playbackStep = k;
        this.updatePlaybackUI();
        prev = next;
        if (this.viewMode === "curve") {
          this.scene.updatePipelineCurve(this.pipelineCurvePoints(), 1);
        } else if (this.viewMode === "grid") {
          const grid = computeGrid(toSteps, region, 14);
          this.scene.updateGrid(grid.horizontal, grid.vertical, true, 1);
        }
      }
    } while (this.els.loopAnim.checked && !this.stopAnim);

    if (!this.stopAnim && this.playbackMode === "full") {
      this.playbackStep = n;
      this.updatePlaybackUI();
    }
  }

  private async runCurveAnimation(): Promise<void> {
    const pts = this.pipelineCurvePoints();
    while (!this.stopAnim) {
      await this.morphCurve(pts);
      if (!this.els.loopAnim.checked || this.stopAnim) break;
      await this.morphCurve(pts);
    }
  }

  private loop(): void {
    this.scene.render();
    requestAnimationFrame(() => this.loop());
  }
}