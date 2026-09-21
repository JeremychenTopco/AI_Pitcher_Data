import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  DualPlaybackProvider,
  PlaybackScope,
  SPEED_OPTIONS,
  useDualPlayback,
  type Slot,
} from "@/playback/PlaybackContext";
import { EventTimeline } from "@/components/playback/EventTimeline";
import { SeriesChart, COMPARE_BAND_COLOR } from "@/components/charts/SeriesChart";
import { PitchViewer, type ViewerMode } from "@/components/viewer/PitchViewer";
import { CompareSkeletonOverlay } from "@/components/viewer/CompareSkeletonOverlay";
import { ViewSettings, type CameraAngle } from "@/components/viewer/ViewSettings";
import { ViewerHud, FrameReadout } from "@/components/viewer/ViewerHud";
import { CompareMetricCard } from "@/components/common/CompareMetricCard";
import { Loading } from "@/components/common";
import { VerticalSplit } from "@/components/common/VerticalSplit";
import { GROUP_HEADINGS, TAB_GROUPS, seriesIn, useSession, usePitch, usePlayer, usePose } from "@/api/hooks";
import type { EventKey, PitchDetail, ScalarData, SeriesData, SeriesGroupKey } from "@/api/types";
import type { PoseData } from "@/api/dataSource";
import { downloadComparePdf } from "@/lib/reportPdf";

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
  // The querystring can carry a name directly (?an=/&bn=); otherwise resolve
  // it from the pitch's own session → player. Read through usePlayer (not
  // session.playerName, a snapshot baked in at fixture-generation time) so a
  // 基本設定 rename shows up here too, same as it already does in 選手資料庫.
  const sessionA = useSession(a.data?.sessionId ?? "");
  const sessionB = useSession(b.data?.sessionId ?? "");
  const playerA = usePlayer(sessionA.data?.playerId ?? "");
  const playerB = usePlayer(sessionB.data?.playerId ?? "");
  const aName = params.get("an") ?? playerA.data?.name ?? sessionA.data?.playerName ?? "";
  const bName = params.get("bn") ?? playerB.data?.name ?? sessionB.data?.playerName ?? "";

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
      <CompareLayout
        a={a.data}
        b={b.data}
        aName={aName}
        bName={bName}
        aThrows={playerA.data?.throws}
        bThrows={playerB.data?.throws}
        poseA={poseA.data}
        poseB={poseB.data}
      />
    </DualPlaybackProvider>
  );
}

const clockOf = (p: PitchDetail) => ({ frameCount: p.frameCount, fps: p.fps, events: p.events });

