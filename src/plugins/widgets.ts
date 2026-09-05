/**
 * The widget kit behind `api.ui.el` and `api.ui.widgets`.
 *
 * A plugin mounts plain DOM into its dialogs and panels, which meant every one of them
 * re-invented a button and a labelled field — and got the editor's look slightly wrong.
 * These builders emit exactly the markup and class names `styles/ui.css` styles
 * (`.btn`, `.input`, `.check` + a bare checkbox, `.form` as a two-column grid, `.group`
 * as a fieldset with a legend, `.listbox` of `.item`s), so a plugin's panel looks like
 * the panels beside it.
 *
 * Nothing here touches the store or React: it is a DOM helper library, tested as one.
 */
import type { BusyHandle, BusyOptions, ButtonElement, CheckboxOptions, ListItem, ListOptions, NumberFieldOptions, ProgressBarElement, ProgressBarOptions, SelectOption, SelectOptions, SkeletonOptions, SpinnerOptions, StatusLineElement, StatusLineOptions, TextFieldOptions, WidgetsApi } from "./api";

/** Attributes `el` maps onto the element rather than setting as a property. */
const ATTRS = new Set(["type", "role", "name", "placeholder", "min", "max", "step", "colspan", "rowspan", "for", "href", "target", "src", "alt", "aria-label"]);

export type ElChild = Node | string | number | null | undefined | false;

/**
 * `el("div", { className: "row" }, el("span", {}, "hi"))` — the tiny hyperscript the kit
 * is built from. `style` takes an object, `on*` keys take listeners, everything else is
 * a property when the element has one and an attribute otherwise.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === "style" && typeof value === "object") Object.assign(node.style, value as Partial<CSSStyleDeclaration>);
    else if (key === "style") node.setAttribute("style", String(value));
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (ATTRS.has(key) || key.includes("-")) node.setAttribute(key, String(value));
    else (node as unknown as Record<string, unknown>)[key] = value;
  }
  append(node, children);
  return node;
}

function append(node: HTMLElement, children: ElChild[]) {
  for (const child of children.flat(4) as ElChild[]) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
}

const classes = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

/** The cover `widgets.busy` put over a box, so a second call only changes its label. */
const covers = new WeakMap<HTMLElement, BusyHandle>();

