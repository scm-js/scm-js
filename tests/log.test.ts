import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  baseName, BUG_REPORT_BUDGET, clearLog, formatData, formatEntry, formatLog, log, logDropped,
  logEntries, logError, LOG_CAPACITY, resetLogForTests, scrubFrame, stamp, subscribeLog,
} from "../src/editor/log";
import { diagnosticsHeader, shortAgent } from "../src/editor/diagnostics";

// `log` mirrors warn and error to the browser's console on purpose; the suite is not the
// place to read them.
beforeEach(() => {
  resetLogForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {}).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

describe("the log buffer", () => {
  it("keeps entries in order with their own sequence numbers", () => {
    log("info", "app", "one");
    log("warn", "plugins", "two");
    const entries = logEntries();
    expect(entries.map((e) => e.message)).toEqual(["one", "two"]);
    expect(entries[1].seq).toBe(entries[0].seq + 1);
    expect(entries[1].level).toBe("warn");
  });

  it("drops undefined facts rather than printing them", () => {
    log("info", "document", "Map open", { file: "x.scx", width: 64, open: undefined });
    expect(logEntries()[0].data).toEqual({ file: "x.scx", width: 64 });
  });

  it("holds no `data` at all when every fact was undefined", () => {
    log("info", "app", "bare", { a: undefined });
    expect(logEntries()[0].data).toBeUndefined();
  });

  it("overwrites the oldest entries and counts what it dropped", () => {
    for (let i = 0; i < LOG_CAPACITY + 5; i++) log("info", "app", `entry ${i}`);
    const entries = logEntries();
    expect(entries).toHaveLength(LOG_CAPACITY);
    expect(entries[0].message).toBe("entry 5");
    expect(entries[LOG_CAPACITY - 1].message).toBe(`entry ${LOG_CAPACITY + 4}`);
    expect(logDropped()).toBe(5);
  });

  it("collapses a line repeated in a row, and keeps its sequence number", () => {
    log("info", "Paint", "document.isOpen()");
    log("info", "Paint", "document.isOpen()");
    log("info", "Paint", "document.isOpen()");
    const entries = logEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].repeat).toBe(3);
    expect(formatEntry(entries[0])).toContain("×3");
    // And the next distinct line follows it rather than taking its number.
    log("info", "Paint", "document.info()");
    expect(logEntries().map((e) => e.seq)).toEqual([1, 2]);
  });

  it("collapses a line that comes round again, not only one repeated back to back", () => {
    // Five plugins asking the same question in turn every frame is the shape of the flood.
    for (let i = 0; i < 3; i++) { log("info", "Paint", "document.isOpen()"); log("info", "Repair", "document.isOpen()"); }
    const entries = logEntries();
    expect(entries.map((e) => e.source)).toEqual(["Paint", "Repair"]);
    expect(entries.map((e) => e.repeat)).toEqual([3, 3]);
  });

  it("still tells the browser's console about every warning, collapsed or not", () => {
    log("warn", "plugins", "careful");
    log("warn", "plugins", "careful");
    expect(logEntries()).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("keeps lines apart when their facts differ", () => {
    log("info", "Paint", "same", { n: 1 });
    log("info", "Paint", "same", { n: 2 });
    log("info", "Paint", "same");
    expect(logEntries()).toHaveLength(3);
  });

  it("starts a new line once the old one is no longer recent", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    log("info", "app", "tick");
    const first = logEntries()[0].at;
    now.mockReturnValue(1_000_500);
    log("info", "app", "tick");
    expect(logEntries()).toHaveLength(1);
    // The time is the first sighting's, so the list stays in order.
    expect(logEntries()[0].at).toBe(first);
    now.mockReturnValue(1_002_000);
    log("info", "app", "tick");
    expect(logEntries().map((e) => e.repeat)).toEqual([2, undefined]);
    now.mockRestore();
  });

  it("empties on clear, and forgets what it had dropped", () => {
    for (let i = 0; i < LOG_CAPACITY + 5; i++) log("info", "app", `entry ${i}`);
    clearLog();
    expect(logEntries()).toEqual([]);
    expect(logDropped()).toBe(0);
  });

  it("coalesces its notifications rather than waking a listener per write", async () => {
    const woken = vi.fn();
    subscribeLog(woken);
    for (let i = 0; i < 50; i++) log("info", "app", `entry ${i}`);
    expect(woken).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 150));
    expect(woken).toHaveBeenCalledTimes(1);
  });

  it("survives a listener that throws", async () => {
    subscribeLog(() => { throw new Error("no"); });
    const after = vi.fn();
    subscribeLog(after);
    log("info", "app", "x");
    await new Promise((r) => setTimeout(r, 150));
    expect(after).toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("takes the message and the stack off an Error", () => {
    logError("plugins", "Repair did not load", new Error("404"));
    const entry = logEntries()[0];
    expect(entry.level).toBe("error");
    expect(entry.message).toBe("Repair did not load: 404");
    expect(entry.stack).toContain("Error: 404");
  });

  it("does not repeat a detail the message already carries", () => {
    logError("plugins", "the fetch failed: 404", new Error("404"));
    expect(logEntries()[0].message).toBe("the fetch failed: 404");
  });

  it("takes whatever was thrown when it was not an Error", () => {
    logError("app", "Unhandled promise rejection", "gone");
    expect(logEntries()[0].message).toBe("Unhandled promise rejection: gone");
    expect(logEntries()[0].stack).toBeUndefined();
  });

  it("says only the message when nothing was thrown with it", () => {
    logError("app", "Something went wrong");
    expect(logEntries()[0].message).toBe("Something went wrong");
  });
});

