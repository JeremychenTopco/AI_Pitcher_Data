import { useId, useMemo, useRef, useState } from "react";
import { usePlayback } from "@/playback/PlaybackContext";
import { EVENT_LABELS, type EventKey, type PitchEvents, type SeriesData } from "@/api/types";

const W = 1000;
const PAD = { top: 26, right: 14, bottom: 14, left: 42 };

const EVENT_ORDER: EventKey[] = ["fps", "fp", "mer", "br"];
const EVENT_DASH: Partial<Record<EventKey, string>> = { br: "5 4" };
const EVENT_COLOR: Record<EventKey, string> = {
  fps: "#a24bd6",
  fp: "#4a7fd1",
  mer: "#334155",
  br: "#334155",
};

/** Kinematics comparison colours — 記錄1 藍、記錄2 橘. 總覽 keeps series colours. */
const REC1 = "var(--color-compare-a)";
const REC2 = "var(--color-compare-b)";

/** 比較頁's normative-range band — flat grey, so it never reads as a third record. */
export const COMPARE_BAND_COLOR = "#94a3b8";

const PLAYHEAD = "#475569";

/**
 * A second record drawn on the same axes — 疊圖比較.
 *
 * `variant "series"` (動作階段分序 / 總覽) keeps each data's own colour for both
 * records and separates them by solid vs dashed; its legend spotlights one data
 * pair on hover.
 * `variant "records"` (a single kinematics metric) is read by record: 記錄1 blue
 * with its reference band, 記錄2 orange dashed.
 */
export interface ChartOverlay {
  series: SeriesData[];
  events: PitchEvents;
  progress: number;
}

interface Props {
  series: SeriesData[];
  /** Draw the reference band behind each curve. */
  band?: boolean;
  /** Force the band to one flat colour instead of the curve's own colour — 比較 uses this so the band never reads as a third record. */
  bandColor?: string;
  caption?: string;
  legend?: boolean;
  height?: number;
  overlay?: ChartOverlay;
  variant?: "series" | "records";
  /**
   * On the compare page, dragging either side's chart should scrub both
   * records together, not just the one it's drawn in — pass the dual-clock
   * seek here to sync (see EventTimeline's identically-purposed `sync` prop).
   * Omit for a single-clock screen (report).
   */
  onSeek?: (ratio: number) => void;
}

/* ---------------------------------------------------------------- geometry */

