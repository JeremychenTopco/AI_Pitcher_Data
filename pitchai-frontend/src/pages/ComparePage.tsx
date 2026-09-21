import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { usePitch, usePitches, useSession, useSessions } from "@/api/hooks";
import { usePlayers } from "@/app/PlayersStore";
import { TopBar } from "@/components/common/TopBar";
import { Loading, PlayerAvatar, StatusBadge } from "@/components/common";
import type { Pitch, PitchDetail, ScalarData, SeriesData, Session } from "@/api/types";

/**
 * 投球比較記錄 — the picker flow (比較_01…06).
 *
 * Each side is independent: open its dropdown, pick a player from the roster,
 * then a session, then a pitch. Once a pitch is chosen the dropdown collapses
 * to a summary and the side fills with a preview (曲線 + Efficiency / Sequencing
 * + Other). When both sides hold a pitch the 比較 button opens the dual view.
 *
 * Entry paths:
 *   /compare          both slots empty
 *   /compare?a=<id>   slot 1 pre-filled from a report (自動帶入)
 */
export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const a = params.get("a");
  const b = params.get("b");
  const ready = Boolean(a && b);

  const setSlot = (slot: "a" | "b", id: string | null, name?: string) => {
    const next = new URLSearchParams(params);
    if (id) {
      next.set(slot, id);
      if (name) next.set(`${slot}n`, name);
    } else {
      next.delete(slot);
      next.delete(`${slot}n`);
    }
    setParams(next, { replace: true });
  };

  const toResult = () => {
    const q = new URLSearchParams({ a: a ?? "", b: b ?? "" });
    if (params.get("an")) q.set("an", params.get("an")!);
    if (params.get("bn")) q.set("bn", params.get("bn")!);
    nav(`/compare/result?${q}`);
  };

  return (
    <>
      <TopBar breadcrumb={[{ label: "比較" }]} />

      <div className="p-6">
        <h1 className="text-2xl font-bold">投球比較記錄</h1>
        {a && !b && <p className="mt-1 text-sm text-neutral-500">已帶入記錄 1，請選擇記錄 2</p>}

        <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <Slot
            label="記錄1"
            pitchId={a}
            playerName={params.get("an")}
            accent="var(--color-compare-a)"
            onSelect={(id, name) => setSlot("a", id, name)}
            onClear={() => setSlot("a", null)}
          />

          <div className="hidden self-center lg:block">
            <CompareButton ready={ready} onClick={toResult} />
          </div>

          <Slot
            label="記錄2"
            pitchId={b}
            playerName={params.get("bn")}
            accent="var(--color-compare-b)"
            onSelect={(id, name) => setSlot("b", id, name)}
            onClear={() => setSlot("b", null)}
          />
        </div>

        <div className="mt-4 lg:hidden">
          <CompareButton ready={ready} full onClick={toResult} />
        </div>
      </div>
    </>
  );
}

function CompareButton({ ready, full, onClick }: { ready: boolean; full?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={!ready}
      onClick={onClick}
      className={`${full ? "w-full" : ""} border-2 border-black bg-white px-6 py-3 text-sm font-bold disabled:border-neutral-400 disabled:bg-neutral-100 disabled:text-neutral-400`}
    >
      比較
    </button>
  );
}

/* --------------------------------------------------------------- one slot */

