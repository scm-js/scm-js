/**
 * The row a plugin adds to a built-in dialog through `api.ui.dialogSlot`. `DialogFrame`
 * renders one at the left of the footer for every dialog that passes it a `slot`, and
 * each registered slot for that dialog gets an empty `<span>` to fill with plain DOM —
 * the pattern `PluginDialog` and `PluginPanels` use, host element in state so the mount
 * effect sees it on its first pass.
 *
 * The dialog's fields reach the plugin through `DialogSlotHost.fields`, read live: the
 * dialog rebuilds its `fields` object on every render (closures over its state), and the
 * host hands the plugin getters that read the newest one through a ref, so a slot mounted
 * once sees every keystroke without remounting.
 */
import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { pluginDialogSlotsAtom, type PluginDialogSlotEntry } from "../../atoms/pluginAtoms";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import type { DialogField, DialogSlotHost, SlottedDialogId } from "../../plugins/api";

export interface DialogSlotProps {
  dialog: SlottedDialogId;
  /** The dialog's working copy, lent to the slot. Rebuilt per render is fine. */
  fields?: Record<string, DialogField>;
  payload?: Record<string, unknown>;
}

export default function DialogSlots({ dialog, fields, payload, dialogKey }: DialogSlotProps & { dialogKey: number }) {
  const entries = useAtomValue(pluginDialogSlotsAtom);
  const mine = entries.filter((e) => e.dialog === dialog);
  const fieldsRef = useRef(fields ?? {});
  fieldsRef.current = fields ?? {};
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((e) => <Slot key={e.key} entry={e} fieldsRef={fieldsRef} payload={payload ?? {}} dialogKey={dialogKey} />)}
    </>
  );
}

function Slot({ entry, fieldsRef, payload, dialogKey }: { entry: PluginDialogSlotEntry; fieldsRef: React.RefObject<Record<string, DialogField>>; payload: Record<string, unknown>; dialogKey: number }) {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const close = useSetAtom(closeDialogAtom);
  useEffect(() => {
    if (!host) return;
    // Every field the dialog lends, as live getters and setters over the ref.
    const fields: Record<string, DialogField> = {};
    for (const name of Object.keys(fieldsRef.current ?? {})) {
      fields[name] = { get: () => fieldsRef.current?.[name]?.get() ?? "", set: (v) => fieldsRef.current?.[name]?.set(v) };
    }
    const slotHost: DialogSlotHost = { dialog: entry.dialog, payload, fields, close: () => close(dialogKey) };
    let cleanup: void | (() => void);
    try {
      cleanup = entry.spec.mount(host, slotHost);
    } catch (err) {
      console.error(`[${entry.plugin.name}] dialog slot mount failed`, err);
    }
    return () => { try { cleanup?.(); } catch (err) { console.error(`[${entry.plugin.name}] dialog slot cleanup failed`, err); } };
    // `payload` is the dialog's own and does not change while it is open; the fields are read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, entry, dialogKey]);
  return <span ref={setHost} className="dlg-slot" data-plugin={entry.plugin.id} />;
}
