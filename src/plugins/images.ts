/**
 * Image helpers behind `api.ui.loadImage` and `api.ui.readClipboardImage`, and the
 * paste / drop plumbing `PluginDialog` uses. Browser-only apart from `transferOf` and
 * `looksLikeImageUrl`, which `tests/plugins.test.ts` runs in Node.
 */
import type { DialogTransfer } from "./api";

/** The files and plain text a `DataTransfer` (paste or drop) carries. */
export function transferOf(dt: DataTransfer | null | undefined): DialogTransfer {
  const files: File[] = [];
  const seen = new Set<File>();
  const push = (f: File | null | undefined) => { if (f && !seen.has(f)) { seen.add(f); files.push(f); } };
  if (dt) {
    // Items first: a pasted screenshot is an `image/png` item whose `files` entry may be missing in some browsers.
    for (const item of Array.from(dt.items ?? [])) if (item.kind === "file") push(item.getAsFile());
    for (const f of Array.from(dt.files ?? [])) push(f);
  }
  let text = "";
  try { text = dt?.getData("text/plain") ?? ""; } catch { /* not available in every drop */ }
  if (!text) { try { text = dt?.getData("text/uri-list")?.split(/\r?\n/).find((l) => l && !l.startsWith("#")) ?? ""; } catch { /* ditto */ } }
  return { files, text: text.trim() };
}

/** Whether a string is something `loadImage` can try: a `data:image/…` or `http(s)` URL. */
export function looksLikeImageUrl(text: string): boolean {
  const t = text.trim();
  if (/^data:image\//i.test(t)) return true;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function bitmapOf(blob: Blob): Promise<ImageBitmap> {
  if (!blob.type.startsWith("image/") && blob.type !== "") throw new Error(`Not an image (${blob.type}).`);
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("The file is not an image the browser can decode.");
  }
}

/** An `<img>` load with CORS asked for, so the pixels can be read back; rejects when the site says no. */
function bitmapViaImg(url: string): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { createImageBitmap(img).then(resolve, () => reject(new Error("The image could not be decoded."))); };
    img.onerror = () => reject(new Error("The site does not allow this page to read the image (no CORS headers). Save the picture and choose the file, or paste it."));
    img.src = url;
  });
}

/**
 * Decode a `Blob`, a `data:` URL or an `http(s)` URL into an `ImageBitmap`. A remote URL is
 * fetched first (works for any site that sends `Access-Control-Allow-Origin`), then tried
 * as a cross-origin `<img>`; both fail on a site that allows neither, with a message that
 * says what to do instead.
 */
export async function loadImage(source: Blob | string): Promise<ImageBitmap> {
  if (typeof source !== "string") return bitmapOf(source);
  const text = source.trim();
  if (!looksLikeImageUrl(text)) throw new Error("Not an image URL — paste a link ending in .png / .jpg / …, or a data: URL.");
  if (/^data:/i.test(text)) {
    const res = await fetch(text);
    return bitmapOf(await res.blob());
  }
  try {
    const res = await fetch(text, { mode: "cors", cache: "force-cache" });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await bitmapOf(await res.blob());
  } catch (err) {
    // A CORS refusal surfaces as a TypeError from fetch; the <img> route gets the same answer from most
    // sites, but some send CORS headers only for image requests. Anything else (404, not an image) is final.
    if (!(err instanceof TypeError)) throw err;
    return bitmapViaImg(text);
  }
}

/** The first image on the clipboard, via the async Clipboard API; null when there is none or the page may not read it. */
export async function readClipboardImage(): Promise<Blob | null> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return item.getType(type);
    }
  } catch {
    // Permission denied or nothing readable.
  }
  return null;
}