/** Catmull-Rom → cubic bézier, so the curves read as smooth rather than jagged. */
function spline(pts: Array<[number, number]>, tension = 0.18): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}`;
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

export function SeriesChart({
  series,
  band = false,
  bandColor,
  caption,
  legend = false,
  height = 200,
  overlay,
  variant = "series",
  onSeek,
}: Props) {
  const { events, progress, frameCount, seekRatio: seekRatioLocal } = usePlayback();
  const seekRatio = onSeek ?? seekRatioLocal;
  const gid = useId().replace(/[^a-zA-Z0-9-]/g, ""); // usable in SVG ids / url(#…)

  // Hovering a legend entry (or a line) spotlights it and greys the rest.
  const [hover, setHover] = useState<string | null>(null);
  const emphasise = series.length > 1 || Boolean(overlay);
  const dim = (key: string) => emphasise && hover !== null && hover !== key;

  // Hovering the plot shows the value under the cursor (該點數據); dragging seeks.
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);
  const seeking = useRef(false);
  const sampleCount = series[0]?.samples.length ?? frameCount;

  const records = variant === "records";
  const primaryStroke = (s: SeriesData) => (records ? REC1 : s.color);
  const overlayStroke = (s: SeriesData) => (records ? REC2 : s.color);
  const areaFill = records || series.length === 1;

  const plotW = W - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const baseY = PAD.top + plotH;

  const readFrame = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    const ratio = (px - PAD.left) / plotW;
    return Math.max(0, Math.min(sampleCount - 1, Math.round(ratio * (sampleCount - 1))));
  };

  const spanSeries = [...series, ...(overlay?.series ?? [])];
  const yMin = Math.min(...spanSeries.map((s) => s.yMin));
  const yMax = Math.max(...spanSeries.map((s) => s.yMax));
  const toY = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin || 1)) * plotH;
  const toX = (i: number, n: number) => PAD.left + (i / Math.max(1, n - 1)) * plotW;

  /** Split on nulls (unsolved frames) so gaps break the line. */
  const segmentsOf = (samples: Array<number | null>) => {
    const out: Array<Array<[number, number]>> = [];
    let cur: Array<[number, number]> = [];
    samples.forEach((v, i) => {
      if (v === null || v === undefined) {
        if (cur.length) out.push(cur);
        cur = [];
      } else {
        cur.push([toX(i, samples.length), toY(v)]);
      }
    });
    if (cur.length) out.push(cur);
    return out;
  };

  const lineOf = (samples: Array<number | null>) => segmentsOf(samples).map((seg) => spline(seg)).join(" ");
  const areaOf = (samples: Array<number | null>) =>
    segmentsOf(samples)
      .map((seg) => `${spline(seg)} L${seg[seg.length - 1][0].toFixed(1)} ${baseY} L${seg[0][0].toFixed(1)} ${baseY} Z`)
      .join(" ");

  const drawn = useMemo(
    () =>
      series.map((s) => {
        let bandD: string | null = null;
        if (band && s.refLower && s.refUpper) {
          const up = spline(s.refUpper.map((v, i) => [toX(i, s.refUpper!.length), toY(v)]));
          const down = s.refLower
            .map((v, i) => `L${toX(i, s.refLower!.length).toFixed(1)} ${toY(v).toFixed(1)}`)
            .reverse()
            .join(" ");
          bandD = `${up} ${down} Z`;
        }
        return { ...s, d: lineOf(s.samples), area: areaOf(s.samples), bandD };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, band, height, yMin, yMax],
  );

  const drawnOverlay = useMemo(
    () => (overlay?.series ?? []).map((s) => ({ ...s, d: lineOf(s.samples) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overlay?.series, height, yMin, yMax],
  );

  const ticks = [yMax, (yMax + yMin) / 2, yMin];
  const playheadX = PAD.left + progress * plotW;
  const overlayHeadX = overlay ? PAD.left + overlay.progress * plotW : null;
  const unit = series[0]?.unit ?? "";

  const hairX = hoverFrame === null ? null : toX(hoverFrame, sampleCount);
  const tipRows =
    hoverFrame === null
      ? []
      : [
          ...series.map((s) => ({
            label: overlay && records ? "記錄1" : s.label,
            color: primaryStroke(s),
            value: s.samples[hoverFrame],
          })),
          ...(overlay?.series ?? []).map((s) => ({
            label: records ? "記錄2" : `${s.label}（記錄2）`,
            color: overlayStroke(s),
            value: s.samples[hoverFrame],
          })),
        ];

  return (
    <figure className="relative rounded-xl border border-neutral-200/80 bg-white p-3">
      {(caption || (legend && emphasise)) && (
        <div className="mb-1.5 flex items-center justify-between gap-3">
          {caption ? (
            <figcaption className="text-[11px] font-medium tracking-wide text-neutral-500">{caption}</figcaption>
          ) : (
            <span />
          )}
          {legend && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {series.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onMouseEnter={() => emphasise && setHover(s.key)}
                  onMouseLeave={() => emphasise && setHover(null)}
                  className={`flex items-center gap-1.5 text-[11px] transition-opacity ${
                    dim(s.key) ? "opacity-35" : "opacity-100"
                  }`}
                >
                  <span className="h-[3px] w-3.5 rounded-full" style={{ background: s.color }} />
                  <span className="text-neutral-500">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full cursor-crosshair select-none"
        role="img"
        aria-label={caption ?? "投球數據曲線"}
        onPointerDown={(e) => {
          seeking.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const f = readFrame(e.clientX, e.currentTarget.getBoundingClientRect());
          setHoverFrame(f);
          seekRatio(f / Math.max(1, sampleCount - 1));
        }}
        onPointerMove={(e) => {
          const f = readFrame(e.clientX, e.currentTarget.getBoundingClientRect());
          setHoverFrame(f);
          if (seeking.current) seekRatio(f / Math.max(1, sampleCount - 1));
        }}
        onPointerUp={(e) => {
          seeking.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }}
        onPointerCancel={() => (seeking.current = false)}
        onPointerLeave={() => {
          if (!seeking.current) setHoverFrame(null);
        }}
      >
        <defs>
          {drawn.map((s) => (
            <linearGradient key={s.key} id={`${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primaryStroke(s)} stopOpacity={0.16} />
              <stop offset="100%" stopColor={primaryStroke(s)} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* grid */}
        <g>
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={toY(t)}
              y2={toY(t)}
              stroke="#f1f2f4"
              strokeWidth={1}
            />
          ))}
          {ticks.map((t, i) => (
            <text
              key={`t${i}`}
              x={PAD.left - 7}
              y={toY(t) + 3.5}
              textAnchor="end"
              className="fill-neutral-400 text-[10px]"
            >
              {Math.round(t)}
            </text>
          ))}
          {unit && (
            <text x={PAD.left - 7} y={PAD.top - 9} textAnchor="end" className="fill-neutral-300 text-[9px]">
              {unit}
            </text>
          )}
        </g>

        {/* 記錄2 event markers */}
        {overlay &&
          EVENT_ORDER.map((key) => {
            const at = overlay.events[key as keyof PitchEvents];
            if (at === undefined) return null;
            const ex = toX(at, overlay.series[0]?.samples.length ?? frameCount);
            return (
              <line
                key={`ov-${key}`}
                x1={ex}
                x2={ex}
                y1={PAD.top - 4}
                y2={baseY}
                stroke={records ? REC2 : "var(--color-compare-b)"}
                strokeWidth={1}
                strokeDasharray="3 4"
                opacity={0.4}
              />
            );
          })}

        {/* 記錄1 event markers */}
        {EVENT_ORDER.map((key) => {
          const at = events[key as keyof PitchEvents];
          if (at === undefined) return null;
          const ex = toX(at, frameCount);
          return (
            <g key={key}>
              <line
                x1={ex}
                x2={ex}
                y1={PAD.top - 4}
                y2={baseY}
                stroke={EVENT_COLOR[key]}
                strokeWidth={1}
                strokeDasharray={EVENT_DASH[key]}
                opacity={0.5}
              />
              <circle cx={ex} cy={PAD.top - 13} r={2} fill={EVENT_COLOR[key]} />
              <text
                x={ex}
                y={PAD.top - 17}
                textAnchor="middle"
                className="text-[9px] font-bold"
                fill={EVENT_COLOR[key]}
              >
                {EVENT_LABELS[key]}
              </text>
            </g>
          );
        })}

        {/* reference band */}
        {drawn.map((s) =>
          s.bandD ? (
            <path
              key={`b-${s.key}`}
              d={s.bandD}
              fill={bandColor ?? (records ? REC1 : s.color)}
              opacity={dim(s.key) ? 0.04 : 0.1}
            />
          ) : null,
        )}

        {/* 記錄1 curves */}
        {drawn.map((s) => (
          <g
            key={s.key}
            opacity={dim(s.key) ? 0.12 : 1}
            onMouseEnter={() => emphasise && setHover(s.key)}
            onMouseLeave={() => emphasise && setHover(null)}
          >
            {areaFill && !s.bandD && <path d={s.area} fill={`url(#${gid}-${s.key})`} />}
            <path
              d={s.d}
              fill="none"
              stroke={primaryStroke(s)}
              strokeWidth={1.9}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ))}

        {/* 記錄2 curves — dashed */}
        {drawnOverlay.map((s) => (
          <path
            key={`ov-${s.key}`}
            d={s.d}
            fill="none"
            stroke={overlayStroke(s)}
            strokeWidth={1.7}
            strokeDasharray="6 4"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={dim(s.key) ? 0.12 : 0.95}
            onMouseEnter={() => emphasise && setHover(s.key)}
            onMouseLeave={() => emphasise && setHover(null)}
          />
        ))}

        {/* hover readout */}
        {hairX !== null && hoverFrame !== null && (
          <g pointerEvents="none">
            <line x1={hairX} x2={hairX} y1={PAD.top - 4} y2={baseY} stroke="#cbd5e1" strokeWidth={1} />
            {series.map((s) => {
              const v = s.samples[hoverFrame];
              if (v === null || v === undefined || dim(s.key)) return null;
              return (
                <circle key={`hp-${s.key}`} cx={hairX} cy={toY(v)} r={3.2} fill={primaryStroke(s)} stroke="#fff" strokeWidth={1.5} />
              );
            })}
            {(overlay?.series ?? []).map((s) => {
              const v = s.samples[hoverFrame];
              if (v === null || v === undefined || dim(s.key)) return null;
              return (
                <circle key={`ho-${s.key}`} cx={hairX} cy={toY(v)} r={3.2} fill="#fff" stroke={overlayStroke(s)} strokeWidth={1.8} />
              );
            })}
          </g>
        )}

        {/* playheads */}
        <line x1={playheadX} x2={playheadX} y1={PAD.top - 4} y2={baseY} stroke={PLAYHEAD} strokeWidth={1.5} />
        <circle cx={playheadX} cy={PAD.top - 4} r={3} fill={PLAYHEAD} />
        {overlayHeadX !== null && (
          <line
            x1={overlayHeadX}
            x2={overlayHeadX}
            y1={PAD.top - 4}
            y2={baseY}
            stroke={PLAYHEAD}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            opacity={0.45}
          />
        )}
      </svg>

      {hairX !== null && tipRows.length > 0 && (
        <div
          className="pointer-events-none absolute top-10 z-10 min-w-[7.5rem] rounded-lg bg-white/97 px-2.5 py-1.5 text-[11px] text-neutral-700 shadow-lg ring-1 ring-black/5"
          style={{
            left: `${(hairX / W) * 100}%`,
            transform: hairX > W * 0.6 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          }}
        >
          <p className="mb-1 text-[10px] font-bold tracking-wide text-neutral-400">第 {hoverFrame! + 1} 幀</p>
          {tipRows.map((r, i) => (
            <p key={i} className="flex items-center gap-2 whitespace-nowrap py-px">
              <span className="inline-block size-1.5 rounded-full" style={{ background: r.color }} />
              <span className="text-neutral-500">{r.label}</span>
              <span className="ml-auto font-bold tabular-nums">
                {r.value === null || r.value === undefined ? "—" : Math.round(r.value)}
              </span>
            </p>
          ))}
        </div>
      )}

      {overlay && (
        <div className="mt-1.5 flex items-center justify-end gap-3 text-[10px] font-medium text-neutral-500">
          {records ? (
            <>
              <span className="flex items-center gap-1.5">
                <Swatch color={REC1} /> 記錄1
              </span>
              <span className="flex items-center gap-1.5">
                <Swatch color={REC2} dashed /> 記錄2
              </span>
            </>
          ) : (
            <span>實線 記錄1　·　虛線 記錄2</span>
          )}
        </div>
      )}
    </figure>
  );
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <span
      className="inline-block h-0 w-4 align-middle"
      style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }}
    />
  );
}
