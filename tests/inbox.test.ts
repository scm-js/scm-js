import { describe, expect, it } from "vitest";
import { INBOX_KEEPS_MS, inboxFor } from "../src/services/inbox";

describe("the site's inbox", () => {
  const now = 1_800_000_000_000;
  const meta = { v: 1, at: now - 2000, target: "editor", files: [{ name: "a.scx" }, { name: "game.rep" }] };

  it("is taken by the page it was left for", () => {
    expect(inboxFor(meta, "editor", now)).toEqual({ target: "editor", at: now - 2000, files: [{ name: "a.scx" }, { name: "game.rep" }] });
    expect(inboxFor(meta, "play", now)).toBeNull();
  });
  it("is not taken once it has waited too long, or is dated ahead", () => {
    expect(inboxFor({ ...meta, at: now - INBOX_KEEPS_MS - 1 }, "editor", now)).toBeNull();
    expect(inboxFor({ ...meta, at: now + INBOX_KEEPS_MS + 1 }, "editor", now)).toBeNull();
  });
  it("takes a name as a name, not a path, and nothing without one", () => {
    expect(inboxFor({ ...meta, files: [{ name: "../x/a.scx" }, { name: "" }, null] }, "editor", now)?.files).toEqual([{ name: ".._x_a.scx" }]);
    expect(inboxFor({ ...meta, files: [] }, "editor", now)).toBeNull();
    expect(inboxFor("nonsense", "editor", now)).toBeNull();
    expect(inboxFor(null, "editor", now)).toBeNull();
  });
});
