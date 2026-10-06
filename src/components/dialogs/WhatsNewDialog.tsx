import { Fragment, useEffect, type ReactNode } from "react";
import { useSetAtom } from "jotai";
import { ExternalLink, Sparkles } from "lucide-react";
import { closeDialogAtom, whatsNewSeenAtom } from "../../atoms/uiAtoms";
import { RELEASE_NOTES } from "../../data/releaseNotes";
import { compareVersions, isPrerelease, notesVersionFor, parseNotes, type Block, type Inline, type ListItem, type NotesSection } from "../../editor/releaseNotes";
import { APP_VERSION } from "../../version";
import { Button } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t } from "../../i18n";

const RELEASES_URL = "https://github.com/scm-js/scm-js/releases";

const openPage = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "text": return <Fragment key={i}>{node.text}</Fragment>;
      case "code": return <code key={i}>{node.text}</code>;
      case "bold": return <strong key={i}>{inline(node.children)}</strong>;
      case "italic": return <em key={i}>{inline(node.children)}</em>;
      case "link": return <a key={i} href={node.url} onClick={(e) => { e.preventDefault(); openPage(node.url); }}>{inline(node.children)}</a>;
    }
  });
}

function items(list: ListItem[]): ReactNode {
  return (
    <ul>
      {list.map((item, i) => (
        <li key={i}>
          {inline(item.inline)}
          {item.children.length > 0 && items(item.children)}
        </li>
      ))}
    </ul>
  );
}

function blocks(list: Block[]): ReactNode {
  return list.map((block, i) => block.kind === "list"
    ? <Fragment key={i}>{items(block.items)}</Fragment>
    : <p key={i}>{inline(block.inline)}</p>);
}

function Section({ section }: { section: NotesSection }) {
  // The part written for people who make plugins stays folded: most readers make maps.
  if (section.forPluginAuthors) {
    return (
      <details className="notes-fold">
        <summary>{section.title}</summary>
        {blocks(section.blocks)}
      </details>
    );
  }
  return (
    <section>
      {section.title && <h4>{section.title}</h4>}
      {blocks(section.blocks)}
    </section>
  );
}

/**
 * Help ▸ What's New…, and where the "scmJS has been updated" notice leads.
 *
 * The notes are the ones committed in `docs/releases/` when this build was made, so they
 * describe the build that is running and need no network. The release this build shows is
 * open; the older ones are folded below it. Notes are written in English and shown as
 * written — only the dialog around them is translated.
 */
export function WhatsNewDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const markSeen = useSetAtom(whatsNewSeenAtom);
  // Notes committed ahead of their release are not this build's to show.
  const shown = RELEASE_NOTES.filter((n) => compareVersions(n.version, APP_VERSION) <= 0);
  const current = notesVersionFor(APP_VERSION, shown.map((n) => n.version));

  // Opening it by hand counts as having seen it, so the notice does not follow.
  useEffect(() => {
    if (current) markSeen(current);
  }, [current, markSeen]);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("What's New")}
      icon={<Sparkles size={14} />}
      size="md"
      tall
      footerLeft={
        <Button size="sm" onClick={() => openPage(RELEASES_URL)}>
          <ExternalLink size={11} /> {" "}{t("Releases on GitHub")}
        </Button>
      }
      footer={<Button variant="primary" onClick={() => close(entry.key)}>{t("Close")}</Button>}
    >
      <div className="notes">
        {isPrerelease(APP_VERSION) && current && (
          <p className="hint">
            {t("This is a build between releases ({build}). These are the notes of the last release, {version}.", { build: APP_VERSION, version: current })}
          </p>
        )}
        {shown.length === 0 && <p className="hint">{t("This build carries no release notes.")}</p>}
        {shown.map((notes) => (
          <details key={notes.version} className="notes-release" open={notes.version === current}>
            <summary>{t("Version {version}", { version: notes.version })}</summary>
            <div className="notes-body">
              {parseNotes(notes.markdown).map((section, i) => <Section key={i} section={section} />)}
            </div>
          </details>
        ))}
      </div>
    </DialogFrame>
  );
}
