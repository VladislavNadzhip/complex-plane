import { controlsFor, collapseParams, expandParams } from "../core/params";
import { TransformParams } from "../core/transforms";
import { getTransform } from "../core/transforms";

export type ParamChangeHandler = (params: TransformParams) => void;

export function renderParamEditor(
  container: HTMLElement,
  defId: string,
  params: TransformParams,
  onChange: ParamChangeHandler,
  debounceMs = 350,
): void {
  container.innerHTML = "";
  const def = getTransform(defId);
  const ui = expandParams(defId, { ...def.defaults, ...params });
  const controls = controlsFor(defId);

  let timer = 0;
  const emit = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const ui: TransformParams = {};
      container.querySelectorAll("input").forEach((inp) => {
        const key = (inp as HTMLInputElement).dataset.key!;
        const raw = (inp as HTMLInputElement).value;
        ui[key] = inp.type === "range" || /^-?\d*\.?\d+$/.test(raw) ? parseFloat(raw) : raw;
      });
      onChange(collapseParams(defId, ui));
    }, debounceMs);
  };

  if (controls.length === 0) {
    const note = document.createElement("p");
    note.className = "param-hint";
    note.textContent = "Без параметров — просто добавьте в цепочку.";
    container.appendChild(note);
    return;
  }

  for (const ctrl of controls) {
    const wrap = document.createElement("label");
    wrap.className = "param-label";

    if (ctrl.kind === "slider") {
      const val = Number(ui[ctrl.key] ?? ctrl.min ?? 0);
      wrap.innerHTML = `${ctrl.label} <span data-val="${ctrl.key}">${val}</span>`;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(ctrl.min ?? -5);
      input.max = String(ctrl.max ?? 5);
      input.step = String(ctrl.step ?? 0.1);
      input.value = String(val);
      input.dataset.key = ctrl.key;
      input.addEventListener("input", () => {
        const span = wrap.querySelector(`[data-val="${ctrl.key}"]`);
        if (span) span.textContent = input.value;
        emit();
      });
      wrap.appendChild(input);
    } else {
      wrap.innerHTML = `${ctrl.label}`;
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(ui[ctrl.key] ?? "");
      input.dataset.key = ctrl.key;
      input.addEventListener("input", emit);
      wrap.appendChild(input);
    }
    container.appendChild(wrap);
  }
}

