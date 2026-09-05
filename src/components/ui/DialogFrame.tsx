import type { ReactNode } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useSetAtom } from "jotai";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { Button } from "./index";
import DialogSlots, { type DialogSlotProps } from "./DialogSlots";

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

export interface DialogFrameProps {
  dialogKey: number;
  title: string;
  icon?: ReactNode;
  size?: DialogSize;
  tall?: boolean;
  flush?: boolean;
  description?: string;
  children: ReactNode;
  /** Footer buttons; defaults to OK / Cancel. Pass `null` for no footer. */
  footer?: ReactNode | null;
  footerLeft?: ReactNode;
  okLabel?: string;
  cancelLabel?: string;
  onOk?: () => void;
  /** Grey out OK (and Apply) while the form cannot be applied. */
  okDisabled?: boolean;
  showApply?: boolean;
  /** Called before Escape closes the dialog; `preventDefault()` keeps it open (an embedded editor wants Escape for itself). */
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  /**
   * Let plugins add to this dialog (`api.ui.dialogSlot`): which id they register for, and
   * the working-copy fields lent to them. Rendered at the left of the footer, before `footerLeft`.
   */
  slot?: DialogSlotProps;
}

/** Classic dialog chrome: title strip, scrollable body, button row. */
export default function DialogFrame({
  dialogKey,
  title,
  icon,
  size = "md",
  tall,
  flush,
  description,
  children,
  footer,
  footerLeft,
  okLabel = "OK",
  cancelLabel = "Cancel",
  onOk,
  okDisabled,
  showApply,
  onEscapeKeyDown,
  slot,
}: DialogFrameProps) {
  const close = useSetAtom(closeDialogAtom);
  const dismiss = () => close(dialogKey);

  return (
    <Dialog.Root open onOpenChange={(o) => !o && dismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content
          className={`dlg ${size} ${tall ? "tall" : ""}`}
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          onInteractOutside={(e) => {
            // A toast is drawn above the overlay, so a press on one is a press "outside"
            // the dialog and would otherwise close it — dismissing the notice and the
            // dialog that raised it in one click, or losing the dialog to a toast's own
            // button. Everywhere else, a press on the dim still closes as it did.
            const target = e.target;
            if (target instanceof Element && target.closest(".toasts")) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            // Focus the first text field if there is one, otherwise the dialog itself.
            e.preventDefault();
            const el = e.currentTarget as HTMLElement;
            const first = el.querySelector<HTMLElement>(".dlg-body input[type=text], .dlg-body input:not([type]), .dlg-body textarea");
            (first ?? el).focus({ preventScroll: true });
            if (first instanceof HTMLInputElement) first.select();
          }}
        >
          <div className="dlg-title">
            {icon && <span className="icon-lead">{icon}</span>}
            <Dialog.Title asChild>
              <h2>{title}</h2>
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="dlg-close" aria-label="Close">
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>
          <div className={`dlg-body ${flush ? "flush" : ""}`}>
            {description && <p className="dlg-desc">{description}</p>}
            {children}
          </div>
          {footer !== null && (
            <div className="dlg-footer">
              <div className="left">
                {slot && <DialogSlots dialogKey={dialogKey} dialog={slot.dialog} fields={slot.fields} payload={slot.payload} />}
                {footerLeft}
              </div>
              {footer ?? (
                <>
                  <Button variant="primary" disabled={okDisabled} onClick={() => { onOk?.(); dismiss(); }}>
                    {okLabel}
                  </Button>
                  <Button onClick={dismiss}>{cancelLabel}</Button>
                  {showApply && <Button disabled={okDisabled} onClick={onOk}>Apply</Button>}
                </>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
