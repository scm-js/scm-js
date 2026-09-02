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
import type { CheckboxOptions, ListItem, ListOptions, NumberFieldOptions, SelectOption, SelectOptions, TextFieldOptions, WidgetsApi } from "./api";

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

export function createWidgets(): WidgetsApi {
  const widgets: WidgetsApi = {
    button: (label, options = {}) => {
      const button = el("button", {
        type: "button",
        className: classes("btn", options.primary && "primary", options.danger && "danger", options.ghost && "ghost", options.className),
        title: options.title,
        disabled: options.disabled ?? false,
      }, label);
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
  };
  return widgets;
}
