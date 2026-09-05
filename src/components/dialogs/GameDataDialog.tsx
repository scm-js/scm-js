import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { AlertTriangle, Download, FolderOpen, HardDrive, Layers, Search, Trash2 } from "lucide-react";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { closeDialogAtom, pushToastAtom } from "../../atoms/uiAtoms";
import { desktopBridge, type DesktopLocateResult } from "../../gamedata/desktop";
import { hostTerms } from "../../editor/platform";
import {
  ARCHIVE_NAMES, BLIZZARD_ZIP_URL, installFromFiles, installFromZipUrl, pickArchives, splitPickedFiles, type InstallProgress,
} from "../../gamedata/install";
import { DEFAULT_PROFILE, isDefaultProfile, profileIdFrom, type GameDataProfile } from "../../gamedata/profiles";
import { adoptStoredCopy, resetAssetSource, resolveAssetSource, type AssetSource } from "../../gamedata/source";
import { adoptSource, installDataSetInto, listDataSets, removeDataSet, sameFiles, switchDataSet } from "../../services/gameData";
import { Button, Check, Group, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/**
 * Help ▸ Game Data…: where the graphics come from, and — only when there are none — the
 * two ways to get them.
 *
 * The dialog used to list every route the editor knows at all times: pick the archives,
 * pick a folder, search the disk, or type a web address, whether or not any of it was
 * needed. It shows one thing at a time now, and the two states are shaped differently.
 *
 * With data in place it is a status line ("Now") and a way to remove the copy. Without, it
 * is a *prompt*: the state line is replaced by a caution notice, because an editor that
 * draws flat colours and coloured markers looks broken rather than unconfigured, and the
 * one thing the user has to know is that something is missing and one click fixes it. The
 * two routes are then weighted rather than listed side by side — the Blizzard download is
 * a card carrying the one large button, since it is the only route that works for someone
 * who has never owned a copy of the 1.16 game, and the user's own archives are the quieter
 * alternative under it. The desktop's search of the disk sits with those, since a user who
 * has just installed StarCraft wants it re-run rather than a fresh download. The footer
 * says "Continue without graphics" while there are none, so leaving is a choice made
 * rather than a dialog dismissed.
 *
 * It opens on its own after the splash when the preload found nothing (`payload.auto`), and
 * in that case closes itself once something has been installed — the whole of it is then a
 * prompt, a button, a progress bar, and the editor drawing real terrain behind it.
 *
 * Under that is *Data sets* (`gamedata/profiles.ts`): the game's own files and any mod's
 * installed beside them, one in use at a time. The list only appears once there is a
 * second set or the user asks to add one, so a user with the game's data alone never sees
 * it; adding one is a name and a folder — the mod's files with the game's two archives
 * among them — and the rest goes through `services/gameData.ts`, as a plugin's
 * `api.gameData.install` does.
 */

interface Busy {
  fraction: number;
  label: string;
}

/** What the dialog says under the current source. */
function explain(source: AssetSource | null): string {
  if (!source) return "Still looking.";
  switch (source.kind) {
    case "bundled": return source.desktop ? "Extracted into the app's data folder from your StarCraft installation." : "The graphics ship with this build.";
    case "stored": return "Terrain and units draw from this copy, and it is here next time.";
    case "none": return "The editor is running without Blizzard’s assets — terrain is flat colours and units are markers.";
  }
}

export function GameDataDialog({ entry }: DialogProps) {
  const store = useStore();
  const close = useSetAtom(closeDialogAtom);
  const toast = useSetAtom(pushToastAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const revision = useAtomValue(gameDataRevisionAtom);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [searchDirs, setSearchDirs] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  /** The handle of the "it opened itself, now it can go" timer, so unmounting cancels it. */
  const leaving = useRef<number | null>(null);
  const desktop = desktopBridge();
  const auto = entry.payload?.auto === true;
  const have = source !== null && source.kind !== "none";

  const [desktopCopy, setDesktopCopy] = useState<DesktopLocateResult | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.gameData.searchDirs().then(setSearchDirs, () => {});
    // What the app already holds, read off its stamp — no search, no extraction.
    desktop.gameData.status().then(setDesktopCopy, () => {});
  }, [desktop, source]);

  // The data sets with a copy here, the game's own first; refreshed whenever the source moves.
  const [sets, setSets] = useState<GameDataProfile[]>([DEFAULT_PROFILE]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const setFolderInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    listDataSets().then((list) => { if (!cancelled) setSets(list); }, () => {});
    return () => { cancelled = true; };
  }, [source, revision]);

  const progress: InstallProgress = (fraction, label) => setBusy({ fraction, label });

  /** A new source is in place: repaint everything that gave up on the old one (or, after a switch, everything). */
  const adopted = (next: AssetSource, text: string, switched = !sameFiles(source, next)) => {
    adoptSource(store, next, switched);
    setMessage({ text });
    toast({ kind: "ok", title: "Game data ready", detail: text });
    // The dialog that opened itself because there was nothing has nothing left to say once
    // there is: it closes and leaves the editor, now drawing real terrain, in front. Long
    // enough that the finished bar and the message are seen rather than flashing past; the
    // toast repeats it for anyone who looked away. A dialog the user opened themselves is
    // theirs to close.
    if (auto && next.kind !== "none") leaving.current = window.setTimeout(() => close(entry.key), 900);
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setMessage(null);
    setBusy({ fraction: 0, label: "Starting" });
    try {
      await work();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  };

  const kept = (where: "opfs" | "memory") => (where === "memory" ? ` ${hostTerms().Here} keeps no site data, so the copy lasts until the tab closes.` : "");
  // A copy replacing a copy is different files under the same ids, so that one is a switch.
  const installed = (copy: Awaited<ReturnType<typeof installFromFiles>>, from: string) =>
    adopted(adoptStoredCopy(copy), `Installed ${copy.summary} from ${from}.${kept(copy.where)}`, source?.kind === "stored" || !sameFiles(source, adoptStoredCopy(copy)));

  const fromBlizzard = () => run(async () => {
    installed(await installFromZipUrl(BLIZZARD_ZIP_URL, progress), "Blizzard's StarEdit download");
  });

  const fromFiles = (files: File[]) => run(async () => {
    pickArchives(files); // throws early, before the bytes are read
    installed(await installFromFiles(files, progress), files.length === 1 ? files[0].name : "the archives you picked");
  });

  const chooseFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      folderInput.current?.click();
      return;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await picker();
    } catch {
      return; // dismissed
    }
    const files: File[] = [];
    for (const name of ARCHIVE_NAMES) {
      for (const variant of [name, name.toLowerCase(), name.toUpperCase()]) {
        try {
          files.push(await (await dir.getFileHandle(variant)).getFile());
          break;
        } catch {
          // not under this spelling
        }
      }
    }
    void fromFiles(files);
  };

  const desktopResult = (found: DesktopLocateResult | null) => {
    if (!found) return;
    if (found.status === "ready") {
      resetAssetSource();
      const problems = found.problems?.length ? ` ${found.problems.length} archive${found.problems.length === 1 ? "" : "s"} could not be opened: ${found.problems.join("; ")}` : "";
      return resolveAssetSource().then((next) => adopted(next, `Extracted from ${found.from}.${problems}`));
    }
    throw new Error(found.status === "missing" ? `No StarCraft archives in the ${found.searched.length} places searched.` : found.message);
  };
  const desktopSearch = () => run(async () => desktopResult(await desktop!.gameData.locate()));
  const desktopFolder = () => run(async () => desktopResult(await desktop!.gameData.pickFolder()));

  const remove = () => run(async () => {
    const id = source?.profile.id ?? DEFAULT_PROFILE.id;
    if (desktop && isDefaultProfile(id)) await desktop.gameData.clear();
    await removeDataSet(store, id);
    setMessage({ text: "Removed. " + explain(store.get(gameDataSourceAtom)) });
  });

  /** Data sets: switch to one, remove one, add one from a folder. */
  const choose = (id: string) => run(async () => {
    const next = await switchDataSet(store, id);
    const name = sets.find((p) => p.id === id)?.name ?? id;
    setMessage({ text: next.profile.id === id ? `Now drawing from ${name}.` : `${name} has no copy here any more; drawing from the game's own data.` });
  });
  const removeSet = (p: GameDataProfile) => run(async () => {
    await removeDataSet(store, p.id);
    setMessage({ text: `Removed ${p.name}.` });
  });
  const addFromFolder = (files: File[]) => run(async () => {
    const name = newName.trim();
    const id = profileIdFrom(name);
    if (!id) throw new Error("Give the data set a name first.");
    if (sets.some((p) => p.id === id)) throw new Error(`There is already a data set called ${name}.`);
    const next = await installDataSetInto(store, { id, name }, splitPickedFiles(files), progress);
    setAdding(false);
    setNewName("");
    setMessage({ text: `Installed ${name}: ${next.stored?.summary ?? next.label}.${kept(next.stored?.where ?? "opfs")}` });
    toast({ kind: "ok", title: "Data set ready", detail: `Now drawing from ${name}.` });
  });

  useEffect(() => {
    if (!desktop) return;
    return desktop.gameData.onProgress((fraction, label) => setBusy((b) => (b ? { fraction, label } : b)));
  }, [desktop]);

  useEffect(() => () => { if (leaving.current) window.clearTimeout(leaving.current); }, []);

  const removable = source?.kind === "stored" || source?.desktop === true;
  const active = source?.profile.id ?? DEFAULT_PROFILE.id;
  const showSets = have && (sets.length > 1 || adding || !isDefaultProfile(active));

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Game Data"
      icon={<HardDrive size={14} />}
      size={have ? "md" : "lg"}
      footer={<Button variant={have ? "primary" : "default"} onClick={() => close(entry.key)}>{have ? "Close" : "Continue without graphics"}</Button>}
    >
      <div className="stack">
        {have ? (
          <Group title="Now">
            <div className="row" style={{ alignItems: "baseline" }}>
              <span className="grow">{source?.label ?? "Locating…"}</span>
              {removable && <Button size="sm" variant="danger" disabled={!!busy} onClick={remove}><Trash2 size={11} /> Remove copy</Button>}
            </div>
            <p className="hint" style={{ marginTop: 4 }}>{explain(source)}</p>
            {source && !isDefaultProfile(source.profile.id) && <p className="hint" style={{ marginTop: 4 }}>Data set: <strong>{source.profile.name}</strong>. Units, weapons, upgrades and technologies it renamed show its names.</p>}
            {revision > 0 && <p className="hint" style={{ marginTop: 4 }}>Open maps pick the graphics up as they arrive.</p>}
          </Group>
        ) : (
          <div className="gd-alert">
            <AlertTriangle size={20} />
            <div>
              <strong>{source === null ? "Looking for StarCraft’s graphics…" : "The editor has no StarCraft graphics"}</strong>
              <p>
                Terrain is drawn as flat colours and units as coloured markers, so a map cannot really be
                seen or edited by eye. The graphics come from StarCraft’s own archives, which cannot ship
                with the editor — install them once, below, and everything draws properly.
              </p>
            </div>
          </div>
        )}

        {busy && (
          <div className="col" style={{ gap: 4 }}>
            <div className="row between"><span>{busy.label}</span><span className="dim mono">{Math.round(busy.fraction * 100)}%</span></div>
            <div style={{ position: "relative", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--bg-0)", border: "1px solid var(--border)" }}>
              <div style={{ height: "100%", width: `${(busy.fraction * 100).toFixed(1)}%`, background: "var(--gold)", transition: "width 90ms linear" }} />
            </div>
          </div>
        )}
        {message && <p className={message.error ? "hint error" : "hint"} style={{ color: message.error ? "var(--danger, #e66)" : undefined }}>{message.text}</p>}

        {have && (
          <Group title="Data sets">
            {showSets ? (
              <div className="col" style={{ gap: 4 }}>
                {sets.map((p) => (
                  <div key={p.id} className="row" style={{ alignItems: "center", gap: 8 }}>
                    <Check radio name="gd-set" label={p.name} checked={p.id === active} disabled={!!busy} onChange={() => { if (p.id !== active) void choose(p.id); }} />
                    <span className="grow" />
                    {!isDefaultProfile(p.id) && <Button size="sm" variant="danger" disabled={!!busy} onClick={() => removeSet(p)}><Trash2 size={11} /> Remove</Button>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">The game's own files. A mod that replaces them in the same formats can be installed beside them and switched to here.</p>
            )}
            {adding ? (
              <div className="col" style={{ gap: 6, marginTop: 6 }}>
                <div className="row" style={{ gap: 6, alignItems: "center" }}>
                  <TextInput placeholder="Name of the data set (the mod's name)" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={!!busy} style={{ flex: 1 }} />
                  <Button size="sm" disabled={!!busy || !profileIdFrom(newName)} onClick={() => setFolderInput.current?.click()}><FolderOpen size={11} /> Choose the folder…</Button>
                  <Button size="sm" disabled={!!busy} onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
                </div>
                <input ref={setFolderInput} type="file" hidden {...({ webkitdirectory: "" } as object)} onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void addFromFolder(f); }} />
                <p className="hint">
                  A folder holding the mod's files — <span className="mono">arr</span>, <span className="mono">unit</span>, <span className="mono">tileset</span> and the rest as loose
                  files or as <span className="mono">.mpq</span> archives — together with <span className="mono">{ARCHIVE_NAMES[0]}</span> and <span className="mono">{ARCHIVE_NAMES[1]}</span>,
                  which the mod's files are laid over. Anything else in the folder is left alone.
                </p>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 6 }}>
                <Button size="sm" disabled={!!busy} onClick={() => setAdding(true)}><Layers size={11} /> Add a data set…</Button>
              </div>
            )}
          </Group>
        )}

        {!have && (
          <>
            <section className="gd-card">
              <div className="gd-card-head">
                <Download size={16} />
                <span className="gd-card-title grow">Download from Blizzard</span>
                <span className="badge gold">Recommended</span>
              </div>
              <p>
                Blizzard offers the StarCraft map editor as a free download, and it carries the two archives
                the graphics come from. You do not need StarCraft installed, or a copy of the game at all.
                The files are extracted here and kept in {hostTerms().here}, so this happens once.
              </p>
              <Button className="gd-cta" variant="primary" disabled={!!busy} onClick={fromBlizzard}>
                <Download size={14} /> Download the graphics — 82 MB
              </Button>
            </section>

            <section className="gd-alt">
              <div className="gd-alt-head"><HardDrive size={13} /> Already have StarCraft 1.16? Use your own files</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {desktop && <Button size="sm" disabled={!!busy} onClick={desktopSearch}><Search size={11} /> Search this computer</Button>}
                {desktop && <Button size="sm" disabled={!!busy} onClick={desktopFolder}><FolderOpen size={11} /> Choose the StarCraft folder…</Button>}
                {!desktop && <Button size="sm" disabled={!!busy} onClick={() => fileInput.current?.click()}><FolderOpen size={11} /> Choose StarDat.mpq and BrooDat.mpq…</Button>}
                {!desktop && <Button size="sm" disabled={!!busy} onClick={chooseFolder}><FolderOpen size={11} /> Choose the StarCraft folder…</Button>}
              </div>
              <input ref={fileInput} type="file" accept=".mpq" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void fromFiles(f); }} />
              <input ref={folderInput} type="file" hidden {...({ webkitdirectory: "" } as object)} onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void fromFiles(f); }} />
              <p className="hint" style={{ marginTop: 4 }}>
                A classic (1.16) installation keeps <span className="mono">StarDat.mpq</span> and <span className="mono">BrooDat.mpq</span> in the game folder.
                Remastered installs do not have them, so download above instead.
                {desktop ? " The search also looks next to the app, so the two files dropped beside it are found." : ""}
              </p>
              {desktop && desktopCopy?.status === "ready" && (
                <p className="hint" style={{ marginTop: 4 }}>App copy: {desktopCopy.files} files from {desktopCopy.from}, {new Date(desktopCopy.at).toLocaleDateString()}</p>
              )}
              {desktop && searchDirs.length > 0 && (
                <details className="hint" style={{ marginTop: 4 }}>
                  <summary>Where the search looks</summary>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{searchDirs.map((d) => <li key={d} className="mono">{d}</li>)}</ul>
                </details>
              )}
            </section>

            {source?.kind === "none" && source.tried.length > 0 && (
              <details className="hint">
                <summary>What was tried</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{source.tried.map((t) => <li key={t}>{t}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </div>
    </DialogFrame>
  );
}
