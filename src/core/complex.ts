export type C = { re: number; im: number };

export const c = (re: number, im = 0): C => ({ re, im });

export const C0 = c(0, 0);
export const C1 = c(1, 0);

export function cadd(a: C, b: C): C {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function csub(a: C, b: C): C {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function cmul(a: C, b: C): C {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function cdiv(a: C, b: C): C | null {
  const d = b.re * b.re + b.im * b.im;
  if (d < 1e-24) return null;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export function cscale(a: C, k: number): C {
  return { re: a.re * k, im: a.im * k };
}

export function cabs(a: C): number {
  return Math.hypot(a.re, a.im);
}

export function carg(a: C): number {
  return Math.atan2(a.im, a.re);
}

export function cexp(a: C): C {
  const r = Math.exp(a.re);
  return { re: r * Math.cos(a.im), im: r * Math.sin(a.im) };
}

export function clog(a: C): C | null {
  const m = cabs(a);
  if (m < 1e-24) return null;
  return { re: Math.log(m), im: carg(a) };
}

export function csqrt(a: C): C | null {
  const m = cabs(a);
  if (m < 1e-24) return C0;
  const r = Math.sqrt(m);
  const theta = carg(a) / 2;
  return { re: r * Math.cos(theta), im: r * Math.sin(theta) };
}

export function cpow(a: C, n: number): C | null {
  if (cabs(a) < 1e-24 && n < 0) return null;
  const m = Math.pow(cabs(a), n);
  const theta = carg(a) * n;
  return { re: m * Math.cos(theta), im: m * Math.sin(theta) };
}

export function csin(a: C): C {
  return {
    re: Math.sin(a.re) * Math.cosh(a.im),
    im: Math.cos(a.re) * Math.sinh(a.im),
  };
}

export function ccos(a: C): C {
  return {
    re: Math.cos(a.re) * Math.cosh(a.im),
    im: -Math.sin(a.re) * Math.sinh(a.im),
  };
}

export function cconj(a: C): C {
  return { re: a.re, im: -a.im };
}

export function lerpC(a: C, b: C, t: number): C {
  return { re: a.re + (b.re - a.re) * t, im: a.im + (b.im - a.im) * t };
}

export function parseComplex(s: string): C {
  const t = s.trim().replace(/i/g, "j").replace(/j/g, "i");
  if (t.includes("i")) {
    const m = t.match(/^([+-]?\d*\.?\d*)?([+-]?\d*\.?\d*)i$/);
    if (m) {
      const im = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : parseFloat(m[1]);
      const re = m[2] ? parseFloat(m[2]) : 0;
      return c(re, im);
    }
    const parts = t.split(/(?=[+-])/);
    let re = 0;
    let im = 0;
    for (const p of parts) {
      if (p.includes("i")) {
        const n = p.replace("i", "");
        im = n === "" || n === "+" ? 1 : n === "-" ? -1 : parseFloat(n);
      } else re = parseFloat(p);
    }
    return c(re, im);
  }
  return c(parseFloat(t), 0);
}

export function formatComplex(z: C, digits = 3): string {
  const re = z.re.toFixed(digits);
  const im = Math.abs(z.im).toFixed(digits);
  if (Math.abs(z.im) < 1e-9) return re;
  if (Math.abs(z.re) < 1e-9) return `${z.im.toFixed(digits)}i`;
  const sign = z.im >= 0 ? "+" : "-";
  return `${re}${sign}${im}i`;
}