function Slot({
  label,
  pitchId,
  playerName,
  accent,
  onSelect,
  onClear,
}: {
  label: string;
  pitchId: string | null;
  playerName: string | null;
  accent: string;
  onSelect: (id: string, name: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [playerLabel, setPlayerLabel] = useState("");

  const pick = (id: string) => {
    onSelect(id, playerLabel);
    setOpen(false);
  };

  return (
    <section className="rounded-lg bg-[var(--color-brand)] p-4">
      <h2 className="mb-3 text-lg font-bold">{label}</h2>

      <div className="rounded bg-white">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            {pitchId ? (
              <SelectedRow pitchId={pitchId} playerName={playerName} accent={accent} />
            ) : (
              <span className="text-sm text-neutral-500">選擇球員與球次</span>
            )}
          </span>
          <Chevron open={open} />
        </button>

        {open && (
          <div className="max-h-[460px] overflow-y-auto border-t border-neutral-200">
            {!playerId ? (
              <PlayerList
                onPick={(id, name) => {
                  setPlayerId(id);
                  setPlayerLabel(name);
                }}
              />
            ) : (
              <SessionList
                playerId={playerId}
                onBack={() => setPlayerId(null)}
                onPickPitch={pick}
              />
            )}
          </div>
        )}
      </div>

      {pitchId && (
        <>
          <button type="button" onClick={onClear} className="mt-2 text-xs font-bold underline">
            清除選擇
          </button>
          <SlotDetail pitchId={pitchId} accent={accent} />
        </>
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/* ------------------------------------------------------------- dropdown steps */

function PlayerList({ onPick }: { onPick: (id: string, name: string) => void }) {
  const { players, loading } = usePlayers();
  if (loading) return <Loading label="載入球員…" />;

  return (
    <ul>
      {players.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onPick(p.id, p.name)}
            className="flex w-full items-center gap-3 border-b border-neutral-100 px-4 py-3 text-left hover:bg-neutral-50"
          >
            <PlayerAvatar url={p.avatarUrl} name={p.name} className="size-8" />
            <span className="flex-1 text-sm font-bold">{p.name}</span>
            <span className="text-xs text-neutral-500">{p.throws === "L" ? "左投" : "右投"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SessionList({
  playerId,
  onBack,
  onPickPitch,
}: {
  playerId: string;
  onBack: () => void;
  onPickPitch: (id: string) => void;
}) {
  const sessions = useSessions(playerId);
  const { players } = usePlayers();
  const player = players.find((p) => p.id === playerId);

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-left text-xs font-bold"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {player?.name ?? "球員"}　·　更換球員
      </button>

      {sessions.loading ? (
        <Loading label="載入場次…" />
      ) : (sessions.data ?? []).length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-neutral-500">這位球員還沒有檢測記錄。</p>
      ) : (
        (sessions.data ?? []).map((s) => (
          <div key={s.id}>
            <SessionRow session={s} playerName={player?.name} avatarUrl={player?.avatarUrl} />
            <PitchRows sessionId={s.id} avatarUrl={player?.avatarUrl} onPick={onPickPitch} />
          </div>
        ))
      )}
    </div>
  );
}

function SessionRow({
  session,
  playerName,
  avatarUrl,
}: {
  session: Session;
  /** Live name from PlayersStore, preferred over session.playerName — a snapshot a 基本設定 rename never touches. */
  playerName?: string;
  avatarUrl?: string | null;
}) {
  const name = playerName ?? session.playerName;
  return (
    <div className="flex w-full items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-4 py-2.5">
      <PlayerAvatar url={avatarUrl} name={name} className="size-7" />
      <span className="flex-1 truncate text-sm font-bold">
        {name} <span className="mx-1 text-neutral-400">.</span>
        {session.date.replaceAll("-", "/")}
      </span>
      <StatusBadge status={session.status} />
      <span className="w-12 text-right text-sm font-bold">{session.pitchCount} 球</span>
    </div>
  );
}

function PitchRows({
  sessionId,
  avatarUrl,
  onPick,
}: {
  sessionId: string;
  avatarUrl?: string | null;
  onPick: (id: string) => void;
}) {
  const pitches = usePitches(sessionId);
  if (pitches.loading) return <Loading label="載入球次…" />;

  return (
    <ul>
      {(pitches.data ?? []).map((p) => (
        <li key={p.id}>
          <PitchRow pitch={p} avatarUrl={avatarUrl} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}

function PitchRow({
  pitch,
  avatarUrl,
  onPick,
}: {
  pitch: Pitch;
  avatarUrl?: string | null;
  onPick: (id: string) => void;
}) {
  const done = pitch.status === "done";
  return (
    <button
      type="button"
      disabled={!done}
      onClick={() => onPick(pitch.id)}
      className="flex w-full items-center gap-3 border-b border-neutral-200 bg-neutral-100 p-2.5 pl-4 text-left hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="grid size-4 shrink-0 place-items-center border border-neutral-400 bg-white" aria-hidden />
      <PlayerAvatar url={avatarUrl} name="" className="size-7" />
      <span className="w-12 text-xs font-bold">{pitch.thrownAt.slice(11, 16)}</span>

      <span className="text-center">
        <span className="block text-[10px] font-bold">Efficiency</span>
        <span className="block text-[11px] font-bold text-neutral-600">{done ? "24%" : "N/A"}</span>
      </span>
      <span className="text-center">
        <span className="block text-[10px] font-bold">Sequencing</span>
        <span className="block text-[11px] font-bold text-neutral-600">{done ? "99%" : "N/A"}</span>
      </span>

      <span className="ml-auto flex items-center gap-3">
        <StatusBadge status={pitch.status} />
        <span className="w-6 text-right text-sm font-bold">{String(pitch.number).padStart(2, "0")}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------ selected row + detail */

function SelectedRow({
  pitchId,
  playerName,
  accent,
}: {
  pitchId: string;
  playerName: string | null;
  accent: string;
}) {
  const pitch = usePitch(pitchId);
  const { players } = usePlayers();
  const session = useSession(pitch.data?.sessionId ?? "");
  if (pitch.loading) return <span className="text-sm text-neutral-500">載入中…</span>;
  if (!pitch.data) return <span className="text-sm text-neutral-500">找不到球次</span>;

  const p = pitch.data;
  const found = players.find((pl) => pl.id === session.data?.playerId);
  // found?.name (via PlayersStore, live) beats session.data?.playerName (a
  // snapshot baked in at fixture-generation time that a 基本設定 rename never
  // touches) — otherwise a renamed player still shows their old name here.
  const name = playerName || found?.name || session.data?.playerName || "球員";
  const eff = scalarOf(p.scalars, "efficiency");
  const seq = scalarOf(p.scalars, "sequencing");

  return (
    <span className="flex items-center gap-3">
      <PlayerAvatar url={found?.avatarUrl} name={name} className="size-8" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{name}</span>
        <span className="block text-xs text-neutral-500">
          {p.thrownAt.slice(0, 10)} - {p.thrownAt.slice(11, 16)}
        </span>
      </span>
      <MiniStat label="Efficiency" value={eff?.value} color="var(--color-metric-low)" />
      <MiniStat label="Sequencing" value={seq?.value} color="var(--color-status-done)" />
      <span className="text-sm font-bold" style={{ color: accent }}>
        {String(p.number).padStart(2, "0")}
      </span>
    </span>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <span className="hidden text-center sm:block">
      <span className="block text-[10px] font-bold">{label}</span>
      <span className="block text-[11px] font-bold" style={{ color }}>
        {value ?? "—"}%
      </span>
    </span>
  );
}

/** 比較_05 / 06 — the filled side: curve + two metric cards + Other block. */
function SlotDetail({ pitchId, accent }: { pitchId: string; accent: string }) {
  const pitch = usePitch(pitchId);
  if (pitch.loading) return <div className="mt-3 rounded bg-white p-4"><Loading /></div>;
  if (!pitch.data) return null;

  const p = pitch.data;
  const eff = scalarOf(p.scalars, "efficiency")?.value ?? null;
  const seq = scalarOf(p.scalars, "sequencing")?.value ?? null;
  const phase = p.series.filter((s) => s.group === "phase_sequencing");

  return (
    <div className="mt-3 rounded bg-white p-4">
      <MiniSeriesChart series={phase} events={p.events} frameCount={p.frameCount} />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <MetricCard label="Efficiency" value={eff} />
        <MetricCard label="Sequencing" value={seq} />
      </div>

      <div className="mt-3 rounded bg-[var(--color-surface-muted)] p-4">
        <p className="text-sm font-bold" style={{ color: accent }}>
          Other　{p.pitchType} ▪ {p.velocityKmh} km/h
        </p>
        <p className="mt-2 text-xs leading-relaxed text-neutral-600">
          出手高度 {scalarOf(p.scalars, "release_height")?.value ?? "—"} cm ·
          出手側偏 {scalarOf(p.scalars, "release_side")?.value ?? "—"} cm ·
          出手延伸 {scalarOf(p.scalars, "release_ext")?.value ?? "—"} cm。
          手臂路徑 {scalarOf(p.scalars, "arm_path")?.value ?? "—"}、
          髖肩分離 {scalarOf(p.scalars, "hip_shoulder")?.value ?? "—"}、
          軀幹扭矩 {scalarOf(p.scalars, "torque")?.value ?? "—"}。
        </p>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number | null }) {
  const color =
    value === null
      ? "var(--color-metric-mid)"
      : value < 35
        ? "var(--color-metric-low)"
        : value < 60
          ? "var(--color-metric-mid)"
          : "var(--color-metric-high)";

  return (
    <div className="rounded bg-[var(--color-surface-muted)] p-4">
      <p className="text-sm font-bold">{label}</p>
      <p className="mt-1 text-4xl font-bold" style={{ color }}>
        {value ?? "—"}%
      </p>
      <div className="mt-3 h-2.5 overflow-hidden rounded-sm bg-white">
        <div className="h-full rounded-sm" style={{ width: `${value ?? 0}%`, background: color }} />
      </div>
    </div>
  );
}

/* --------------------------------------------------- standalone mini chart */

const CW = 1000;
const CPAD = { top: 22, right: 12, bottom: 26, left: 12 };

/** Playback-free version of SeriesChart, for the picker preview. */
function MiniSeriesChart({
  series,
  events,
  frameCount,
  height = 170,
}: {
  series: SeriesData[];
  events: PitchDetail["events"];
  frameCount: number;
  height?: number;
}) {
  const plotW = CW - CPAD.left - CPAD.right;
  const plotH = height - CPAD.top - CPAD.bottom;
  const toX = (i: number, n: number) => CPAD.left + (i / Math.max(1, n - 1)) * plotW;

  const paths = series.map((s) => {
    const span = s.yMax - s.yMin || 1;
    let d = "";
    let pen = false;
    s.samples.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      const y = CPAD.top + (1 - (v - s.yMin) / span) * plotH;
      d += `${pen ? "L" : "M"}${toX(i, s.samples.length).toFixed(1)} ${y.toFixed(1)}`;
      pen = true;
    });
    return { key: s.key, color: s.color, label: s.label, d };
  });

  const markers = (["fp", "mer", "br"] as const)
    .map((k) => ({ k, at: events[k] }))
    .filter((m) => typeof m.at === "number");

  return (
    <figure className="overflow-hidden rounded bg-white">
      <svg viewBox={`0 0 ${CW} ${height}`} className="w-full" role="img" aria-label="投球數據曲線">
        {markers.map(({ k, at }) => {
          const x = toX(at as number, frameCount);
          return (
            <g key={k}>
              <line
                x1={x}
                x2={x}
                y1={CPAD.top - 12}
                y2={CPAD.top + plotH}
                stroke="#111"
                strokeWidth={1.6}
                strokeDasharray={k === "br" ? "6 5" : undefined}
              />
              <rect x={x - 16} y={0} width={32} height={16} rx={3} fill="#e0e0e0" />
              <text x={x} y={12} textAnchor="middle" className="text-[10px] font-bold">
                {k.toUpperCase()}
              </text>
            </g>
          );
        })}

        {paths.map((p) => (
          <path key={p.key} d={p.d} fill="none" stroke={p.color} strokeWidth={2.4} strokeLinejoin="round" />
        ))}

        <g className="text-[11px]">
          {paths.map((p, i) => {
            const lx = CPAD.left + (i * plotW) / paths.length;
            return (
              <g key={p.key}>
                <line x1={lx} x2={lx + 20} y1={height - 8} y2={height - 8} stroke={p.color} strokeWidth={3} />
                <text x={lx + 26} y={height - 4} className="fill-neutral-600">
                  {p.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </figure>
  );
}

/* ------------------------------------------------------------------ helpers */

function scalarOf(list: ScalarData[], key: string) {
  return list.find((s) => s.key === key) ?? null;
}
