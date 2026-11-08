import { useState } from "react";
import { useSetAtom, useStore } from "jotai";
import { Layers } from "lucide-react";
import { closeDialogAtom, openDialogAtom, pushToastAtom } from "../../atoms/uiAtoms";
import { switchDataSet } from "../../services/gameData";
import { Button } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t, tc } from "../../i18n";

/**
 * Asked when a map opens that was saved with another data set (`services/mapDataSet.ts`):
 * switch to it when it is installed here, or say where its makers publish it when it is
 * not. The payload is the map's member, plus `installed`. Nothing without one.
 */
export function MapDataSetDialog({ entry }: DialogProps) {
  const store = useStore();
  const close = useSetAtom(closeDialogAtom);
  const open = useSetAtom(openDialogAtom);
  const toast = useSetAtom(pushToastAtom);
  const [busy, setBusy] = useState(false);
  const p = entry.payload ?? {};
  const id = typeof p.id === "string" ? p.id : "";
  const name = typeof p.name === "string" && p.name ? p.name : id;
  const url = typeof p.url === "string" ? p.url : "";
  if (!id) return null;

  const switchTo = async () => {
    setBusy(true);
    try {
      const next = await switchDataSet(store, id);
      close(entry.key);
      toast(next.profile.id === id
        ? { kind: "ok", title: t("Now drawing from {name}.", { name }) }
        : { kind: "warn", title: t("{name} has no copy here any more; drawing from the game's own data.", { name }) });
    } catch (err) {
      setBusy(false);
      toast({ kind: "error", title: t("Could not switch data sets"), detail: err instanceof Error ? err.message : String(err) });
    }
  };

  return p.installed === true ? (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Data Set")}
      icon={<Layers size={14} />}
      size="sm"
      footer={<>
        <Button variant="primary" disabled={busy} onClick={() => { void switchTo(); }}>{tc("data set", "Switch")}</Button>
        <Button disabled={busy} onClick={() => close(entry.key)}>{tc("data set", "Keep")}</Button>
      </>}
    >
      <p>{t("This map was made with the data set {name}; switch to it?", { name })}</p>
    </DialogFrame>
  ) : (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Data Set")}
      icon={<Layers size={14} />}
      size="sm"
      footer={<>
        <Button onClick={() => { close(entry.key); open("gameData"); }}>{t("Game Data…")}</Button>
        <Button variant="primary" onClick={() => close(entry.key)}>{t("Close")}</Button>
      </>}
    >
      <p>
        {url
          ? <>{t("This map was made with the data set {name}, which is not installed here; its makers publish it at", { name })}{" "}<span className="mono">{url}</span>.</>
          : t("This map was made with the data set {name}, which is not installed here.", { name })}
      </p>
    </DialogFrame>
  );
}
