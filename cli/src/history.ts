/**
 * A map's history in git, read fast: the commits that touched the file (`git log -- <path>`, parents rewritten so a
 * merge names the commits that touched the file before it), the blob id of each version (one `git cat-file
 * --batch-check` for all of them), and the blobs themselves in batches through `git cat-file --batch`, each parsed
 * once. `map log` and `map blame` (maplog.ts, blame.ts) are built on it, and `map diff --rev` finds the file with it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { OpenedMap } from "../../src/editor/mapFile";
import { kindOf, loadMapInput } from "./files";
import { t } from "./i18n";
import { CliError } from "./ui";

/** A file in a git repository: the repository's top folder and the file's path from there, with `/`. */
export interface GitFile { root: string; path: string; name: string }

const git = (args: string[], input?: string) => spawnSync("git", args, { maxBuffer: 2 * 1024 * 1024 * 1024, input: input === undefined ? undefined : Buffer.from(input) });

/**
 * Where `file` is in its repository. `--show-prefix` from the file's own folder, so a folder reached through a
 * symbolic link still gives the path git knows; works from any folder of the repository.
 */
export function locate(file: string): GitFile {
  // A folder has a history too, which git would list as the map's ("map removed" in each commit).
  if (existsSync(file) && statSync(file).isDirectory()) throw new CliError(t("{file} is a folder, not a map", { file }), t("Name a map in it (.scm, .scx, .chk)."), 2);
  const dir = dirname(resolve(file));
  const r = git(["-C", dir, "rev-parse", "--show-toplevel", "--show-prefix"]);
  if (r.error) throw new CliError(t("git is not installed, or not on PATH"), t("A map's history is read through git."), 2);
  if (r.status !== 0) throw new CliError(t("{file} is not in a git repository", { file }), r.stderr.toString().trim().split("\n")[0] || null, 2);
  const [root, prefix = ""] = r.stdout.toString().split("\n");
  return { root, path: `${prefix}${basename(file)}`, name: basename(file) };
}

export interface Commit {
  hash: string;
  /** The parents that touched the file (git's parent rewriting), or the range's boundary. */
  parents: string[];
  author: string;
  email: string;
  /** The author's date, ISO 8601 in the author's time zone. */
  date: string;
  subject: string;
}

/** A revision as the person gave it: refused when it would read as an option of git's. */
function checkRevision(rev: string): void {
  if (!rev || rev.startsWith("-")) throw new CliError(rev ? t("{rev} is not a revision", { rev }) : t("An empty revision is not a revision"), t("A commit, branch or tag (HEAD~3, main, v1.0), or a range A..B."), 2);
}

/**
 * The commits that changed the file, newest first: `git log <rev> -- <path>`. `topo` keeps every commit before its
 * parents (blame needs that); `limit` is `-n`.
 */
export function commitsTouching(f: GitFile, rev: string, o: { topo?: boolean; limit?: number } = {}): Commit[] {
  checkRevision(rev);
  const args = ["-C", f.root, "log", "--parents", "--format=%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s", ...(o.topo ? ["--topo-order", ...(o.limit ? ["-n", String(o.limit)] : [])] : []), rev, "--", f.path];
  const r = git(args);
  if (r.status !== 0) throw new CliError(t("git does not know the revision {rev}", { rev }), r.stderr.toString().trim().split("\n")[0] || null, 2);
  const commits = r.stdout.toString().split("\x1e").filter((s) => s.trim()).map((rec) => {
    const [hash, parents, author, email, date, subject] = rec.replace(/\n+$/, "").split("\x1f");
    return { hash, parents: parents ? parents.split(" ") : [], author, email, date, subject: subject ?? "" };
  });
  if (o.topo) return commits;
  // Parent rewriting makes git walk the whole history first and list it by commit date, so a commit dated before its
  // parent (a rebase, a cherry-pick) came after it. The order is `git log -- <path>`'s own, asked for apart.
  const order = git(["-C", f.root, "log", "--format=%H", ...(o.limit ? ["-n", String(o.limit)] : []), rev, "--", f.path]);
  if (order.status !== 0) return o.limit ? commits.slice(0, o.limit) : commits;
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  return order.stdout.toString().split("\n").map((h) => byHash.get(h.trim())).filter((c): c is Commit => !!c);
}

