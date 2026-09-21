import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  DualPlaybackProvider,
  PlaybackScope,
  useDualPlayback,
  type Slot,
} from "@/playback/PlaybackContext";
import { EventTimeline } from "@/components/playback/EventTimeline";
import { SeriesChart } from "@/components/charts/SeriesChart";
import { PitchViewer, VIEWER_MODES, type ViewerMode } from "@/components/viewer/PitchViewer";
import { CompareMetricCard } from "@/components/common/CompareMetricCard";
import { Loading } from "@/components/common";
import { GROUP_HEADINGS, TAB_GROUPS, seriesIn, usePitch, usePose } from "@/api/hooks";
import type { EventKey, PitchDetail, ScalarData, SeriesGroupKey } from "@/api/types";
import type { PoseData } from "@/api/dataSource";

type CompareTab = "summary" | "arm" | "trunk" | "knee";

const TABS: ReadonlyArray<{ id: CompareTab; label: string }> = [
  { id: "summary", label: "總覽" },
  { id: "arm", label: "手臂運動學" },
  { id: "trunk", label: "軀幹運動學" },
  { id: "knee", label: "膝關節動力學" },
];

const JUMP: EventKey[] = ["fp", "mer", "br"];

/**
 * 比較結果. Two pitches side by side.
 *
 * Both clips live under one DualPlaybackProvider; each column is wrapped in a
 * PlaybackScope so its viewer, timeline and charts all read the same clock.
 * The transport row drives both at once, and the FP / MER / BR buttons snap
 * each side to its own event frame — which is phase alignment at the event
 * level. Continuous time-warping between events is still open.
 */
export function CompareResultPage() {
  const [params] = useSearchParams();
  const aId = params.get("a");
  const bId = params.get("b");

  const a = usePitch(aId ?? "");
  const b = usePitch(bId ?? "");
  const poseA = usePose(aId ?? "");
  const poseB = usePose(bId ?? "");

  if (!aId || !bId) {
    return (
      <div className="p-10 text-sm">
        還沒有選好兩筆記錄。
        <Link to="/compare" className="ml-1 underline">
          回到選擇頁
        </Link>
      </div>
    );
  }
  if (a.loading || b.loading) return <Loading />;
  if (!a.data || !b.data) return null;

  return (
    <DualPlaybackProvider a={clockOf(a.data)} b={clockOf(b.data)}>
      <CompareLayout a={a.data} b={b.data} poseA={poseA.data} poseB={poseB.data} />
    </DualPlaybackProvider>
  );
}

const clockOf = (p: PitchDetail) => ({ frameCount: p.frameCount, fps: p.fps, events: p.events });