describe("rendering", () => {
  it("stamps seconds since the log started", () => {
    expect(stamp(0)).toBe("   0.000");
    expect(stamp(12345)).toBe("  12.345");
  });

  it("quotes a value with a space in it and leaves a plain one alone", () => {
    expect(formatData({ file: "x.scx", label: "Fill terrain", n: 3 })).toBe('file=x.scx label="Fill terrain" n=3');
    expect(formatData(undefined)).toBe("");
  });

  it("marks the level in a column of its own", () => {
    log("warn", "plugins", "careful");
    expect(formatEntry(logEntries()[0])).toContain("! plugins: careful");
  });

  it("puts the header above the entries and says what it dropped", () => {
    log("info", "app", "one");
    const text = formatLog(logEntries(), "scm-js 0.1.0 · browser", 12);
    expect(text.startsWith("scm-js 0.1.0 · browser\n\n")).toBe(true);
    expect(text).toContain("12 earlier entries dropped");
    expect(text.trimEnd().endsWith("app: one")).toBe(true);
  });

  it("indents a stack under its entry", () => {
    logError("app", "Uncaught error", new Error("boom"));
    const lines = formatLog(logEntries()).split("\n");
    expect(lines[0]).toContain("× app: Uncaught error: boom");
    expect(lines[1]).toMatch(/^ {9}Error: boom/);
  });
});

describe("the copy a bug report gets", () => {
  it("keeps the newest entries within the budget and says what it left out", () => {
    for (let i = 0; i < 200; i++) log("info", "app", `line ${i} ${"x".repeat(80)}`);
    const text = formatLog(logEntries(), "scm-js 0.1.0 · browser", 0, 2000);
    expect(text.length).toBeLessThan(2000 + 200);
    // The tail is what is kept, and the count is of what is not.
    expect(text).toContain("app: line 199");
    expect(text).not.toContain("app: line 100 ");
    const omitted = /… (\d+) earlier entries left out/.exec(text);
    expect(omitted).not.toBeNull();
    expect(Number(omitted?.[1])).toBeGreaterThan(150);
    expect(text).toContain("Debug Console ▸ Save…");
  });

  it("adds what the ring dropped to what the budget cut", () => {
    for (let i = 0; i < 50; i++) log("info", "app", `line ${i} ${"x".repeat(80)}`);
    const text = formatLog(logEntries(), "", 12, 500);
    const omitted = Number(/… (\d+) earlier entries left out/.exec(text)?.[1]);
    expect(omitted).toBeGreaterThan(12 + 40);
  });

  it("keeps the whole log when it fits, and says nothing about trimming", () => {
    log("info", "app", "one");
    const text = formatLog(logEntries(), "", 0, BUG_REPORT_BUDGET);
    expect(text).toContain("app: one");
    expect(text).not.toContain("left out");
  });

  it("keeps one entry however big it is, rather than copying nothing", () => {
    log("info", "app", "x".repeat(500));
    const text = formatLog(logEntries(), "", 0, 10);
    expect(text).toContain("x".repeat(500));
  });

  it("does not copy without a budget", () => {
    for (let i = 0; i < 100; i++) log("info", "app", `line ${i} ${"x".repeat(80)}`);
    expect(formatLog(logEntries())).toContain("app: line 0");
  });
});

