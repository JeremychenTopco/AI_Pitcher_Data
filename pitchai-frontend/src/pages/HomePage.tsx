import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useHome, useSessions } from "@/api/hooks";
import { usePlayers } from "@/app/PlayersStore";
import { useSession as useAppSession } from "@/app/SessionContext";
import { Card, ErrorNote, Loading, PlayerAvatar, StatusBadge } from "@/components/common";
import { TopBar } from "@/components/common/TopBar";

/** 首頁. Same layout for both roles; the payload differs by role. */
export function HomePage() {
  const { role, user } = useAppSession();
  const { data, loading, error } = useHome(role);
  const roster = usePlayers();
  const sessions = useSessions();

  const ballCounts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const s of sessions.data ?? []) by[s.playerId] = (by[s.playerId] ?? 0) + s.pitchCount;
    return by;
  }, [sessions.data]);

  if (loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;
  if (!data) return null;

  const stats = [
    { label: "運算中", value: data.processingCount },
    { label: "本週檢測", value: data.weekCount },
    { label: "待檢測", value: data.pendingCount },
  ];

  const players = roster.players;

  return (
    <>
      <TopBar breadcrumb={[{ label: "首頁" }]} />
      <div className="p-8">
        <h1 className="text-3xl font-bold">你好, {user.name}</h1>

        <div className="mt-6 grid grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <Card
              key={s.label}
              className={`px-5 py-4 ${i === 0 ? "bg-[var(--color-brand)]" : "bg-neutral-100"}`}
            >
              <p className="text-sm font-bold">{s.label}</p>
              <p className="mt-1 text-sm font-bold">{s.value} 場</p>
            </Card>
          ))}
        </div>

        <h2 className="mt-10 mb-3 text-sm font-bold">最近檢測</h2>
        <ul className="flex flex-col gap-3">
          {data.recentSessions.map((s) => (
            <li key={s.id}>
              <Link
                to={`/sessions/${s.id}`}
                className="flex items-center gap-4 rounded-lg bg-neutral-100 px-4 py-3 hover:bg-neutral-200"
              >
                <span className="size-8 shrink-0 rounded-full bg-neutral-300" />
                <span className="flex-1 text-sm font-bold">
                  {/* s.playerName is a snapshot from when home-*.json was generated — a 基本設定 rename never touches it. */}
                  {players.find((p) => p.id === s.playerId)?.name ?? s.playerName}　．　{s.date} / {s.label}
                </span>
                <StatusBadge status={s.status} />
                <span className="w-14 text-right text-sm font-bold">{s.pitchCount} 球</span>
              </Link>
            </li>
          ))}
        </ul>

        <h2 className="mt-10 mb-3 text-sm font-bold">選手名單</h2>
        <ul className="grid grid-cols-4 gap-4">
          {players.map((p) => (
            <li key={p.id}>
              <Link
                to={`/players/${p.id}`}
                className="flex flex-col items-center gap-3 rounded-lg bg-neutral-100 px-4 py-8 hover:bg-neutral-200"
              >
                <PlayerAvatar url={p.avatarUrl} name={p.name} className="size-24" />
                <span className="text-sm font-bold">{p.name} 球員</span>
                <span className="text-sm font-bold">{ballCounts[p.id] ?? 0} 球</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}