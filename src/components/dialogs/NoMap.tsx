import type { ReactNode } from "react";
import DialogFrame from "../ui/DialogFrame";
import { t } from "../../i18n";
import type { DialogProps } from "./DialogHost";

/** What a dialog that works on the open map shows when there is none. */
export function NoMap({ entry, title, icon }: { entry: DialogProps["entry"]; title: string; icon: ReactNode }) {
  return (
    <DialogFrame dialogKey={entry.key} title={title} icon={icon} size="sm">
      <p className="hint">{t("Open or create a map first.")}</p>
    </DialogFrame>
  );
}
