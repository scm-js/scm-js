/**
 * Preferences ▸ View ▸ Interface size, on the page. The size is a CSS `zoom` on each surface
 * of the chrome and never on the map (`styles/size.css` says which and why); this file puts
 * the switch for those rules on the root and answers how much an element is zoomed.
 *
 * `index.html` does the same as `applyInterfaceSize` in an inline script before anything
 * paints, so the boot splash and the first frame are already at the size; keep the two in
 * step (`tests/interfaceSize.test.ts` runs that script).
 */
import { interfaceZoom } from "./preferences";

/** The attribute `styles/size.css` keys on, holding the size in percent. */
export const SIZE_ATTRIBUTE = "data-ui-size";

/** What `applyInterfaceSize` touches: the document's root element in the editor. */
export interface SizeRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

/** Put an interface size on the page. At 100% the attribute and `--ui-zoom` are taken off, so no rule of `size.css` applies. */
export function applyInterfaceSize(size: unknown, root: SizeRoot = document.documentElement): void {
  const zoom = interfaceZoom(size);
  if (zoom === 1) {
    root.removeAttribute(SIZE_ATTRIBUTE);
    root.style.removeProperty("--ui-zoom");
  } else {
    root.setAttribute(SIZE_ATTRIBUTE, String(size));
    root.style.setProperty("--ui-zoom", String(zoom));
  }
}

/**
 * How much `el` is zoomed, all its ancestors' zooms multiplied: 1 at 100%, and anywhere on
 * the map. Pointer positions and `getBoundingClientRect` are page pixels, while an element's
 * own lengths (`clientWidth`, a `style.width`) are its own, so a distance taken from the
 * pointer is divided by this before it becomes one of the element's lengths.
 */
export function zoomOf(el: Element | null | undefined): number {
  const z = (el as { currentCSSZoom?: number } | null | undefined)?.currentCSSZoom;
  return typeof z === "number" && z > 0 ? z : 1;
}