function CompareLayout({
  a,
  b,
  aName,
  bName,
  aThrows,
  bThrows,
  poseA,
  poseB,
}: {
  a: PitchDetail;
  b: PitchDetail;
  aName: string;
  bName: string;
  aThrows?: "L" | "R" | null;
  bThrows?: "L" | "R" | null;
  poseA: PoseData | null;
  poseB: PoseData | null;
}) {
  const nav = useNavigate();
  const [tab, setTab] = useState<CompareTab>("summary");
  const [mode, setMode] = useState<ViewerMode>("video");
  const [camera, setCamera] = useState<CameraAngle>("1");
  const [skelOverlay, setSkelOverlay] = useState(false);
  const [showModel3D, setShowModel3D] = useState(false);

  return (
    <div className="flex h-full flex-col bg-[var(--color-canvas)]">
      <header className="sticky top-0 z-20 relative grid h-11 shrink-0 grid-cols-2 items-center bg-[var(--color-brand)]">
        {[
          { p: a, name: aName, throws: aThrows, dot: "var(--color-compare-a)" },
          { p: b, name: bName, throws: bThrows, dot: "var(--color-compare-b)" },
        ].map(({ p, name, throws, dot }, i) => (
          <div key={i} className="flex items-center justify-center gap-2">
            <span className="size-2 rounded-full" style={{ background: dot }} />
            <span className="text-sm font-bold">{name}</span>
            <span className="text-[11px] font-medium">
              {throws ? (throws === "L" ? "左投" : "右投") + " ▪ " : ""}
              第 {String(p.number).padStart(2, "0")} 球 ▪ {p.pitchType} ▪ {p.velocityKmh} km/h
            </span>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            try {
              downloadComparePdf(a, aName, b, bName, poseA, poseB, aThrows, bThrows);
            } catch (e) {
              alert(e instanceof Error ? e.message : "報告書產生失敗，請稍後再試。");
            }
          }}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded bg-black px-3 py-1.5 text-xs font-bold text-white hover:bg-neutral-800"
        >
          下載報告書
        </button>
      </header>

      {/* Viewers pinned above a draggable divider; charts scroll below. */}
      <VerticalSplit
        id="compare"
        initial={0.5}
        top={
          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              {skelOverlay ? (
                <CompareSkeletonOverlay
                  poseA={poseA}
                  poseB={poseB}
                  mode={mode}
                  camera={camera}
                  videoUrl={a.media.videoUrls[cameraIndex(camera)] ?? null}
                  className="size-full"
                />
              ) : (
                <div className="grid size-full grid-cols-2">
                  <PlaybackScope slot="a">
                    <SideViewer pitch={a} pose={poseA} mode={mode} camera={camera} slot="a" showModel3D={showModel3D} />
                  </PlaybackScope>
                  <PlaybackScope slot="b">
                    <SideViewer pitch={b} pose={poseB} mode={mode} camera={camera} slot="b" showModel3D={showModel3D} />
                  </PlaybackScope>
                </div>
              )}
            </div>

            <div className="absolute top-2 right-2 z-30">
              <ViewSettings
                mode={mode}
                onModeChange={setMode}
                camera={camera}
                onCameraChange={setCamera}
                compareOn
                onCompareToggle={(on) => !on && nav(`/report/${a.id}`)}
                skeletonOverlay={skelOverlay}
                onSkeletonOverlayToggle={setSkelOverlay}
                showModel3D={showModel3D}
                onShowModel3DToggle={setShowModel3D}
              />
            </div>
          </div>
        }
        bottom={
          <>
            <div className="shrink-0 border-y border-neutral-200">
              <div className="grid grid-cols-2">
                <PlaybackScope slot="a">
                  <SideStats slot="a" />
                </PlaybackScope>
                <PlaybackScope slot="b">
                  <SideStats slot="b" />
                </PlaybackScope>
              </div>
              <SharedTransport />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
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
          </>
        }
      />
    </div>
  );
}

function findScalar(list: ScalarData[], key: string) {
  return list.find((s) => s.key === key) ?? null;
}

/** "all" has no 8-way grid on 比較 (see `allowGrid={false}` below) — falls back to camera 1. */
function cameraIndex(camera: CameraAngle) {
  return camera === "all" ? 0 : Number(camera) - 1;
}

/* --------------------------------------------------------------- one side */

function SideViewer({
  pitch,
  pose,
  mode,
  camera,
  slot,
  showModel3D,
}: {
  pitch: PitchDetail;
  pose: PoseData | null;
  mode: ViewerMode;
  camera: CameraAngle;
  slot: Slot;
  showModel3D?: boolean;
}) {
  return (
    <div className="relative h-full min-w-0 overflow-hidden">
      <div className="absolute inset-0">
        <PitchViewer
          mode={mode}
          videoUrls={pitch.media.videoUrls}
          camera={camera}
          allowGrid={false}
          pose={pose}
          jointAngles={pitch.scalars.filter((s) => s.group === "joint_angle")}
          series={pitch.series}
          showModel3D={showModel3D}
          className="size-full"
        />
      </div>
      <ViewerHud
        sequencing={findScalar(pitch.scalars, "sequencing")}
        joints={pitch.scalars.filter((s) => s.group === "joint_angle")}
        tint={slot === "a" ? "var(--color-compare-a)" : "var(--color-compare-b)"}
      />
      {/* Left, not right — 3D mode's orbit hint / reset button sits bottom-right and would cover it there. */}
      <FrameReadout tint={slot === "a" ? "var(--color-compare-a)" : "var(--color-compare-b)"} />
    </div>
  );
}

function SideStats({ slot }: { slot: Slot }) {
  const { both } = useDualPlayback();
  return (
    <div
      className="border-r border-neutral-200 last:border-r-0"
      style={{
        background: slot === "a" ? "var(--color-compare-a-softer)" : "var(--color-compare-b-softer)",
      }}
    >
      {/* Dragging either side's scrubber moves both records together, same as the shared transport row. */}
      <EventTimeline
        sync={{
          pause: () => both((c) => c.pause()),
          seekRatio: (ratio) => both((c) => c.seekRatio(ratio)),
          jumpTo: (event) => both((c) => c.jumpTo(event)),
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------- shared transport row */

function SharedTransport() {
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
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" /></svg>
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
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6z" /></svg>
        </button>
        <button type="button" className={btn} onClick={() => both((c) => c.seek(c.frameCount - 1))} aria-label="跳到結尾">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4"><path d="M16 5h2v14h-2zM6 5l9 7-9 7z" /></svg>
        </button>
        <button
          type="button"
          onClick={() => both((c) => c.toggleLoop())}
          aria-pressed={a.loop}
          aria-label="無限循環播放"
          title="無限循環播放"
          className={`grid size-9 place-items-center rounded ${a.loop ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
            <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
          </svg>
        </button>
      </div>

      <div className="flex gap-1 rounded bg-neutral-100 p-1">
        {SPEED_OPTIONS.map((o) => (
          <button
            key={o.rate}
            type="button"
            onClick={() => both((c) => c.setRate(o.rate))}
            aria-pressed={a.rate === o.rate}
            className={`rounded px-2 py-1 text-xs font-medium ${
              a.rate === o.rate ? "bg-neutral-900 text-white" : "text-neutral-600"
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

/**
 * 動作階段分序 (phase_sequencing) — a 分開 / 疊圖 view switch: 分開 shows each
 * record in its own column, 疊圖 collapses to one column with 記錄1 solid and
 * 記錄2 dashed, colours per series so data1…4 stay matched (Frame192). Hovering
 * a legend entry spotlights that pair and greys the rest.
 *
 * Every other group — the kinematics tabs — is always overlaid in the
 * single-metric style: 記錄1 purple with its reference band, 記錄2 red dashed
 * (Property1 Variant2).
 */
function PairedCharts({ group, a, b }: { group: SeriesGroupKey; a: PitchDetail; b: PitchDetail }) {
  const sa = seriesIn(a.series, group);
  const sb = seriesIn(b.series, group);
  const [view, setView] = useState<"split" | "overlay">("overlay");
  const { both } = useDualPlayback();
  const syncSeek = (ratio: number) => both((c) => c.seekRatio(ratio));
  if (!sa.length) return null;
  const h = GROUP_HEADINGS[group];

  if (group === "phase_sequencing") {
    return (
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Heading zh={h.zh} en={h.en} />
          <ViewSwitch value={view} onChange={setView} />
        </div>

        {view === "split" ? (
          <div className="grid grid-cols-2 gap-3">
            <PlaybackScope slot="a"><SeriesChart series={sa} legend band bandColor={COMPARE_BAND_COLOR} height={200} onSeek={syncSeek} /></PlaybackScope>
            <PlaybackScope slot="b"><SeriesChart series={sb} legend band bandColor={COMPARE_BAND_COLOR} height={200} onSeek={syncSeek} /></PlaybackScope>
          </div>
        ) : (
          <OverlayChart primary={sa} overlaySeries={sb} overlayPitch={b} legend band height={230} />
        )}
      </section>
    );
  }

  return (
    <section>
      <Heading zh={h.zh} en={h.en} />
      <div className="flex flex-col gap-2">
        {sa.map((s, i) =>
          sb[i] ? (
            <OverlayChart
              key={s.key}
              primary={[s]}
              overlaySeries={[sb[i]]}
              overlayPitch={b}
              variant="records"
              band
              caption={`${s.label} (${s.labelEn})`}
              height={132}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}

/** 二欄 (分開) ↔ 一欄 (疊圖) toggle for the phase-sequencing chart. */
function ViewSwitch({
  value,
  onChange,
}: {
  value: "split" | "overlay";
  onChange: (v: "split" | "overlay") => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 rounded bg-white p-0.5">
      {(
        [
          ["split", "分開"],
          ["overlay", "疊圖"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`rounded px-3 py-1 text-xs font-bold ${
            value === id ? "bg-neutral-900 text-white" : "text-neutral-600"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Draws `primary` (記錄1) and the overlay record on one axis; see SeriesChart. */
function OverlayChart({
  primary,
  overlaySeries,
  overlayPitch,
  band,
  caption,
  legend,
  height,
  variant,
}: {
  primary: SeriesData[];
  overlaySeries: SeriesData[];
  overlayPitch: PitchDetail;
  band?: boolean;
  caption?: string;
  legend?: boolean;
  height?: number;
  variant?: "series" | "records";
}) {
  const dual = useDualPlayback();

  return (
    <PlaybackScope slot="a">
      <SeriesChart
        series={primary}
        band={band}
        bandColor={COMPARE_BAND_COLOR}
        caption={caption}
        legend={legend}
        height={height}
        variant={variant}
        overlay={{ series: overlaySeries, events: overlayPitch.events, progress: dual.b.progress }}
        onSeek={(ratio) => dual.both((c) => c.seekRatio(ratio))}
      />
    </PlaybackScope>
  );
}

function Heading({ zh, en }: { zh: string; en: string }) {
  return (
    <h2 className="text-sm font-bold">
      {zh} <span className="font-normal text-neutral-500">{en}</span>
    </h2>
  );
}