/** The blob id of each `<commit>:<path>`, or null where that commit has no such file. One git call for all of them. */
export function blobIds(f: GitFile, specs: readonly string[]): (string | null)[] {
  if (!specs.length) return [];
  const r = git(["-C", f.root, "cat-file", "--batch-check"], specs.join("\n") + "\n");
  if (r.status !== 0) throw new CliError(t("git could not list the map's versions"), r.stderr.toString().trim().split("\n")[0] || null);
  const lines = r.stdout.toString().split("\n");
  return specs.map((_, i) => {
    const m = /^([0-9a-f]{40,64}) blob \d+$/.exec(lines[i] ?? "");
    return m ? m[1] : null;
  });
}

/** Blobs by id, read through `git cat-file --batch`. */
export function readBlobs(f: GitFile, oids: readonly string[]): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (!oids.length) return out;
  const r = git(["-C", f.root, "cat-file", "--batch"], oids.join("\n") + "\n");
  if (r.status !== 0) throw new CliError(t("git could not read the map's versions"), r.stderr.toString().trim().split("\n")[0] || null);
  const buf = r.stdout;
  let at = 0;
  for (const oid of oids) {
    const nl = buf.indexOf(0x0a, at);
    if (nl < 0) break;
    const head = buf.subarray(at, nl).toString();
    const m = /^([0-9a-f]+) (\w+) (\d+)$/.exec(head);
    if (!m) { at = nl + 1; continue; } // "<oid> missing"
    const n = Number(m[3]);
    out.set(oid, new Uint8Array(buf.subarray(nl + 1, nl + 1 + n)));
    at = nl + 1 + n + 1;
  }
  return out;
}

/** How many blobs one `cat-file --batch` call reads: few calls on a long history, few maps held at once. */
const BATCH = 24;

/**
 * The versions of one map, by blob id: read from git in batches (the ids queued with `expect` are fetched in the order
 * given, a batch at a time) and parsed once each. `keep` is how many parsed maps stay in memory — `map log` walks
 * consecutive pairs and needs three; `map blame` keeps what it took out of a map, not the map.
 */
export class Versions {
  private readonly queue: string[] = [];
  private readonly fetched = new Map<string, Uint8Array>();
  private readonly parsed = new Map<string, OpenedMap>();
  /** How many blobs were read, and how many parsed — the measurements in the internals note. */
  readonly counts = { read: 0, parsed: 0, calls: 0 };
  private readonly file: GitFile;
  private readonly keep: number;
  constructor(file: GitFile, keep = 3) { this.file = file; this.keep = keep; }

  /** Blob ids that will be asked for, in the order they will be. */
  expect(oids: Iterable<string | null>): void {
    const seen = new Set(this.queue);
    for (const o of oids) if (o && !seen.has(o)) { seen.add(o); this.queue.push(o); }
  }

  bytes(oid: string): Uint8Array {
    let b = this.fetched.get(oid);
    if (!b) {
      const want = [oid, ...this.queue.filter((o) => o !== oid && !this.fetched.has(o) && !this.parsed.has(o)).slice(0, BATCH - 1)];
      for (const [k, v] of readBlobs(this.file, want)) this.fetched.set(k, v);
      this.counts.calls++;
      this.counts.read += want.length;
      b = this.fetched.get(oid);
      if (!b) throw new CliError(t("git has no blob {oid}", { oid }));
    }
    return b;
  }

  /** The map in blob `oid`, parsed once while it is kept. A version that cannot be read is a CliError. */
  async map(oid: string): Promise<OpenedMap> {
    const hit = this.parsed.get(oid);
    if (hit) { this.parsed.delete(oid); this.parsed.set(oid, hit); return hit; }
    const bytes = this.bytes(oid);
    this.fetched.delete(oid);
    const i = this.queue.indexOf(oid);
    if (i >= 0) this.queue.splice(i, 1);
    const doc = await loadMapInput({ path: this.file.name, name: this.file.name, bytes, kind: kindOf(this.file.name, bytes) });
    this.counts.parsed++;
    if (this.keep > 0) {
      this.parsed.set(oid, doc);
      while (this.parsed.size > this.keep) this.parsed.delete(this.parsed.keys().next().value!);
    }
    return doc;
  }
}

/** A commit's hash as the tables show it. */
export const short = (hash: string, n = 7) => hash.slice(0, n);

/** `2026-11-07 14:02` from git's ISO date, in the author's own time zone, as git log shows it. */
export const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
