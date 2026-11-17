import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { dismissAllToastsAtom, dismissToastAtom, toastsAtom, type Toast } from "../../atoms/uiAtoms";
import { keepNoticesAtom } from "../../atoms/preferencesAtoms";
import { toastLifetime } from "../../app/view";
import { useT } from "../../i18n/react";

const ICONS = { ok: CircleCheck, info: Info, warn: TriangleAlert, error: CircleAlert } as const;

/**
 * The notices `pushToastAtom` raises, bottom-right over the map, each leaving after its `ttl`
 * — or none of them, while Preferences ▸ View keeps notices until they are closed. Then a
 * pile of them gets a Close all above it, so up to four notices over the map go in one press.
 */
export default function Toasts() {
  const t = useT();
  const toasts = useAtomValue(toastsAtom);
  const keep = useAtomValue(keepNoticesAtom);
  const dismissAll = useSetAtom(dismissAllToastsAtom);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {keep && toasts.length > 1 && (
        <button type="button" className="toast-action toasts-clear" onClick={() => dismissAll()}>{t("Close all")}</button>
      )}
      {toasts.map((toast) => <ToastView key={toast.id} toast={toast} keep={keep} />)}
    </div>
  );
}

function ToastView({ toast, keep }: { toast: Toast; keep: boolean }) {
  const t = useT();
  const dismiss = useSetAtom(dismissToastAtom);
  const lifetime = toastLifetime(toast, keep);
  useEffect(() => {
    if (lifetime <= 0) return;
    const timer = setTimeout(() => dismiss(toast.id), lifetime);
    return () => clearTimeout(timer);
  }, [toast.id, lifetime, dismiss]);
  const Icon = ICONS[toast.kind];
  return (
    <div className={`toast ${toast.kind}`}>
      <Icon size={14} className="toast-icon" />
      <div className="toast-text">
        <div className="toast-title">{toast.title}</div>
        {toast.detail && <div className="toast-detail">{toast.detail}</div>}
        {toast.actions && toast.actions.length > 0 && (
          <div className="toast-actions">
            {toast.actions.map((action, i) => (
              <button
                key={i}
                type="button"
                className="toast-action"
                onClick={() => { if (!action.keep) dismiss(toast.id); action.run(); }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => { dismiss(toast.id); toast.action?.run(); }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className="toast-close" aria-label={t("Dismiss")} onClick={() => dismiss(toast.id)}><X size={12} /></button>
    </div>
  );
}
