import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { PlaybackProvider } from "@/playback/PlaybackContext";
import { EventTimeline } from "@/components/playback/EventTimeline";
import { TransportControls } from "@/components/playback/TransportControls";
import { SeriesChart } from "@/components/charts/SeriesChart";
import { PitchViewer, type ViewerMode } from "@/components/viewer/PitchViewer";
import { ViewSettings, type CameraAngle } from "@/components/viewer/ViewSettings";
import { ViewerHud, FrameReadout } from "@/components/viewer/ViewerHud";
import { ErrorNote, InfoHint, Loading } from "@/components/common";
import { VerticalSplit } from "@/components/common/VerticalSplit";
import { TopBar } from "@/components/common/TopBar";
import {
  GROUP_HEADINGS,
  TAB_GROUPS,
  scalarByKey,
  scalarPosition,
  scalarsIn,
  seriesIn,
  useSession,
  usePitch,
  usePlayer,
  usePose,
} from "@/api/hooks";
import { REPORT_TABS, type ReportTab } from "@/types";
import type { ScalarData, SeriesGroupKey } from "@/api/types";
import { downloadReportPdf } from "@/lib/reportPdf";

export function ReportPage() {
  const { pitchId = "" } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as ReportTab) ?? "summary";
  const [mode, setMode] = useState<ViewerMode>("pose2d");
  const [camera, setCamera] = useState<CameraAngle>("1");
  const [overlay, setOverlay] = useState(true);
  const [showModel3D, setShowModel3D] = useState(false);

  const pitch = usePitch(pitchId);
  const pose = usePose(pitchId);
  const session = useSession(pitch.data?.sessionId ?? "");
  // The session's own playerName is a snapshot from fixture generation —
  // it never sees a 基本設定 rename. usePlayer reads through PlayersStore's
  // localStorage overlay instead, so this always matches what 選手資料庫 shows.
  const player = usePlayer(session.data?.playerId ?? "");

  if (pitch.loading) return <Loading />;
  if (pitch.error) return <ErrorNote error={pitch.error} />;
  if (!pitch.data) return null;

  const p = pitch.data;
  const groups = TAB_GROUPS[tab] ?? [];
  const jointAngles = scalarsIn(p.scalars, "joint_angle");
  const summaryScalars = scalarsIn(p.scalars, "summary");
  const sequencing = scalarByKey(p.scalars, "sequencing");

  return (
    <PlaybackProvider frameCount={p.frameCount} fps={p.fps} events={p.events}>
      <div className="flex h-full flex-col">
        <TopBar
          breadcrumb={[
            { label: "選手資料庫", to: "/players" },
            { label: "場次", to: `/sessions/${p.sessionId}` },
            { label: `第 ${p.number} 球` },
          ]}
          center={
            <>
              <span className="text-base font-bold">
                {player.data?.name ?? session.data?.playerName ?? "球員"} 第 {String(p.number).padStart(2, "0")} 球
              </span>
              <span className="text-[11px] font-medium">
                {player.data ? (player.data.throws === "L" ? "左投" : "右投") + " ▪ " : ""}
                {p.pitchType} ▪ {p.velocityKmh} km/h
              </span>
            </>
          }
          right={
            <button
              type="button"
              onClick={() => {
                try {
                  downloadReportPdf(p, player.data?.name ?? session.data?.playerName ?? "球員", session.data?.label ?? "", pose.data, player.data?.throws);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "報告書產生失敗，請稍後再試。");
                }
              }}
              className="rounded bg-black px-3 py-1.5 text-xs font-bold text-white hover:bg-neutral-800"
            >
              下載報告書
            </button>
          }
        />

        {/* Viewer + playback pinned above a draggable divider; charts scroll below. */}
        <VerticalSplit
          id="report"
          initial={0.5}
          top={
            <div className="relative min-h-0 flex-1">
              {mode === "video" && camera === "all" ? (
                // 機位 All's 8-up grid puts a video in every corner — a
                // top-left floating HUD would sit right on camera 1's tile,
                // so it moves out to a left-hand sidebar instead of overlapping.
                <div className="absolute inset-0 flex">
                  {(sequencing || jointAngles.length > 0) && (
                    <div className="w-40 shrink-0 overflow-y-auto bg-black p-2">
                      <ViewerHud sequencing={sequencing} joints={jointAngles} floating={false} />
                    </div>
                  )}
                  <div className="relative min-w-0 flex-1">
                    <PitchViewer
                      mode={mode}
                      videoUrls={p.media.videoUrls}
                      camera={camera}
                      pose={pose.data}
                      overlay={overlay}
                      jointAngles={jointAngles}
                      series={p.series}
                      showModel3D={showModel3D}
                      className="size-full"
                    />
                    <FrameReadout />
                  </div>
                </div>
              ) : (
                <>
                  <div className="absolute inset-0">
                    <PitchViewer
                      mode={mode}
                      videoUrls={p.media.videoUrls}
                      camera={camera}
                      pose={pose.data}
                      overlay={overlay}
                      jointAngles={jointAngles}
                      series={p.series}
                      showModel3D={showModel3D}
                      className="size-full"
                    />
                  </div>
                  <ViewerHud sequencing={sequencing} joints={jointAngles} />
                  <FrameReadout />
                </>
              )}
              <div className="absolute top-2 right-2 z-30">
                <ViewSettings
                  mode={mode}
                  onModeChange={setMode}
                  camera={camera}
                  onCameraChange={setCamera}
                  compareOn={false}
                  onCompareToggle={(on) => on && nav(`/compare?a=${p.id}`)}
                  poseOnVideo={overlay}
                  onPoseOnVideoToggle={setOverlay}
                  showModel3D={showModel3D}
                  onShowModel3DToggle={setShowModel3D}
                />
              </div>
            </div>
          }
          bottom={
            <>
              <div className="shrink-0 border-b border-neutral-200">
                <EventTimeline />
                <TransportControls />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="px-4 pt-4 pb-10">
                  <div role="tablist" className="flex gap-2">
                    {REPORT_TABS.map((t) => (
                      <button
                        key={t.id}
                        role="tab"
                        type="button"
                        aria-selected={t.id === tab}
                        onClick={() => setParams({ tab: t.id }, { replace: true })}
                        className={`rounded px-3 py-1.5 text-xs font-bold ${
                          t.id === tab ? "bg-[var(--color-brand)]" : "bg-white text-neutral-700"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-col gap-6">
                    {groups.map((g) => (
                      <GroupBlock key={g} group={g} pitch={p} overlaid={g === "phase_sequencing"} />
                    ))}
                  </div>

                  {tab === "summary" && (
                    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {summaryScalars.map((s) => (
                        <ScalarCard key={s.key} scalar={s} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          }
        />
      </div>
    </PlaybackProvider>
  );
}

function GroupBlock({
  group,
  pitch,
  overlaid,
}: {
  group: SeriesGroupKey;
  pitch: { series: import("@/api/types").SeriesData[] };
  overlaid: boolean;
}) {
  const series = seriesIn(pitch.series, group);
  if (!series.length) return null;
  const h = GROUP_HEADINGS[group];

  return (
    <section>
      <h2 className="mb-2 text-sm font-bold">
        {h.zh}　<span className="font-normal text-neutral-500">{h.en}</span>
      </h2>
      {overlaid ? (
        <SeriesChart series={series} legend band height={200} />
      ) : (
        <div className="flex flex-col gap-2">
          {series.map((s) => (
            <SeriesChart key={s.key} series={[s]} band caption={`${s.label} (${s.labelEn})`} height={132} />
          ))}
        </div>
      )}
    </section>
  );
}

function ScalarCard({ scalar }: { scalar: ScalarData }) {
  const pos = scalarPosition(scalar);
  return (
    <div className="relative rounded-lg bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold">
          {scalar.label}　<span className="font-normal text-neutral-500">{scalar.labelEn} ({scalar.unit})</span>
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-neutral-400">{scalar.atEvent ? scalar.atEvent.toUpperCase() : "—"}</span>
          <InfoHint text={`${scalar.hint}（參考範圍 ${scalar.refMin}–${scalar.refMax} ${scalar.unit}）`} />
        </div>
      </div>
      <p className="mt-1 text-3xl font-bold">{scalar.value ?? "—"}</p>
      <div className="relative mt-3 h-2 rounded bg-neutral-200">
        {pos !== null && <span className="absolute top-0 h-full w-1 rounded bg-black" style={{ left: `${pos * 100}%` }} />}
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        參考範圍 {scalar.refMin}–{scalar.refMax} {scalar.unit}
      </p>
    </div>
  );
}


