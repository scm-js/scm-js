/**
 * Where a trigger names a sound: the path as text, as it always was, with a list beside
 * it to pick from — the map's own sounds and the game's (`editor/stockSounds.ts`), which
 * nobody should have to know the file names of. The list is searched by path, by the unit
 * whose voice a sound is and by when it says it, and opens on the unit the action already
 * names.
 *
 * Imported by the trigger dialogs only, so it rides in their chunk.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { Popover } from "radix-ui";
import { ListMusic, Search } from "lucide-react";
import { archiveExtrasAtom } from "../../atoms/documentAtoms";
import { gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { unitLabel } from "../../data/units";
import { findMember, normalizeMember, soundList } from "../../editor/sounds";
import { findStockSound, isStockPath, searchStockSounds, type StockSound, type StockSounds, type VoiceKind } from "../../editor/stockSounds";
import type { Scenario } from "../../formats/chk/scenario";
import { useStockSounds } from "../../hooks/useStockSounds";
import { t, tc } from "../../i18n";
import { Button, TextInput } from "./index";

/** The moments by the names the game's files go by (Rdy, Wht, Yes, Pss), which is how map makers know them. */
function kindLabel(kind: VoiceKind): string {
  switch (kind) {
    case "ready": return tc("unit voice", "Ready");
    case "what": return tc("unit voice", "What");
    case "yes": return tc("unit voice", "Yes");
    case "annoyed": return tc("unit voice", "Annoyed");
  }
}

/** "Terran Marine · Yes", and how many other units share the line. */
function voiceLabel(sound: StockSound, prefer?: number): string {
  if (sound.voices.length === 0) return "";
  const v = sound.voices.find((x) => x.unit === prefer) ?? sound.voices[0];
  const more = new Set(sound.voices.map((x) => x.unit)).size - 1;
  const base = `${unitLabel(v.unit)} · ${kindLabel(v.kind)}`;
  return more > 0 ? t("{base} +{more}", { base, more }) : base;
}

interface Row {
  path: string;
  label: string;
  note: string;
  missing?: boolean;
}
interface Section {
  key: string;
  title: string;
  rows: Row[];
}

/** The list as sections: the unit's own lines, the map's sounds, then the game's by folder. */
function sectionsFor(scenario: Scenario, extras: ReadonlyMap<string, Uint8Array>, stock: StockSounds | null, query: string, unit: number | undefined): Section[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Section[] = [];
  const lines = unit !== undefined ? stock?.byUnit.get(unit) : undefined;
  if (lines && words.length === 0) {
    out.push({ key: "unit", title: unitLabel(unit!), rows: lines.map((l) => ({ path: l.sound.path, label: l.sound.file, note: kindLabel(l.kind) })) });
  }
  const own = soundList(scenario, extras).filter((r) => words.every((w) => r.path.toLowerCase().includes(w)));
  if (own.length > 0) {
    out.push({ key: "map", title: t("This map"), rows: own.map((r) => ({ path: r.path, label: r.path, note: r.present ? "" : t("missing"), missing: !r.present })) });
  }
  if (stock) {
    let section: Section | null = null;
    for (const s of searchStockSounds(stock, query, unitLabel, kindLabel)) {
      if (!section || section.key !== `f:${s.folder}`) out.push((section = { key: `f:${s.folder}`, title: s.folder.replaceAll("\\", " ▸ ") || t("StarCraft"), rows: [] }));
      section.rows.push({ path: s.path, label: s.file, note: voiceLabel(s, unit) });
    }
  }
  return out;
}

export interface SoundFieldProps {
  /** The path the action plays. */
  value: string;
  onChange: (path: string) => void;
  scenario: Scenario;
  /** The unit the same action names (a Transmission's), whose lines the list then leads with. */
  unit?: number;
  width?: number;
}

