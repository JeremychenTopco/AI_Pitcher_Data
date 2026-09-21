import type { Pitch } from "@/api/types";

/**
 * Client-side "標記最愛" overlay for pitches.
 *
 * There is no write endpoint yet, so a toggle is held here and persisted to
 * localStorage as an overlay on top of whatever `starred` value the fixture
 * shipped with — same pattern as PlayersStore for player edits. Every pitch
 * list applies `applyStarredOverlay` after fetching and calls `setStarred` +
 * updates its own local state on toggle, so each pitch's mark is independent
 * of every other one (keyed by pitch id, never by list position).
 *
 * Swap for a mutation against `dataSource` once the backend lands.
 */

const OVERLAY_KEY = "pitchai.pitches.starredOverlay";

function readOverlay(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeOverlay(overlay: Record<string, boolean>) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
  } catch {
    /* private mode / quota — the toggle still works for this session */
  }
}

/** Apply any locally-toggled `starred` values on top of a freshly-fetched pitch list. */
export function applyStarredOverlay<T extends Pitch>(pitches: T[]): T[] {
  const overlay = readOverlay();
  return pitches.map((p) => (p.id in overlay ? { ...p, starred: overlay[p.id] } : p));
}

/** Persist one pitch's starred state. Call alongside your own list state update. */
export function setStarred(id: string, starred: boolean) {
  const overlay = readOverlay();
  overlay[id] = starred;
  writeOverlay(overlay);
}
