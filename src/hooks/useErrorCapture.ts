/**
 * Everything the page throws that nothing caught, into the log.
 *
 * This is the tap that pays for the rest of it. A plugin that throws inside an event
 * listener, a promise nobody awaited, a render that fell over — none of them reach a
 * toast, and until now none of them reached anywhere a user could look. The editor's
 * behaviour is unchanged: the handlers only listen, they never prevent the default, so
 * the browser still reports the error the way it always did.
 *
 * The two listeners cover different halves: `error` is a synchronous throw (and, with a
 * different event shape, a resource that failed to load — filtered out here, since a
 * missing image is not an editor fault and there is one per absent tileset), and
 * `unhandledrejection` is a promise that rejected with nobody watching, which is the
 * shape most of the plugin API's failures take.
 *
 * `App` mounts it beside the other startup hooks, above the chrome, so it is listening
 * before the first plugin runs.
 */
import { useEffect } from "react";
import { log, logError } from "../editor/log";

// React's development double-mount runs the effect twice; the line belongs to the session.
let announced = false;

export function useErrorCapture() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // A failed <img>/<script> load fires an Event, not an ErrorEvent, at the element;
      // it has no `message` and is not what this is for.
      if (!e.message && !e.error) return;
      const where = e.filename ? `${e.filename.split("/").pop()}:${e.lineno}` : undefined;
      logError("app", "Uncaught error", e.error ?? e.message, { at: where });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      logError("app", "Unhandled promise rejection", e.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    if (!announced) { announced = true; log("info", "app", "Editor started"); }
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
}
