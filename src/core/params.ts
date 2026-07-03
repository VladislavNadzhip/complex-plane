import { TransformParams } from "./transforms";
import { c, formatComplex, parseComplex } from "./complex";

export interface ParamControl {
  key: string;
  label: string;
  kind: "slider" | "text" | "complex";
  min?: number;
  max?: number;
  step?: number;
}

const CONTROLS: Record<string, ParamControl[]> = {
  shift: [
    { key: "c_re", label: "Re(c)", kind: "slider", min: -5, max: 5, step: 0.05 },
    { key: "c_im", label: "Im(c)", kind: "slider", min: -5, max: 5, step: 0.05 },
  ],
  rotate: [{ key: "angle", label: "Угол °", kind: "slider", min: -360, max: 360, step: 1 }],
  scale: [{ key: "k", label: "k", kind: "slider", min: 0.05, max: 5, step: 0.05 }],
  power: [{ key: "n", label: "n", kind: "slider", min: -6, max: 8, step: 0.25 }],
  mobius: [
    { key: "a", label: "a", kind: "text" },
    { key: "b", label: "b", kind: "text" },
    { key: "c", label: "c", kind: "text" },
    { key: "d", label: "d", kind: "text" },
  ],
  custom: [{ key: "expr", label: "f(z)", kind: "text" }],
};

export function controlsFor(defId: string): ParamControl[] {
  return CONTROLS[defId] ?? [];
}

/** Expand stored params into UI-friendly values (split complex c). */
export function expandParams(defId: string, params: TransformParams): TransformParams {
  const out = { ...params };
  if (defId === "shift") {
    const z = parseComplex(String(params.c ?? "0"));
    out.c_re = z.re;
    out.c_im = z.im;
  }
  return out;
}

/** Collapse UI values back into transform params. */
export function collapseParams(defId: string, ui: TransformParams): TransformParams {
  const out = { ...ui };
  if (defId === "shift") {
    const re = Number(ui.c_re ?? 0);
    const im = Number(ui.c_im ?? 0);
    out.c = formatComplex(c(re, im));
    delete out.c_re;
    delete out.c_im;
  }
  return out;
}

export function defaultUiParams(defId: string, defaults: TransformParams): TransformParams {
  return expandParams(defId, defaults);
}