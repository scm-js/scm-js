/**
 * What keeps one part of the editor's failure from being the whole editor's.
 *
 * React unmounts the entire tree when a render throws and nothing catches it — the map,
 * the menus and the Debug Console with them, so the one place that could say what happened
 * is gone too. A boundary swaps in a fallback for the part that threw and leaves the rest
 * running: the panels and the map each have one (`Guarded`), every dialog has one
 * (`DialogHost`), and the last is around `App` itself (`main.tsx`, `CrashScreen`).
 *
 * Nothing is logged here. A caught error never reaches `window.onerror`, which is where
 * `useErrorCapture` listens, so the log line comes from the root's own handlers below —
 * one place, whichever boundary caught it, with the component stack only React has.
 */
import { Component, type ReactNode } from "react";
import type { RootOptions } from "react-dom/client";
import { useSetAtom } from "jotai";
import { debugConsoleAtom } from "../../atoms/logAtoms";
import { logRenderError } from "../../editor/log";
import { t } from "../../i18n";
import { Button } from "./index";

interface Props {
  /** What this wraps, in English, for the log: "properties panel", "dialog triggerEditor". */
  surface: string;
  /** What to draw in its place; `retry` mounts the children again. */
  fallback: (error: unknown, retry: () => void) => ReactNode;
  /** Once per caught error, after the fallback is in. */
  onError?: (error: unknown) => void;
  children: ReactNode;
}

interface State {
  failed: boolean;
  error: unknown;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, error: undefined };

  // `failed` beside the error: anything can be thrown, `undefined` included.
  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
  }

  retry = () => this.setState({ failed: false, error: undefined });

  render() {
    return this.state.failed ? this.props.fallback(this.state.error, this.retry) : this.props.children;
  }
}

/**
 * The log's half, for `createRoot`. Caught: one of the boundaries has it and the editor
 * carries on. Uncaught: nothing did (a fallback threw as well), and the tree is gone —
 * setting the handler takes the error away from `window.onerror`, so it is logged here
 * instead of there, once.
 */
export const rootErrorHandlers: RootOptions = {
  onCaughtError(error, info) {
    const surface = info.errorBoundary instanceof ErrorBoundary ? info.errorBoundary.props.surface : undefined;
    logRenderError("Render failed", error, info.componentStack, { surface });
  },
  onUncaughtError(error, info) {
    logRenderError("Render failed and nothing caught it", error, info.componentStack);
  },
};

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The notice a panel or the map shows in place of itself. */
function SurfaceError({ error, retry }: { error: unknown; retry: () => void }) {
  const openConsole = useSetAtom(debugConsoleAtom);
  return (
    <div className="surface-error" role="alert">
      <p className="surface-error-title">{t("This part of the editor hit an error.")}</p>
      <p className="surface-error-detail">{errorText(error)}</p>
      <div className="surface-error-actions">
        <Button size="sm" onClick={retry}>{t("Try again")}</Button>
        <Button size="sm" onClick={() => openConsole(true)}>{t("Show the log")}</Button>
      </div>
    </div>
  );
}

/** A boundary with the in-place notice: the rest of the editor, the open maps included, is untouched. */
export function Guarded({ surface, children }: { surface: string; children: ReactNode }) {
  return (
    <ErrorBoundary surface={surface} fallback={(error, retry) => <SurfaceError error={error} retry={retry} />}>
      {children}
    </ErrorBoundary>
  );
}