export function SoundField({ value, onChange, scenario, unit, width = 360 }: SoundFieldProps) {
  const extras = useAtomValue(archiveExtrasAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const { stock, loading } = useStockSounds();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const sections = useMemo(() => (open ? sectionsFor(scenario, extras, stock, query, unit) : []), [open, scenario, extras, stock, query, unit]);
  const rows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const current = normalizeMember(value.trim());

  // Opening lands on the sound already chosen; typing goes back to the top.
  useEffect(() => {
    if (!open) return;
    const at = query ? -1 : rows.findIndex((r) => normalizeMember(r.path) === current);
    setActive(Math.max(at, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, rows.length]);
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, rows.length]);

  const pick = (row: Row | undefined) => {
    if (!row) return;
    onChange(row.path);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 10 : e.key === "PageUp" ? -10 : 0;
    if (step !== 0) {
      e.preventDefault();
      setActive((a) => Math.min(Math.max(a + step, 0), Math.max(rows.length - 1, 0)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(rows[active]);
    }
  };

  // What the path is, said under the field — so a mistyped one shows here and not in the game.
  const trimmed = value.trim();
  const stockHit = stock && trimmed ? findStockSound(stock, trimmed) : null;
  let status: { text: string; warn?: boolean } | null = null;
  if (trimmed) {
    if (findMember(extras, trimmed)) status = { text: t("In this map") };
    else if (stockHit) status = { text: stockHit.voices.length > 0 ? t("StarCraft's own · {voice}", { voice: voiceLabel(stockHit, unit) }) : t("StarCraft's own") };
    else if (stock && isStockPath(trimmed)) status = { text: t("Not one of the sounds the game lists"), warn: true };
    else if (!isStockPath(trimmed)) status = { text: t("Not in this map (Scenario ▸ Sound Editor imports it)"), warn: true };
  }

  let index = 0;
  return (
    <span className="sound-field">
      <span className="row" style={{ gap: 6 }}>
        <TextInput
          style={{ width }}
          value={value}
          placeholder={"staredit\\wav\\name.wav"}
          onChange={(e) => onChange(e.target.value)}
        />
        <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setQuery(""); }}>
          <Popover.Trigger asChild>
            <Button size="sm" title={t("Pick from the map's sounds and the game's own")}><ListMusic size={12} /> {" "}{t("Browse…")}</Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="menu-content sound-pop" align="start" sideOffset={4} collisionPadding={8}>
              <div className="sound-pop-search">
                <Search size={12} className="faint" />
                <TextInput
                  value={query}
                  placeholder={t("Search: marine yes, button, zealot…")}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKey}
                  aria-label={t("Search sounds")}
                />
              </div>
              <div className="sound-pop-list" ref={listRef} role="listbox">
                {sections.map((s) => (
                  <div key={s.key} className="sound-pop-section">
                    <div className="sound-pop-head">{s.title}</div>
                    {s.rows.map((r) => {
                      const i = index++;
                      return (
                        <div
                          key={`${s.key}:${r.path}`}
                          role="option"
                          aria-selected={i === active}
                          data-row={i}
                          className={`sound-pop-row${i === active ? " active" : ""}${normalizeMember(r.path) === current ? " current" : ""}`}
                          title={r.path}
                          onMouseMove={() => { if (i !== active) setActive(i); }}
                          onClick={() => pick(r)}
                        >
                          <span className="mono name">{r.label}</span>
                          <span className={r.missing ? "note warn" : "note"}>{r.note}</span>
                        </div>
                      );
                    })}
                  </div>
                ))}
                {rows.length === 0 && <p className="hint sound-pop-empty">{loading ? t("Loading…") : query ? t("No sound matches.") : t("No sounds to list.")}</p>}
              </div>
              <div className="sound-pop-foot hint">
                {stock
                  ? t("A sound of the game's plays from the game's own files; nothing is added to the map.")
                  : loading
                    ? ""
                    : source?.kind === "none" || !source
                      ? t("Install the game data (Help ▸ Game Data…) to list StarCraft's own sounds.")
                      : t("This copy of the game data has no sound list. Install it again from Help ▸ Game Data… to list StarCraft's own sounds.")}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </span>
      {status && <span className={status.warn ? "hint warn" : "hint"}>{status.text}</span>}
    </span>
  );
}