describe("a stack frame in a shared log", () => {
  it("keeps the file, the line and the column and drops the folders in front of them", () => {
    expect(scrubFrame("at draw (file:///C:/Users/someone/scm-js/dist/index.js:12:5)")).toBe("at draw (index.js:12:5)");
    expect(scrubFrame("at http://localhost:5173/src/editor/log.ts:120:9")).toBe("at log.ts:120:9");
    expect(scrubFrame("at run (/home/someone/app/main.js:3:1)")).toBe("at run (main.js:3:1)");
    expect(scrubFrame("at open (C:\\Users\\someone\\app\\main.js:3:1)")).toBe("at open (main.js:3:1)");
  });

  it("leaves alone what is not a path", () => {
    expect(scrubFrame("Error: bad ratio 3/4")).toBe("Error: bad ratio 3/4");
    expect(scrubFrame("at new Promise (<anonymous>)")).toBe("at new Promise (<anonymous>)");
    expect(scrubFrame("at Object.<anonymous>")).toBe("at Object.<anonymous>");
  });

  it("scrubs the stack a copied log carries", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at draw (file:///C:/Users/someone/app/index.js:12:5)";
    logError("app", "Uncaught error", err);
    const text = formatLog(logEntries());
    expect(text).toContain("at draw (index.js:12:5)");
    expect(text).not.toContain("someone");
  });
});

describe("what a shared log does not carry", () => {
  it("keeps a file's name and drops the folders in front of it", () => {
    expect(baseName("C:\\Users\\someone\\Maps\\lost temple.scx")).toBe("lost temple.scx");
    expect(baseName("/home/someone/maps/lt.scm")).toBe("lt.scm");
    expect(baseName("lt.scm")).toBe("lt.scm");
    expect(baseName(null)).toBeUndefined();
    expect(baseName("")).toBeUndefined();
  });

  it("cuts a user agent to the engine and the system", () => {
    expect(shortAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")).toBe("Chrome 126 on Windows");
    expect(shortAgent("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0")).toBe("Firefox 127 on Linux");
    expect(shortAgent("something else entirely")).toBe("unknown");
  });
});

describe("the diagnostics header", () => {
  const base = { version: "0.1.0", host: "browser", plugins: [] };

  it("says when there is no game data and no map, rather than leaving the line out", () => {
    const text = diagnosticsHeader(base);
    expect(text).toContain("Game data: none");
    expect(text).toContain("Map: none open");
    expect(text).toContain("Plugins: none");
  });

  it("describes the map on one line", () => {
    const text = diagnosticsHeader({
      ...base,
      gameData: "Bundled files",
      map: { file: "lt.scx", width: 128, height: 128, tileset: "Jungle", version: "Brood War", modified: true, open: 3 },
    });
    expect(text).toContain("Map: lt.scx · 128×128 · Jungle · Brood War · modified · 3 open");
  });

  it("calls an unsaved map unsaved, and does not count a single open map", () => {
    const text = diagnosticsHeader({
      ...base,
      map: { width: 64, height: 64, tileset: "Ice", version: "Brood War", modified: false, open: 1 },
    });
    expect(text).toContain("Map: unsaved · 64×64 · Ice · Brood War");
    expect(text).not.toContain("open");
  });

  it("lists the plugins with their versions, and a failure with its reason", () => {
    const text = diagnosticsHeader({
      ...base,
      plugins: [
        { name: "Repair", version: "1.2.0", status: "active" },
        { name: "TrigScript", status: "error", error: "The fetch failed." },
      ],
    });
    expect(text).toContain("  Repair 1.2.0 — active");
    expect(text).toContain("  TrigScript — error: The fetch failed.");
  });
});
