/**
 * `ui.confirm` / `ui.alert` / `ui.prompt` / `ui.progress`.
 *
 * The browser's own `confirm` and `prompt` are blocking, unstyled and — in a page that
 * is mostly one canvas — jarring; every plugin that needed a yes/no therefore built a
 * dialog by hand. These are that dialog, once, over the plugin dialog and panel the host
 * already provides, so they carry the plugin's icon and stack like everything else.
 *
 * A dismissal (Escape, the ×, the backdrop) resolves the same way Cancel does. There is
 * no button click to hang that on, so it is the dialog body's unmount cleanup that
 * settles the promise — whichever way the dialog goes, `mount`'s cleanup runs once.
 */
import { createWidgets, el } from "./widgets";
import type { ConfirmOptions, DialogHandle, DialogSpec, PanelHandle, PanelSpec, ProgressHandle, ProgressOptions, PromptOptions } from "./api";

type OpenDialog = (spec: DialogSpec) => DialogHandle;
type OpenPanel = (spec: PanelSpec) => PanelHandle;

const w = createWidgets();

/** The message, split on blank lines so a plugin can pass a short paragraph. */
function message(text: string): HTMLElement {
  const box = el("div", { className: "col", style: { gap: "8px", maxWidth: "52ch" } });
  for (const part of text.split(/\n{2,}/)) box.append(el("div", { style: { whiteSpace: "pre-wrap" } }, part));
  return box;
}

export function confirmDialog(open: OpenDialog, text: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    let settle = () => resolve(answer);
    open({
      title: options.title ?? "Confirm",
      size: "sm",
      mount: (body) => {
        body.append(message(text));
        return () => { settle(); settle = () => {}; };
      },
      buttons: [
        { label: options.cancelLabel ?? "Cancel" },
        { label: options.confirmLabel ?? "OK", primary: true, run: () => { answer = true; } },
      ],
    });
  });
}

export function alertDialog(open: OpenDialog, text: string, options: ConfirmOptions = {}): Promise<void> {
  return new Promise((resolve) => {
    let settle = () => resolve();
    open({
      title: options.title ?? "Note",
      size: "sm",
      mount: (body) => {
        body.append(message(text));
        return () => { settle(); settle = () => {}; };
      },
      buttons: [{ label: options.confirmLabel ?? "OK", primary: true }],
    });
  });
}

export function promptDialog(open: OpenDialog, text: string, options: PromptOptions = {}): Promise<string | null> {
  return new Promise((resolve) => {
    let value = options.value ?? "";
    let answer: string | null = null;
    let settle = () => resolve(answer);
    open({
      title: options.title ?? "Enter a value",
      size: "sm",
      mount: (body, dialog) => {
        const field = options.multiline
          ? el("textarea", { className: "textarea", rows: 4, placeholder: options.placeholder, value })
          : w.text({ value, placeholder: options.placeholder });
        field.addEventListener("input", () => { value = (field as HTMLInputElement | HTMLTextAreaElement).value; });
        if (!options.multiline) {
          // Enter is the OK button, as it is in the editor's own single-field dialogs.
          field.addEventListener("keydown", (ev) => {
            if ((ev as KeyboardEvent).key !== "Enter") return;
            ev.preventDefault();
            answer = value;
            dialog.close();
          });
        }
        body.append(el("div", { className: "col", style: { gap: "10px" } }, message(text), field));
        // The dialog frame mounts a commit after this call, so focus on the next tick.
        setTimeout(() => field.focus(), 0);
        return () => { settle(); settle = () => {}; };
      },
      buttons: [
        { label: options.cancelLabel ?? "Cancel" },
        { label: options.confirmLabel ?? "OK", primary: true, run: () => { answer = value; } },
      ],
    });
  });
}

export function progressPanel(open: OpenPanel, label: string, options: ProgressOptions = {}): ProgressHandle {
  let cancelled = false;
  let closed = false;
  /** `done()` closes the panel itself: that must not read as the user cancelling. */
  let finishing = false;
  let fill: HTMLElement | null = null;
  let line: HTMLElement | null = null;
  let percent: HTMLElement | null = null;
  let last = 0;

  const panel = open({
    title: options.title ?? label,
    width: 280,
    mount: (body) => {
      const bar = el("div", {
        style: {
          position: "relative", height: "10px", borderRadius: "5px", overflow: "hidden",
          background: "var(--bg-0)", border: "1px solid var(--border)",
        },
      });
      fill = el("div", { style: { height: "100%", width: "0%", background: "var(--gold)", transition: "width 90ms linear" } });
      bar.append(fill);
      percent = el("span", { className: "dim mono" }, "0%");
      line = el("div", { className: "hint", style: { minHeight: "14px" } }, "");
      const head = el("div", { className: "row between" }, el("span", {}, label), percent);
      const rows: (HTMLElement | false)[] = [head, bar, line];
      if (options.cancellable) {
        rows.push(el("div", { className: "row end" }, w.button("Cancel", { onClick: () => { cancelled = true; } })));
      }
      body.append(el("div", { className: "col", style: { gap: "8px" } }, ...rows));
      return () => { closed = true; };
    },
    onClose: () => { if (!finishing) cancelled = true; closed = true; },
  });

  return {
    report: (fraction, text) => {
      const value = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
      // Repainting a bar hundreds of times a second costs more than it shows.
      if (fill && Math.abs(value - last) >= 0.005) {
        last = value;
        fill.style.width = `${(value * 100).toFixed(1)}%`;
        if (percent) percent.textContent = `${Math.round(value * 100)}%`;
      }
      if (text !== undefined && line) line.textContent = text;
    },
    cancelled: () => cancelled,
    done: () => { finishing = true; if (!closed) panel.close(); closed = true; },
    isOpen: () => !closed && panel.isOpen(),
  };
}
