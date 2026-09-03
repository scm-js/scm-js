/**
 * The boot splash is the copy of the splash card that lives in `index.html` as plain markup,
 * so something is on screen as soon as the HTML is parsed — before the stylesheet arrives,
 * and long before the module bundle evaluates and React mounts. The desktop shell keeps its
 * window hidden until the renderer's first paint (`desktop/main.ts`), so that node is what
 * decides how soon the window appears at all.
 *
 * `SplashScreen` drops it in a layout effect the moment the real splash has mounted, and
 * `App` drops it on the `?nosplash` path where the real splash never mounts at all.
 */
export function removeBootSplash() {
  document.getElementById("boot-splash")?.remove();
}
