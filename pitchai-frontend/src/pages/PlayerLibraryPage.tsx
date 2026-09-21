import { Navigate, Link } from "react-router-dom";
import { usePlayers, useSessions } from "@/api/hooks";
import { useSession } from "@/app/SessionContext";
import { TopBar } from "@/components/common/TopBar";
import { ErrorNote, Loading, PlayerAvatar } from "@/components/common";

/**
 * 選手資料庫.
 *
 * Coaches land on the roster and pick a player first. Players have only one
 * player to look at, so they skip this level entirely and go straight to their
 * own log — same destination, one less click.
 */
export function PlayerLibraryPage() {
  const { role, user } = useSession();
  const players = usePlayers();
  const sessions = useSessions();

  if (role === "player") {
    return <Navigate to={`/players/${user.playerId}`} replace />;
  }

  if (players.loading || sessions.loading) return <Loading />;
  if (players.error) return <ErrorNote error={players.error} />;

  return (
    <>
      <TopBar breadcrumb={[{ label: "選手資料庫" }]} />
      <div className="p-6">
        <h1 className="text-2xl font-bold">選手資料庫</h1>
        <p className="mt-1 text-sm text-neutral-500">共 {players.data?.length ?? 0} 位選手</p>

        <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {(players.data ?? []).map((p) => {
            const own = (sessions.data ?? []).filter((s) => s.playerId === p.id);
            const latest = own[0];
            const totalPitches = own.reduce((sum, s) => sum + s.pitchCount, 0);
            return (
              <Link key={p.id} to={`/players/${p.id}`} className="rounded-lg bg-white p-4 hover:bg-neutral-50">
                <PlayerAvatar url={p.avatarUrl} name={p.name} className="mx-auto size-20" />
                <p className="mt-3 text-center text-sm font-bold">{p.name}</p>
                <p className="mt-0.5 text-center text-xs text-neutral-500">
                  {p.throws === "L" ? "左投" : "右投"} · {p.heightCm}cm / {p.weightKg}kg
                </p>
                <div className="mt-2.5 flex items-center justify-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-bold text-neutral-800">
                  <span>{own.length} 場次</span>
                  <span className="text-neutral-300">|</span>
                  <span>共 {totalPitches} 球</span>
                </div>
                {latest && <p className="mt-1.5 text-center text-[11px] text-neutral-400">最近 {latest.date}</p>}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
