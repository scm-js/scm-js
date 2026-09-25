/**
 * Recovery copies of modified maps: the decisions, kept pure so they can be tested without
 * IndexedDB or a timer. `services/recovery.ts` does the storing and `hooks/useRecovery.ts`
 * the watching; this file only says which maps to copy, which copies to drop, and which
 * copies are left over from a session that has ended.
 */

/** What the plan needs to know about one open map. */
export interface OpenMapState {
  id: number;
  modified: boolean;
  /** Edited since its copy was last written (or never copied). */
  changed: boolean;
}

export interface RecoveryPlan {
  /** Open maps whose copy is to be written now. */
  write: number[];
  /** Maps whose copy is to be dropped: saved, closed, or copies switched off. */
  remove: number[];
}

/**
 * Which copies to write and which to drop. A map is copied while it has unsaved changes and
 * has changed since its last copy; a copy goes as soon as its map is saved or closed, so a
 * copy that survives a session is always one of work that was never saved. `written` is the
 * set of maps this session holds a copy of.
 */
export function planRecovery(open: readonly OpenMapState[], written: ReadonlySet<number>, enabled: boolean): RecoveryPlan {
  const write: number[] = [];
  const remove: number[] = [];
  const openIds = new Set<number>();
  for (const m of open) {
    openIds.add(m.id);
    if (enabled && m.modified) {
      if (m.changed || !written.has(m.id)) write.push(m.id);
    } else if (written.has(m.id)) {
      remove.push(m.id);
    }
  }
  for (const id of written) if (!openIds.has(id)) remove.push(id);
  return { write, remove };
}

/** The part of a stored copy that says whose it is and when it was made. */
export interface RecoveryOwner {
  session: string;
  at: number;
}

/**
 * The copies nobody is working on any more: not this session's, and not a session that is
 * still running in another tab or window (`live`, the sessions holding their lock; null when
 * the browser cannot say, in which case every other session's copies count as left over).
 * Newest first.
 */
export function leftoverCopies<T extends RecoveryOwner>(records: readonly T[], session: string, live: ReadonlySet<string> | null): T[] {
  return records
    .filter((r) => r.session !== session && !(live?.has(r.session) ?? false))
    .sort((a, b) => b.at - a.at);
}

/** The key a copy is stored under: one per map per session, so a later write replaces the earlier. */
export function recoveryKey(session: string, id: number): string {
  return `${session}:${id}`;
}
