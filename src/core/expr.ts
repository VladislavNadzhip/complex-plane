import {
  C,
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
  csin,
  csqrt,
  csub,
} from "./complex";

export type CompiledExpr = (z: C) => C | null;

type Node =
  | { t: "z" }
  | { t: "c"; re: number; im: number }
  | { t: "op"; op: "+" | "-" | "*" | "^"; a: Node; b: Node }
  | { t: "fn"; name: string; arg: Node };

const cache = new Map<string, CompiledExpr>();

const FNS: Record<string, (a: C) => C | null> = {
  sin: csin,
  cos: ccos,
  exp: cexp,
  log: clog,
  sqrt: csqrt,
  conj: cconj,
  abs: (a) => c(cabs(a), 0),
};

function preprocess(expr: string): string {
  return expr
    .replace(/\s+/g, "")
    .replace(/\*\*/g, "^")
    .replace(/(\d+(?:\.\d+)?)i/g, (_, n) => `{0,${n}}`)
    .replace(/i/g, "{0,1}");
}

function evalNode(n: Node, z: C): C | null {
  switch (n.t) {
    case "z":
      return z;
    case "c":
      return c(n.re, n.im);
    case "fn": {
      const arg = evalNode(n.arg, z);
      const fn = FNS[n.name];
      return arg && fn ? fn(arg) : null;
    }
    case "op": {
      const a = evalNode(n.a, z);
      const b = evalNode(n.b, z);
      if (!a || !b) return null;
      switch (n.op) {
        case "+":
          return cadd(a, b);
        case "-":
          return csub(a, b);
        case "*":
          return cmul(a, b);
        case "^":
          return cpow(a, b.re);
      }
    }
  }
}

class Parser {
  private i = 0;
  constructor(private s: string) {}

  parse(): Node | null {
    try {
      const n = this.parseAdd();
      return n;
    } catch {
      return null;
    }
  }

  private parseAdd(): Node {
    let left = this.parseMul();
    while (this.s[this.i] === "+" || this.s[this.i] === "-") {
      const op = this.s[this.i++] as "+" | "-";
      const right = this.parseMul();
      left = { t: "op", op, a: left, b: right };
    }
    return left;
  }

  private parseMul(): Node {
    let left = this.parsePower();
    let guard = 0;
    while (guard++ < 256) {
      if (this.s[this.i] === "*") {
        this.i++;
        left = { t: "op", op: "*", a: left, b: this.parsePower() };
        continue;
      }
      if (this.s[this.i] === undefined || this.s[this.i] === ")" || this.s[this.i] === "+" || this.s[this.i] === "-") break;
      if (/\d|z|\(|\{/.test(this.s[this.i]!) || this.s.slice(this.i, this.i + 2) === "iz") {
        left = { t: "op", op: "*", a: left, b: this.parsePower() };
        continue;
      }
      break;
    }
    return left;
  }

  private parsePower(): Node {
    let left = this.parsePrimary();
    while (this.s[this.i] === "^") {
      this.i++;
      left = { t: "op", op: "^", a: left, b: this.parsePrimary() };
    }
    return left;
  }

  private parsePrimary(): Node {
    if (this.s[this.i] === "(") {
      this.i++;
      const v = this.parseAdd();
      if (this.s[this.i] === ")") this.i++;
      return v;
    }
    if (this.s[this.i] === "{") {
      this.i++;
      const re = this.readNum();
      if (this.s[this.i] === ",") this.i++;
      const im = this.readNum();
      if (this.s[this.i] === "}") this.i++;
      return { t: "c", re, im };
    }
    if (this.s[this.i] === "z") {
      this.i++;
      return { t: "z" };
    }
    for (const name of Object.keys(FNS)) {
      if (this.s.slice(this.i, this.i + name.length) === name && this.s[this.i + name.length] === "(") {
        this.i += name.length + 1;
        const arg = this.parseAdd();
        if (this.s[this.i] === ")") this.i++;
        return { t: "fn", name, arg };
      }
    }
    return { t: "c", re: this.readNum(), im: 0 };
  }

  private readNum(): number {
    const m = this.s.slice(this.i).match(/^-?\d*\.?\d+/);
    if (!m) return 0;
    this.i += m[0].length;
    return parseFloat(m[0]);
  }
}

export function compileExpression(expr: string): CompiledExpr {
  const key = expr.trim();
  const hit = cache.get(key);
  if (hit) return hit;

  const s = preprocess(key);
  const node = new Parser(s).parse();
  const fn: CompiledExpr = node
    ? (z) => evalNode(node, z)
    : () => null;

  cache.set(key, fn);
  return fn;
}

export function evaluateExpression(expr: string, z: C): C | null {
  return compileExpression(expr)(z);
}