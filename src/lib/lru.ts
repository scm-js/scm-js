/**
 * A least-recently-used cache with a size budget rather than an entry count: the sprite
 * frame cache holds canvases from 8×8 to 256×256, so a count says nothing about memory.
 * `Map` iterates in insertion order, so a hit moves the entry to the end by re-inserting
 * it and eviction walks from the front.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, { value: V; size: number }>();
  private held = 0;
  /** The most `sizeOf` may add up to before the oldest entries go. */
  readonly budget: number;
  private readonly sizeOf: (value: V) => number;
  /** Called for every evicted value, so a holder of native resources can release them. */
  private readonly onEvict: ((value: V, key: K) => void) | undefined;

  constructor(budget: number, sizeOf: (value: V) => number, onEvict?: (value: V, key: K) => void) {
    this.budget = budget;
    this.sizeOf = sizeOf;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  /** What the entries add up to under `sizeOf`. */
  get used(): number {
    return this.held;
  }

  get(key: K): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.value;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  /** Insert or replace; then evict the oldest until the budget holds (the new entry always stays). */
  set(key: K, value: V): void {
    const old = this.entries.get(key);
    if (old) {
      this.entries.delete(key);
      this.held -= old.size;
      if (old.value !== value) this.onEvict?.(old.value, key);
    }
    const size = Math.max(0, this.sizeOf(value));
    this.entries.set(key, { value, size });
    this.held += size;
    for (const [k, e] of this.entries) {
      if (this.held <= this.budget || k === key) break;
      this.entries.delete(k);
      this.held -= e.size;
      this.onEvict?.(e.value, k);
    }
  }

  delete(key: K): boolean {
    const e = this.entries.get(key);
    if (!e) return false;
    this.entries.delete(key);
    this.held -= e.size;
    this.onEvict?.(e.value, key);
    return true;
  }

  clear(): void {
    for (const [k, e] of this.entries) this.onEvict?.(e.value, k);
    this.entries.clear();
    this.held = 0;
  }

  keys(): IterableIterator<K> {
    return this.entries.keys();
  }
}
