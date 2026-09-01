/**
 * Turn off React 19's dev-only "Components ⚛" performance track.
 *
 * React logs every component render to the performance timeline in development,
 * serialising each one's props into the entry. Mounting this editor's chrome is ~1700
 * component renders in one commit (every toolbar/menu tooltip is several Radix
 * components), and paying that per render costs about **seven seconds of unbroken
 * main-thread time** on the first paint — long enough that the splash cannot animate a
 * single frame and simply sits there until it is over. Measured here: worst long task
 * 6978 ms → 142 ms, worst frame gap 7033 ms → 167 ms.
 *
 * None of this exists in a production build, which has no long tasks at all; this only
 * makes `npm run dev` behave like the built app.
 *
 * react-dom decides once, while it is being evaluated, whether the track is supported —
 * `typeof console.timeStamp === "function"` is part of that check (see
 * `supportsUserTiming` in react-dom-client.development.js). So the method is removed
 * before react-dom is imported and put straight back afterwards: React's track stays
 * off for the session, and `console.timeStamp` still works for your own profiling.
 *
 * **This module must be imported before react-dom** — ES modules evaluate in import
 * order, and that ordering is the whole mechanism. The restore rides a microtask, which
 * cannot run until the synchronous evaluation of the module graph (react-dom included)
 * has finished.
 *
 * Set `VITE_REACT_TRACKS=1` to keep React's track and profile renders in DevTools.
 */
if (import.meta.env.DEV && import.meta.env.VITE_REACT_TRACKS !== "1") {
  const timeStamp = console.timeStamp;
  if (typeof timeStamp === "function") {
    // @ts-expect-error deliberately hiding an optional console method from react-dom
    delete console.timeStamp;
    queueMicrotask(() => { console.timeStamp = timeStamp; });
  }
}