export function createWidgets(): WidgetsApi {
  const widgets: WidgetsApi = {
    button: (label, options = {}) => {
      const ring = el("span", { className: "spinner sm", "aria-hidden": "true" });
      const button = el("button", {
        type: "button",
        className: classes("btn", options.primary && "primary", options.danger && "danger", options.ghost && "ghost", options.className),
        title: options.title,
        disabled: options.disabled ?? false,
      }, label) as ButtonElement;
      // The ring goes in front of the label and the button stops answering: a press that
      // started work should not be repeatable, and should say why it is not.
      button.setBusy = (busy: boolean) => {
        if (busy === button.contains(ring)) return;
        if (busy) button.prepend(ring);
        else ring.remove();
        button.disabled = busy || (options.disabled ?? false);
        button.setAttribute("aria-busy", busy ? "true" : "false");
      };
      if (options.busy) button.setBusy(true);
      if (options.onClick) button.addEventListener("click", (ev) => options.onClick!(ev as MouseEvent));
      return button;
    },

    checkbox: (label, options: CheckboxOptions = {}) => {
      const input = el("input", { type: options.radio ? "radio" : "checkbox", name: options.name, checked: options.value ?? false, disabled: options.disabled ?? false });
      if (options.onChange) input.addEventListener("change", () => options.onChange!(input.checked));
      const wrap = el("label", { className: classes("check", options.className), title: options.title }, input, el("span", {}, label));
      // The caller wants the input, not the label, when it needs to read or set the value later.
      (wrap as HTMLLabelElement & { input: HTMLInputElement }).input = input;
      return wrap as HTMLLabelElement & { input: HTMLInputElement };
    },

    text: (options: TextFieldOptions = {}) => {
      const input = el("input", {
        type: options.password ? "password" : "text",
        className: classes("input", options.className),
        value: options.value ?? "",
        placeholder: options.placeholder,
        title: options.title,
        disabled: options.disabled ?? false,
      });
      if (options.onChange) input.addEventListener("input", () => options.onChange!(input.value));
      return input;
    },

    number: (options: NumberFieldOptions = {}) => {
      const input = el("input", {
        type: "number",
        className: classes("input", "number", options.className),
        value: String(options.value ?? 0),
        min: options.min,
        max: options.max,
        step: options.step,
        title: options.title,
        disabled: options.disabled ?? false,
      });
      if (options.onChange) input.addEventListener("input", () => { const n = Number(input.value); if (!Number.isNaN(n)) options.onChange!(n); });
      return input;
    },

    select: (items: SelectOption[], options: SelectOptions = {}) => {
      const select = el("select", { className: classes("select", options.className), title: options.title, disabled: options.disabled ?? false });
      for (const item of items) select.append(el("option", { value: String(item.value), disabled: item.disabled ?? false }, item.label));
      if (options.value !== undefined) select.value = String(options.value);
      if (options.onChange) select.addEventListener("change", () => options.onChange!(select.value));
      return select;
    },

    form: (rows) => {
      const form = el("div", { className: "form wide" });
      for (const row of rows) {
        if (!row) continue;
        form.append(el("label", {}, row.label), row.field);
      }
      return form;
    },

    group: (title, ...children) => {
      const box = el("fieldset", { className: "group" }, el("legend", {}, title));
      append(box, children);
      return box;
    },

    row: (...children) => { const node = el("div", { className: "row" }); append(node, children); return node; },
    column: (...children) => { const node = el("div", { className: "col" }); append(node, children); return node; },
    hint: (text) => el("div", { className: "hint" }, text),
    separator: () => el("div", { className: "sep-h" }),

    list: <T,>(items: ListItem<T>[], options: ListOptions<T> = {}) => {
      const box = el("div", { className: classes("listbox", options.className), tabIndex: 0 });
      if (options.height) box.style.maxHeight = `${options.height}px`;
      items.forEach((item, i) => {
        const row = el("div", {
          className: classes("item", options.selected !== undefined && options.selected === i && "selected"),
          title: item.title,
        }, item.index !== undefined && el("span", { className: "idx" }, String(item.index)), el("span", { className: "grow" }, item.label), item.hint && el("span", { className: "dim" }, item.hint));
        if (options.onPick) {
          row.addEventListener("click", () => {
            for (const other of box.children) other.classList.remove("selected");
            row.classList.add("selected");
            options.onPick!(item.value, i);
          });
        }
        box.append(row);
      });
      return box;
    },

    /* ── Waiting ──
       One vocabulary for "an answer is on its way", so a plugin's dialog waits the way
       the editor's own do. The classes are `styles/ui.css`'s; nothing here animates in
       JavaScript, so a reduced-motion setting is honoured by the stylesheet alone. */

    spinner: (options: SpinnerOptions = {}) => {
      const size = options.size ?? "md";
      const ring = el("span", {
        className: classes("spinner", size !== "md" && size, !options.label && options.className),
        // On its own it is the only thing saying "working"; beside a label the label says it.
        "aria-hidden": options.label ? "true" : undefined,
        role: options.label ? undefined : "progressbar",
        "aria-label": options.label ? undefined : "Working",
        title: options.label ? undefined : options.title,
      });
      if (!options.label) return ring;
      return el("span", { className: classes("spinner-row", options.className), title: options.title }, ring, el("span", {}, options.label));
    },

    progressBar: (options: ProgressBarOptions = {}) => {
      const fill = el("i", {});
      const track = el("div", { className: "progress-track", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
      const percent = el("span", { className: "dim mono percent" }, "");
      const line = el("div", { className: "hint" }, "");
      const box = el("div", { className: classes("progress", options.className), title: options.title }, el("div", { className: "row" }, track, percent), line) as unknown as ProgressBarElement;
      if (options.width) box.style.width = `${options.width}px`;
      let last = -1;
      box.set = (value, label) => {
        const known = value !== null && value !== undefined && Number.isFinite(value);
        const share = known ? Math.max(0, Math.min(1, value as number)) : 0;
        track.classList.toggle("sliding", !known);
        if (known) {
          // A download reports per chunk; repainting for a move nobody can see costs more than it shows.
          if (Math.abs(share - last) >= 0.005 || share === 1) {
            last = share;
            fill.style.width = `${(share * 100).toFixed(1)}%`;
            percent.textContent = `${Math.round(share * 100)}%`;
            track.setAttribute("aria-valuenow", String(Math.round(share * 100)));
          }
        } else {
          last = -1;
          fill.style.width = "";
          percent.textContent = "";
          track.removeAttribute("aria-valuenow");
        }
        percent.hidden = !known || options.percent === false;
        if (label !== undefined) line.textContent = label;
        line.hidden = !line.textContent;
      };
      box.set(options.value ?? null, options.label ?? "");
      return box;
    },

    statusLine: (options: StatusLineOptions = {}) => {
      const ring = el("span", { className: "spinner sm", "aria-hidden": "true" });
      const text = el("span", { className: "grow" }, options.text ?? "");
      const fill = el("i", {});
      const track = el("div", { className: "progress-track", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" }, fill);
      const cancelBtn = widgets.button("Cancel", { className: "sm" });
      let stopper: (() => void) | null = null;
      cancelBtn.addEventListener("click", () => stopper?.());
      const line = el("div", { className: classes("status-line", options.className), role: "status", "aria-live": "polite", title: options.title }, ring, text, track, cancelBtn);
      ring.hidden = true;
      track.hidden = true;
      cancelBtn.hidden = true;

      const paint = (message: string | Node, kind: string, spin: boolean, value: number | null) => {
        line.className = classes("status-line", kind, options.className);
        if (typeof message !== "string") text.replaceChildren(message);
        else if (text.textContent !== message || text.firstElementChild) text.textContent = message;
        ring.hidden = !spin;
        track.hidden = value === null;
        if (value !== null) {
          const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
          fill.style.width = `${pct}%`;
          track.setAttribute("aria-valuenow", String(pct));
        }
        line.setAttribute("aria-busy", spin ? "true" : "false");
        // A bar moves far too often to read out; the line either side of it is what matters.
        line.setAttribute("aria-live", value === null ? "polite" : "off");
      };

      const node = line as unknown as StatusLineElement;
      node.set = (message, kind) => paint(message, kind ?? "", false, null);
      node.busy = (message) => paint(message, "", true, null);
      node.progress = (message, value) => paint(message, "", true, value);
      node.clear = () => paint("", "", false, null);
      node.cancel = (stop, label) => { stopper = stop; cancelBtn.hidden = !stop; cancelBtn.textContent = label ?? "Cancel"; };
      return node;
    },

    skeleton: (options: SkeletonOptions = {}) => {
      const height = options.height ?? (options.block ? 44 : 10);
      const one = (width: string, className?: string) =>
        el("span", { className: classes("skeleton", options.block && "block", className), style: { width, height: `${height}px` } });
      const lines = Math.max(1, options.lines ?? 1);
      if (lines === 1) return one(options.width ?? "100%", options.className);
      // Text ends short, so the last line does too — a block of equal bars reads as a table.
      const rows = Array.from({ length: lines }, (_, i) => one(options.width ?? (i === lines - 1 ? "60%" : "100%")));
      return el("div", { className: classes("skeleton-lines", options.className) }, ...rows);
    },

    busy: (target: HTMLElement, options: BusyOptions | string = {}): BusyHandle => {
      const o = typeof options === "string" ? { label: options } : options;
      const open = covers.get(target);
      if (open) {
        if (o.label !== undefined) open.set(o.label);
        return open;
      }
      const label = el("span", {}, o.label ?? "");
      const cover = el("div", { className: classes("busy-cover", o.dim === false && "no-dim"), "aria-hidden": "true" },
        el("div", { className: "busy-note" }, el("span", { className: "spinner sm" }), label));
      // A cover is absolute, so it needs a positioned box that does not scroll under it —
      // hence the wrapper, which takes the target's place and gives it back on `done`.
      const parent = target.parentElement;
      const wrap = parent ? el("div", { className: "busy-box" }) : null;
      if (wrap && parent) {
        parent.insertBefore(wrap, target);
        wrap.append(target, cover);
      } else {
        // Not mounted yet: the cover goes inside, which asks the box itself to position it.
        if (!target.style.position) target.style.position = "relative";
        target.append(cover);
      }
      target.classList.add("is-busy");
      target.setAttribute("aria-busy", "true");
      let done = false;
      const handle: BusyHandle = {
        set: (text) => { label.textContent = text; },
        done: () => {
          if (done) return;
          done = true;
          covers.delete(target);
          cover.remove();
          target.classList.remove("is-busy");
          target.setAttribute("aria-busy", "false");
          if (wrap?.parentElement) { wrap.replaceWith(target); }
        },
      };
      covers.set(target, handle);
      return handle;
    },
  };
  return widgets;
}
