import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { dataSource } from "@/api/dataSource";
import type { Player } from "@/api/types";

/**
 * Client-side player roster.
 *
 * There is no write endpoint yet, so edits and additions made on 基本設定 are
 * held here and persisted to localStorage as an overlay on top of the fixture
 * roster. Because every roster view (選手資料庫, the player switcher, 基本設定)
 * reads through this store, adding a player on 基本設定 shows up everywhere —
 * this is the "資料庫會新增" behaviour until the real `POST /players` exists.
 *
 * Swap this for a mutation against `dataSource` once the backend lands; the
 * `usePlayers` / `usePlayer` call sites do not change.
 */

const OVERLAY_KEY = "pitchai.players.overlay";

/** What a coach fills in when adding a player. `id` / `teamId` are assigned here. */
export type NewPlayer = Omit<Player, "id" | "teamId">;
export type PlayerPatch = Partial<Omit<Player, "id" | "teamId">>;

interface Overlay {
  /** Players created in the browser, in creation order. */
  added: Player[];
  /** Field-level edits keyed by player id (covers fixture and added players). */
  edits: Record<string, PlayerPatch>;
  /** Ids of fixture players the coach has removed. */
  removed: string[];
}

const EMPTY: Overlay = { added: [], edits: {}, removed: [] };

function readOverlay(): Overlay {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Overlay>;
    return { added: parsed.added ?? [], edits: parsed.edits ?? {}, removed: parsed.removed ?? [] };
  } catch {
    return EMPTY;
  }
}

function writeOverlay(overlay: Overlay) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
  } catch {
    /* private mode / quota — the roster still works for this session */
  }
}

/** Fixture roster minus removals + edits applied + locally-added players. */
function merge(base: Player[], overlay: Overlay): Player[] {
  const apply = (p: Player): Player => ({ ...p, ...overlay.edits[p.id] });
  const removed = new Set(overlay.removed);
  return [
    ...base.filter((p) => !removed.has(p.id)).map(apply),
    ...overlay.added.filter((p) => !removed.has(p.id)).map(apply),
  ];
}

interface PlayersCtx {
  players: Player[];
  loading: boolean;
  error: Error | null;
  addPlayer: (input: NewPlayer) => Player;
  updatePlayer: (id: string, patch: PlayerPatch) => void;
  removePlayer: (id: string) => void;
}

const Context = createContext<PlayersCtx | null>(null);

export function PlayersProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<Player[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(readOverlay);

  useEffect(() => {
    let live = true;
    dataSource
      .getPlayers()
      .then((list) => live && setBase(list))
      .catch((e) => live && setError(e as Error));
    return () => {
      live = false;
    };
  }, []);

  const mutate = useCallback((next: Overlay) => {
    setOverlay(next);
    writeOverlay(next);
  }, []);

  const teamId = base?.[0]?.teamId ?? "team_ntsu";

  const addPlayer = useCallback<PlayersCtx["addPlayer"]>(
    (input) => {
      const player: Player = {
        ...input,
        id: `p_local_${Date.now().toString(36)}`,
        teamId,
      };
      mutate({ ...overlay, added: [...overlay.added, player] });
      return player;
    },
    [overlay, teamId, mutate],
  );

  const updatePlayer = useCallback<PlayersCtx["updatePlayer"]>(
    (id, patch) => {
      const isAdded = overlay.added.some((p) => p.id === id);
      if (isAdded) {
        mutate({
          ...overlay,
          added: overlay.added.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        });
      } else {
        mutate({
          ...overlay,
          edits: { ...overlay.edits, [id]: { ...overlay.edits[id], ...patch } },
        });
      }
    },
    [overlay, mutate],
  );

  const removePlayer = useCallback<PlayersCtx["removePlayer"]>(
    (id) => {
      const isAdded = overlay.added.some((p) => p.id === id);
      if (isAdded) {
        const edits = { ...overlay.edits };
        delete edits[id];
        mutate({ ...overlay, edits, added: overlay.added.filter((p) => p.id !== id) });
      } else if (!overlay.removed.includes(id)) {
        mutate({ ...overlay, removed: [...overlay.removed, id] });
      }
    },
    [overlay, mutate],
  );

  const value = useMemo<PlayersCtx>(
    () => ({
      players: base ? merge(base, overlay) : [],
      loading: base === null && error === null,
      error,
      addPlayer,
      updatePlayer,
      removePlayer,
    }),
    [base, overlay, error, addPlayer, updatePlayer, removePlayer],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

function usePlayersStore() {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("usePlayers must be used inside a PlayersProvider");
  return ctx;
}

interface PlayersResult extends PlayersCtx {
  /** Mirrors the old useAsync shape so existing call sites keep working. */
  data: Player[];
}

/** The roster plus its mutators. `data` is kept for the old useAsync shape. */
export function usePlayers(): PlayersResult {
  const store = usePlayersStore();
  return { ...store, data: store.players };
}

export function usePlayer(id: string) {
  const { players, loading, error } = usePlayersStore();
  return {
    data: players.find((p) => p.id === id),
    loading,
    error,
  };
}
