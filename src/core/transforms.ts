import {
  C,
  C0,
  C1,
  c,
  cabs,
  cadd,
  cconj,
  ccos,
  cdiv,
  cexp,
  clog,
  cmul,
  cpow,
  cscale,
  csin,
  csqrt,
  csub,
} from "./complex";
import { compileExpression } from "./expr";

export type TransformParams = Record<string, number | string>;

export interface TransformDef {
  id: string;
  name: string;
  latex: string;
  defaults: TransformParams;
  apply: (z: C, p: TransformParams) => C | null;
}

export interface TransformStep {
  id: string;
  defId: string;
  params: TransformParams;
}

function mobius(z: C, p: TransformParams): C | null {
  const a = parseC(p.a, C1);
  const b = parseC(p.b, C0);
  const cc = parseC(p.c, C0);
  const d = parseC(p.d, C1);
  return cdiv(cadd(cmul(a, z), b), cadd(cmul(cc, z), d));
}

function parseC(v: number | string | undefined, fallback: C): C {
  if (typeof v === "string") {
    const t = v.trim();
    if (t.includes("i") || t.includes("j") || /[+-]/.test(t.slice(1))) {
      const s = t.replace(/j/g, "i");
      const re = parseFloat(s.split(/[+-]/)[0]) || 0;
      const imPart = s.match(/([+-]?\d*\.?\d*)i/);
      const im = imPart
        ? imPart[1] === "" || imPart[1] === "+"
          ? 1
          : imPart[1] === "-"
            ? -1
            : parseFloat(imPart[1])
        : 0;
      return c(re, im);
    }
  }
  if (typeof v === "number") return c(v, 0);
  return fallback;
}

export const TRANSFORMS: TransformDef[] = [
  {
    id: "identity",
    name: "Тождество",
    latex: "w = z",
    defaults: {},
    apply: (z) => z,
  },
  {
    id: "shift",
    name: "Сдвиг",
    latex: "w = z + c",
    defaults: { c: "0+0i" },
    apply: (z, p) => cadd(z, parseC(p.c, c(0.5, 0.3))),
  },
  {
    id: "rotate",
    name: "Поворот",
    latex: "w = e^{i\\theta} z",
    defaults: { angle: 45 },
    apply: (z, p) => {
      const th = ((p.angle as number) * Math.PI) / 180;
      return { re: z.re * Math.cos(th) - z.im * Math.sin(th), im: z.re * Math.sin(th) + z.im * Math.cos(th) };
    },
  },
  {
    id: "scale",
    name: "Масштаб",
    latex: "w = kz",
    defaults: { k: 1.2 },
    apply: (z, p) => cscale(z, p.k as number),
  },
  {
    id: "joukowski",
    name: "Жуковского",
    latex: "w = z + \\frac{1}{z}",
    defaults: {},
    apply: (z) => {
      const inv = cdiv(C1, z);
      return inv ? cadd(z, inv) : null;
    },
  },
  {
    id: "power",
    name: "Степень",
    latex: "w = z^n",
    defaults: { n: 2 },
    apply: (z, p) => cpow(z, p.n as number),
  },
  {
    id: "exp",
    name: "exp",
    latex: "w = e^z",
    defaults: {},
    apply: (z) => cexp(z),
  },
  {
    id: "log",
    name: "log",
    latex: "w = \\log z",
    defaults: {},
    apply: (z) => clog(z),
  },
  {
    id: "sqrt",
    name: "sqrt",
    latex: "w = \\sqrt{z}",
    defaults: {},
    apply: (z) => csqrt(z),
  },
  {
    id: "reciprocal",
    name: "1/z",
    latex: "w = \\frac{1}{z}",
    defaults: {},
    apply: (z) => cdiv(C1, z),
  },
  {
    id: "sin",
    name: "sin",
    latex: "w = \\sin z",
    defaults: {},
    apply: (z) => csin(z),
  },
  {
    id: "cos",
    name: "cos",
    latex: "w = \\cos z",
    defaults: {},
    apply: (z) => ccos(z),
  },
  {
    id: "conjugate",
    name: "Сопряжение",
    latex: "w = \\overline{z}",
    defaults: {},
    apply: (z) => cconj(z),
  },
  {
    id: "mobius",
    name: "Мёбиус",
    latex: "w = \\frac{az+b}{cz+d}",
    defaults: { a: "1", b: "i", c: "1", d: "-1" },
    apply: mobius,
  },
  {
    id: "custom",
    name: "Формула",
    latex: "w = f(z)",
    defaults: { expr: "z*z" },
    apply: (z, p) => compileExpression(String(p.expr))(z),
  },
];

export const PRESETS: { name: string; steps: { defId: string; params?: TransformParams }[] }[] = [
  { name: "Жуковского", steps: [{ defId: "joukowski" }] },
  { name: "z²", steps: [{ defId: "power", params: { n: 2 } }] },
  { name: "exp(z)", steps: [{ defId: "exp" }] },
  { name: "Сдвиг→Поворот", steps: [{ defId: "shift", params: { c: "1+0.5i" } }, { defId: "rotate", params: { angle: 30 } }] },
  { name: "Мёбиус", steps: [{ defId: "mobius", params: { a: "1", b: "i", c: "1", d: "-1" } }] },
  { name: "z³−1", steps: [{ defId: "custom", params: { expr: "z*z*z - {1,0}" } }] },
];

export function getTransform(id: string): TransformDef {
  const t = TRANSFORMS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown transform: ${id}`);
  return t;
}

export function applyPipeline(z: C, steps: TransformStep[]): C | null {
  let w: C | null = z;
  for (const step of steps) {
    if (w === null) return null;
    const def = getTransform(step.defId);
    w = def.apply(w, step.params);
  }
  return w;
}

export function stepLabel(step: TransformStep): string {
  const def = getTransform(step.defId);
  const parts = Object.entries(step.params).map(([k, v]) => `${k}=${v}`);
  return parts.length ? `${def.name}(${parts.join(", ")})` : def.name;
}

export function pipelineLatex(steps: TransformStep[]): string {
  if (!steps.length) return "w = z";
  return steps.map((s) => getTransform(s.defId).latex.replace("w = ", "")).join(" \\circ ");
}

export { compileExpression, evaluateExpression } from "./expr";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}