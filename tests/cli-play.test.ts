/**
 * `scmjs map play`: the map handed to the play page with `lobby: true`, and what the page says back — its invite link,
 * what it waits for, an error — forwarded by the loopback page to the command. The page itself is stood in for here:
 * the test reads the loopback page as a browser would and posts the messages the play page would send. The real
 * page was driven once by hand with headless Chromium against scm-sim's dev server and relay (the internals note).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kindOf, type Input } from "../cli/src/files";
import { playInLobby } from "../cli/src/open";
import { visible } from "../cli/src/ui";
import { TEST_MAPS_DIR } from "./support/maps";

const input = (): Input => { const bytes = new Uint8Array(readFileSync(join(TEST_MAPS_DIR, "melee.scx"))); return { path: "melee.scx", name: "melee.scx", bytes, kind: kindOf("melee.scx", bytes) }; };

/** The play page's half, as a script: `messages` posted to the loopback page's message route, then `scmjs.taken`. */
async function pageSays(address: string, messages: object[]): Promise<{ html: string; file: Uint8Array }> {
  const html = await (await fetch(address)).text();
  const file = new Uint8Array(await (await fetch(`${address}/file`)).arrayBuffer());
  for (const m of [...messages, { type: "scmjs.taken" }]) await fetch(`${address}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(m) });
  return { html, file };
}

describe("scmjs map play", () => {
  it("hands the map over with the lobby flag and prints the link the page reports", async () => {
    process.env.BROWSER = "none";
    const lines: string[] = [];
    let page = "";
    const done = playInLobby(input(), { play: "http://play.test/", live: (l) => lines.push(visible(l)), onAddress: (a) => { page = a; }, timeout: 10_000 });
    while (!page) await new Promise((r) => setTimeout(r, 10));
    const { html, file } = await pageSays(page, [
      { type: "scmjs.waiting", reason: "sign-in", message: "Sign in to open a lobby" },
      { type: "scmjs.invite", link: "https://scmjs.dev/play/?game=invite1abc", invite: "invite1abc", name: "melee.scx" },
    ]);
    const r = await done;
    expect(html).toContain("lobby = true");
    expect(html).toContain("handoff=1");
    expect(html).toContain("/message");
    expect(file).toEqual(input().bytes);
    expect(r).toEqual({ link: "https://scmjs.dev/play/?game=invite1abc", invite: "invite1abc", name: "melee.scx", waited: ["Sign in to open a lobby"], error: null });
    expect(lines.some((l) => l.includes("Sign in to open a lobby"))).toBe(true);
    expect(lines.some((l) => l.includes("Lobby open") && l.includes("invite1abc"))).toBe(true);
  });

  it("keeps the page's error when no lobby came, and the link when a retry on the page worked", async () => {
    process.env.BROWSER = "none";
    let page = "";
    const failed = playInLobby(input(), { play: "http://play.test/", onAddress: (a) => { page = a; }, timeout: 10_000 });
    while (!page) await new Promise((r) => setTimeout(r, 10));
    await pageSays(page, [{ type: "scmjs.error", message: "The relay refused" }]);
    expect(await failed).toMatchObject({ link: null, error: "The relay refused" });
    page = "";
    const retried = playInLobby(input(), { play: "http://play.test/", onAddress: (a) => { page = a; }, timeout: 10_000 });
    while (!page) await new Promise((r) => setTimeout(r, 10));
    await pageSays(page, [{ type: "scmjs.error", message: "The relay refused" }, { type: "scmjs.invite", link: "https://scmjs.dev/play/?game=invite1def", invite: "invite1def", name: "melee.scx" }]);
    expect(await retried).toMatchObject({ link: "https://scmjs.dev/play/?game=invite1def", error: null });
  });

  it("gives up when the page never answers", async () => {
    process.env.BROWSER = "none";
    await expect(playInLobby(input(), { play: "http://play.test/", timeout: 300 })).rejects.toThrow(/did not take the file/);
  });
});
