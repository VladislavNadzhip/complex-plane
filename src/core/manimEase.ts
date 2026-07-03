import gsap from "gsap";

/**
 * Ports of Manim Community's rate_functions (manim/utils/rate_functions.py).
 * `smooth` is the exact quintic smoothstep Manim uses for its default
 * interpolation; rush_into/rush_from are its asymmetric ease variants.
 */
function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function rushInto(t: number): number {
  return 2 * smooth(t / 2);
}

function rushFrom(t: number): number {
  return 2 * smooth(t / 2 + 0.5) - 1;
}

export const MANIM_EASE_NAMES = {
  smooth: "manimSmooth",
  rushInto: "manimRushInto",
  rushFrom: "manimRushFrom",
} as const;

/** Maps <select> values from the UI onto registered gsap ease names. */
export const EASE_SELECT_MAP: Record<string, string> = {
  manim: MANIM_EASE_NAMES.smooth,
  manim_rush_into: MANIM_EASE_NAMES.rushInto,
  manim_rush_from: MANIM_EASE_NAMES.rushFrom,
};

let registered = false;

export function registerManimEases(): void {
  if (registered) return;
  registered = true;
  gsap.registerEase(MANIM_EASE_NAMES.smooth, smooth);
  gsap.registerEase(MANIM_EASE_NAMES.rushInto, rushInto);
  gsap.registerEase(MANIM_EASE_NAMES.rushFrom, rushFrom);
}

export function resolveEase(value: string): string {
  return EASE_SELECT_MAP[value] ?? value;
}
