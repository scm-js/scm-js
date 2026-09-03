import { useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { dismissToastAtom, toastsAtom, type Toast } from "../../atoms/uiAtoms";

const ICONS = { ok: CircleCheck, info: Info, warn: TriangleAlert, error: CircleAlert } as const;

/** The notices `pushToastAtom` raises, bottom-right over the map, each leaving after its `ttl`. */
export default function Toasts() {
  const toasts = useAtomValue(toastsAtom);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <ToastView key={t.id} toast={t} />)}
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  const dismiss = useSetAtom(dismissToastAtom);
  useEffect(() => {
    if (toast.ttl <= 0) return;
    const timer = setTimeout(() => dismiss(toast.id), toast.ttl);
    return () => clearTimeout(timer);
  }, [toast.id, toast.ttl, dismiss]);
  const Icon = ICONS[toast.kind];
  return (
    <div className={`toast ${toast.kind}`}>
      <Icon size={14} className="toast-icon" />
      <div className="toast-text">
        <div className="toast-title">{toast.title}</div>
        {toast.detail && <div className="toast-detail">{toast.detail}</div>}
      </div>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}><X size={12} /></button>
    </div>
  );
}
