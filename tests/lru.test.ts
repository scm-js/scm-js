import { describe, expect, it } from "vitest";
import { LruCache } from "../src/lib/lru";

describe("LruCache", () => {
  const sized = (onEvict?: (v: number, k: string) => void) => new LruCache<string, number>(10, (v) => v, onEvict);

  it("evicts the least recently used entries once the budget is exceeded", () => {
    const gone: string[] = [];
    const c = sized((_, k) => gone.push(k));
    c.set("a", 4);
    c.set("b", 4);
    expect(c.used).toBe(8);
    c.set("c", 4); // 12 > 10: "a" goes
    expect(gone).toEqual(["a"]);
    expect(c.has("a")).toBe(false);
    expect(c.used).toBe(8);
  });

  it("a hit counts as use", () => {
    const gone: string[] = [];
    const c = sized((_, k) => gone.push(k));
    c.set("a", 4);
    c.set("b", 4);
    expect(c.get("a")).toBe(4);
    c.set("c", 4); // "b" is now the oldest
    expect(gone).toEqual(["b"]);
    expect(c.has("a")).toBe(true);
  });

  it("always keeps the entry just inserted, even one over the whole budget", () => {
    const gone: string[] = [];
    const c = sized((_, k) => gone.push(k));
    c.set("a", 4);
    c.set("big", 40);
    expect(gone).toEqual(["a"]);
    expect(c.get("big")).toBe(40);
    expect(c.size).toBe(1);
    expect(c.used).toBe(40);
  });

  it("replacing a key adjusts the total and reports the old value", () => {
    const gone: number[] = [];
    const c = sized((v) => gone.push(v));
    c.set("a", 4);
    c.set("a", 6);
    expect(gone).toEqual([4]);
    expect(c.used).toBe(6);
    expect(c.size).toBe(1);
  });

  it("delete and clear release what they drop", () => {
    const gone: string[] = [];
    const c = sized((_, k) => gone.push(k));
    c.set("a", 1);
    c.set("b", 2);
    expect(c.delete("a")).toBe(true);
    expect(c.delete("a")).toBe(false);
    expect(c.used).toBe(2);
    c.clear();
    expect(gone).toEqual(["a", "b"]);
    expect(c.size).toBe(0);
    expect(c.used).toBe(0);
  });
});
