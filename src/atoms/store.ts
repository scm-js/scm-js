import type { createStore } from "jotai";

/** A Jotai store, as the functions that work on one outside React take it. */
export type Store = ReturnType<typeof createStore>;
