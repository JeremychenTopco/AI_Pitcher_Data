import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { dataSource } from "@/api/dataSource";
import { usePlayer, usePlayers, useSessions } from "@/api/hooks";
import { useSession } from "@/app/SessionContext";
import { applyStarredOverlay, setStarred } from "@/app/starredStore";
import { TopBar } from "@/components/common/TopBar";
import { PitchCard } from "@/components/common/PitchCard";
import { ErrorNote, Loading, PlayerAvatar } from "@/components/common";
import type { Pitch, Session } from "@/api/types";

type SortOrder = "desc" | "asc";

/**
 * 選手日誌. Every pitch the player has thrown, laid out as thumbnails and
 * grouped by date — this is the view players land on directly and the one
 * coaches reach after picking a player from the roster.
 */
export function PlayerDetailPage() {
  const { playerId = "" } = useParams();
  const { role } = useSession();
  const player = usePlayer(playerId);
  const players = usePlayers();
  const sessions = useSessions(playerId);

  const [order, setOrder] = useState<SortOrder>("desc");
  const [pitchesByDate, setPitchesByDate] = useState<Record<string, Pitch[]> | null>(null);

  // Pull every session's pitches so the log can be presented as one flat,
  // date-grouped grid rather than making the user open each session.
  useEffect(() => {
    const list = sessions.data;
    if (!list) return;
    let live = true;
    Promise.all(list.map((s) => dataSource.getPitches(s.id).then((p) => [s, p] as const)))
      .then((pairs) => {
        if (!live) return;
        const byDate: Record<string, Pitch[]> = {};
        pairs.forEach(([s, list]) => {
          byDate[s.date] = [...(byDate[s.date] ?? []), ...applyStarredOverlay(list)];
        });
        setPitchesByDate(byDate);
      })
      .catch(() => live && setPitchesByDate({}));
    return () => {
      live = false;
    };
  }, [sessions.data]);

  const dates = useMemo(() => {
    const keys = Object.keys(pitchesByDate ?? {});
    keys.sort((a, b) => (order === "desc" ? b.localeCompare(a) : a.localeCompare(b)));
    return keys;
  }, [pitchesByDate, order]);

  if (player.loading || sessions.loading) return <Loading />;
  if (player.error) return <ErrorNote error={player.error} />;
  if (!player.data) return <p className="p-6 text-sm">找不到這位選手。</p>;

  const p = player.data;
  const totalPitches = (sessions.data ?? []).reduce((n, s) => n + s.pitchCount, 0);

  // Keyed by pitch id, so toggling one card never touches any other pitch's mark.
  const handleToggleStar = (id: string, next: boolean) => {
    setStarred(id, next);
    setPitchesByDate((byDate) => {
      if (!byDate) return byDate;
      const updated: Record<string, Pitch[]> = {};
      for (const [date, list] of Object.entries(byDate)) {
        updated[date] = list.map((pitch) => (pitch.id === id ? { ...pitch, starred: next } : pitch));
      }
      return updated;
    });
  };

  return (
    <>
      <TopBar
        breadcrumb={
          role === "coach"
            ? [{ label: "選手資料庫", to: "/players" }, { label: p.name }]
            : [{ label: "選手資料庫" }, { label: p.name }]
        }
      />

      <div className="p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-4">
            <PlayerAvatar url={p.avatarUrl} name={p.name} className="size-14" />
            <div>
              <h1 className="text-2xl font-bold">
                {p.name} <span className="text-neutral-400">▪</span> 投球紀錄
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                共 {totalPitches} 球 · {p.throws === "L" ? "左投" : "右投"} · {p.heightCm}cm / {p.weightKg}kg
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {role === "coach" && <PlayerSelect players={players.data ?? []} current={playerId} />}
            <button
              type="button"
              onClick={() => setOrder((o) => (o === "desc" ? "asc" : "desc"))}
              className="bg-[var(--color-brand)] px-4 py-2 text-xs font-bold"
            >
              日期 {order === "desc" ? "↓" : "↑"}
            </button>
          </div>
        </div>

        {!pitchesByDate ? (
          <Loading label="載入投球紀錄…" />
        ) : dates.length === 0 ? (
          <EmptyLog />
        ) : (
          <div className="mt-6 flex flex-col gap-8">
            {dates.map((date) => (
              <section key={date}>
                <h2 className="mb-3 text-base font-bold">{date.replaceAll("-", "/")}</h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {pitchesByDate[date].map((pitch) => (
                    <PitchCard key={pitch.id} pitch={pitch} onToggleStar={handleToggleStar} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PlayerSelect({ players, current }: { players: Array<{ id: string; name: string }>; current: string }) {
  const nav = useNavigate();
  return (
    <label className="relative">
      <span className="sr-only">切換球員</span>
      <select
        value={current}
        onChange={(e) => nav(`/players/${e.target.value}`)}
        className="appearance-none bg-[var(--color-brand)] py-2 pr-9 pl-4 text-xs font-bold"
      >
        {players.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2"
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </label>
  );
}

function EmptyLog() {
  return (
    <p className="mt-8 rounded-lg border border-dashed border-neutral-400 p-10 text-center text-sm text-neutral-500">
      這位選手還沒有投球紀錄。完成一次檢測後就會出現在這裡。
    </p>
  );
}

/** Kept for the session-scoped route; same grid, filtered to one session. */
export function SessionPage() {
  const { sessionId = "" } = useParams();
  const [state, setState] = useState<{ session: Session | undefined; pitches: Pitch[] } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([dataSource.getSession(sessionId), dataSource.getPitches(sessionId)]).then(
      ([session, pitches]) => live && setState({ session, pitches: applyStarredOverlay(pitches) }),
    );
    return () => {
      live = false;
    };
  }, [sessionId]);

  // session.playerName is a snapshot baked in when the fixture was generated
  // — a 基本設定 rename never touches it. usePlayer reads through
  // PlayersStore's live overlay instead, so a rename shows up here too.
  const player = usePlayer(state?.session?.playerId ?? "");

  if (!state) return <Loading />;
  const { session, pitches } = state;
  const playerName = player.data?.name ?? session?.playerName;

  // Keyed by pitch id, so toggling one card never touches any other pitch's mark.
  const handleToggleStar = (id: string, next: boolean) => {
    setStarred(id, next);
    setState((s) => (s ? { ...s, pitches: s.pitches.map((p) => (p.id === id ? { ...p, starred: next } : p)) } : s));
  };

  return (
    <>
      <TopBar
        breadcrumb={[
          { label: "選手資料庫", to: "/players" },
          { label: playerName ?? "", to: session ? `/players/${session.playerId}` : undefined },
          { label: `${session?.date} ${session?.label}` },
        ]}
      />
      <div className="p-6">
        <h1 className="text-2xl font-bold">
          {playerName} <span className="text-neutral-400">▪</span> {session?.date} {session?.label}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">共 {session?.pitchCount} 球</p>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {pitches.map((p) => (
            <PitchCard key={p.id} pitch={p} onToggleStar={handleToggleStar} />
          ))}
        </div>
      </div>
    </>
  );
}
