/**
 * The hash of a mod that is game files alone (no plugin, library or FireGraft project), from the files' bytes: one line
 * `name<TAB>sha256` a file by its game name, as `@scm-js/mod`'s `hashLines` takes them. For a test that makes such a
 * mod and checks what a command says its hash is.
 */
import { gameName, hashLines, sha256Hex } from "@scm-js/mod";

export async function gameFilesHash(files: readonly { name: string; bytes: Uint8Array }[]): Promise<string> {
  const lines: string[] = [];
  for (const f of files) lines.push(`${gameName(f.name)}\t${await sha256Hex(f.bytes)}`);
  return hashLines(lines);
}
