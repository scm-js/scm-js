import { parseScenario, serializeScenario, type Scenario } from "../formats/chk/scenario";
import { loadMap, readExtras, saveMap } from "../formats/mpq/scm";
import type { LoadedDocument } from "../atoms/documentAtoms";

export const MAP_FILE_ACCEPT = ".scm,.scx,.chk";

/** Read a picked or dropped file into a parsed document. */
export async function openMapFile(file: File): Promise<LoadedDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loaded = await loadMap(bytes);
  const scenario = parseScenario(loaded.chk);
  const extras = loaded.archive ? await readExtras(loaded.archive, loaded.files) : new Map<string, Uint8Array>();
  return { scenario, extras, fileName: file.name };
}

export type MapFormat = "scx" | "scm" | "chk";

export interface WriteOptions {
  format: MapFormat;
  extras?: Map<string, Uint8Array>;
}

/** Serialise the scenario to the bytes that belong in the target file. */
export async function writeMapBytes(scenario: Scenario, options: WriteOptions): Promise<Uint8Array> {
  const chk = serializeScenario(scenario);
  return options.format === "chk" ? chk : saveMap(chk, { extras: options.extras });
}

/** Show a file picker, falling back to a hidden input where the API is unavailable. */
export async function pickMapFile(): Promise<File | null> {
  const picker = (window as unknown as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker({
        types: [{ description: "StarCraft scenario", accept: { "application/octet-stream": [".scm", ".scx", ".chk"] } }],
        multiple: false,
      });
      return await handle.getFile();
    } catch (err) {
      if (isAbort(err)) return null;
      // Fall through to the input element on any other failure.
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = MAP_FILE_ACCEPT;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/** Write bytes to disk: a real save dialog where supported, a download otherwise. */
export async function saveBytes(bytes: Uint8Array, fileName: string): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" });

  if (picker) {
    try {
      const handle = await picker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (isAbort(err)) return false;
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

/* The File System Access API is not in the shipped DOM lib yet. */
type ShowOpenFilePicker = (options?: {
  types?: { description?: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
}) => Promise<{ getFile(): Promise<File> }[]>;

type ShowSaveFilePicker = (options?: { suggestedName?: string }) => Promise<{
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}>;