function CompareLayout({
  a,
  b,
  poseA,
  poseB,
}: {
  a: PitchDetail;
  b: PitchDetail;
  poseA: PoseData | null;
  poseB: PoseData | null;
}) {
  const [tab, setTab] = useState<CompareTab>("summary");
  const [mode, setMode] = useState<ViewerMode>("video");

  return (
    <div className="flex h-full flex-col bg-[var(--color-canvas)]">
      <header className="sticky top-0 z-20 grid h-11 shrink-0 grid-cols-2 items-center bg-[var(--color-brand)]">
        {[a, b].map((p, i) => (
          <div key={i} className="flex items-center justify-center gap-3">
            <span className="text-base font-bold">第 {String(p.number).padStart(2, "0")} 球</span>
            <span className="text-[11px] font-medium">
              {p.pitchType} ▪ {p.velocityKmh} km/h
            </span>
          </div>
        ))}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-2">
          <PlaybackScope slot="a">
            <Side pitch={a} pose={poseA} mode={mode} slot="a" />
          </PlaybackScope>
          <PlaybackScope slot="b">
            <Side pitch={b} pose={poseB} mode={mode} slot="b" />
          </PlaybackScope>
        </div>

        <SharedTransport mode={mode} onModeChange={setMode} />

        <div className="px-4 pt-4 pb-10">
          <div role="tablist" className="flex gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={t.id === tab}
                onClick={() => setTab(t.id)}
                className={`rounded px-3 py-1.5 text-xs font-bold ${
                  t.id === tab ? "bg-[var(--color-brand)]" : "bg-white text-neutral-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-6">
            {(TAB_GROUPS[tab] ?? []).map((g) => (
              <PairedCharts key={g} group={g} a={a} b={b} />
            ))}
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {a.scalars
              .filter((s) => s.group === "summary")
              .map((s) => (
                <CompareMetricCard key={s.key} a={s} b={findScalar(b.scalars, s.key)} />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function findScalar(list: ScalarData[], key: string) {
  return list.find((s) => s.key === key) ?? null;
}

/* --------------------------------------------------------------- one side */

function Side({
  pitch,
  pose,
  mode,
  slot,
}: {
  pitch: PitchDetail;
  pose: PoseData | null;
  mode: ViewerMode;
  slot: Slot;
}) {
  const seq = findScalar(pitch.scalars, "sequencing");
  const joints = pitch.scalars.filter((s) => s.group === "joint_angle");

  const seqBg = slot === "a" ? "var(--color-surface)" : "var(--color-compare-b-softer)";
  const jointBg = slot === "a" ? "var(--color-compare-a-soft)" : "var(--color-compare-b-soft)";
  const seqColor = slot === "a" ? "var(--color-status-done)" : "var(--color-metric-mid)";

  return (
    <div className="flex flex-col">
      <div className="relative">
        <PitchViewer mode={mode} videoUrl={pitch.media.videoUrl} pose={pose} className="h-[280px] w-full" />
        <span className="absolute bottom-2 left-2 rounded bg-neutral-200/90 px-1.5 py-0.5 text-[10px] font-bold">
          {pitch.fps} fps
        </span>
      </div>

      <div className="grid grid-cols-2">
        <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: seqBg }}>
          <span className="text-xs font-bold">Sequencing</span>
          <span className="text-lg font-bold" style={{ color: seqColor }}>
            {seq?.value ?? "—"}%
          </span>
          <span className="h-2 flex-1 rounded-sm bg-white">
            <span className="block h-full rounded-sm bg-neutral-500" style={{ width: `${seq?.value ?? 0}%` }} />
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 px-4 py-2 text-[11px]" style={{ background: jointBg }}>
          {joints.map((j) => (
            <div key={j.key} className="flex justify-between gap-2">
              <dt className="font-medium">{j.labelEn}</dt>
              <dd className="font-bold">{j.value}°</dd>
            </div>
          ))}
        </dl>
      </div>

      <EventTimeline />
    </div>
  );
}

/* ---------------------------------------------------- shared transport row */

function SharedTransport({
  mode,
  onModeChange,
}: {
  mode: ViewerMode;
  onModeChange: (m: ViewerMode) => void;
}) {
  const { a, both } = useDualPlayback();
  const btn = "grid size-9 place-items-center rounded hover:bg-neutral-100";

  return (
    <div className="flex flex-wrap items-center gap-3 bg-white px-4 py-2">
      <div className="flex gap-1">
        {JUMP.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => both((c) => c.jumpTo(k))}
            className="rounded bg-neutral-200 px-2.5 py-1 text-xs font-bold hover:bg-neutral-300"
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="mx-auto flex items-center gap-6">
        <button type="button" className={btn} onClick={() => both((c) => c.seek(0))} aria-label="回到開頭">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M6 5h2v14H6zm12 0v14l-9-7z" /></svg>
        </button>
        <button type="button" className={btn} onClick={() => both((c) => c.step(-1))} aria-label="上一格">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M8 5h2v14H8zm10 0v14l-8-7z" /></svg>
        </button>
        <button
          type="button"
          onClick={() => both((c) => (a.playing ? c.pause() : c.play()))}
          aria-label={a.playing ? "暫停" : "播放"}
          className="grid size-11 place-items-center rounded hover:bg-neutral-100"
        >
          {a.playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-6"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-6"><path d="M7 4l14 8-14 8z" /></svg>
          )}
        </button>
        <button type="button" className={btn} onClick={() => both((c) => c.step(1))} aria-label="下一格">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M14 5h2v14h-2zM6 5l8 7-8 7z" /></svg>
        </button>
        <button type="button" className={btn} onClick={() => both((c) => c.seek(c.frameCount - 1))} aria-label="跳到結尾">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M16 5h2v14h-2zM6 5l9 7-9 7z" /></svg>
        </button>
      </div>

      <div className="flex gap-1 rounded bg-neutral-100 p-1">
        {VIEWER_MODES.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onModeChange(o.id)}
            aria-pressed={mode === o.id}
            className={`rounded px-2 py-1 text-xs font-medium ${
              mode === o.id ? "bg-neutral-900 text-white" : "text-neutral-600"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ paired charts */

function PairedCharts({ group, a, b }: { group: SeriesGroupKey; a: PitchDetail; b: PitchDetail }) {
  const sa = seriesIn(a.series, group);
  const sb = seriesIn(b.series, group);
  if (!sa.length) return null;
  const h = GROUP_HEADINGS[group];

  if (group === "phase_sequencing") {
    return (
      <section>
        <Heading zh={h.zh} en={h.en} />
        <div className="grid grid-cols-2 gap-3">
          <PlaybackScope slot="a"><SeriesChart series={sa} legend height={190} /></PlaybackScope>
          <PlaybackScope slot="b"><SeriesChart series={sb} legend height={190} /></PlaybackScope>
        </div>
      </section>
    );
  }

  return (
    <section>
      <Heading zh={h.zh} en={h.en} />
      <div className="flex flex-col gap-3">
        {sa.map((s, i) => (
          <div key={s.key} className="grid grid-cols-2 gap-3">
            <PlaybackScope slot="a">
              <SeriesChart series={[s]} band caption={`${s.label} (${s.labelEn})`} height={190} />
            </PlaybackScope>
            {sb[i] && (
              <PlaybackScope slot="b">
                <SeriesChart series={[sb[i]]} band caption={`${sb[i].label} (${sb[i].labelEn})`} height={190} />
              </PlaybackScope>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Heading({ zh, en }: { zh: string; en: string }) {
  return (
    <h2 className="mb-2 text-sm font-bold">
      {zh} <span className="font-normal text-neutral-500">{en}</span>
    </h2>
  );
}
