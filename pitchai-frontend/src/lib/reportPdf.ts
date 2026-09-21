import { GROUP_HEADINGS, scalarsIn, seriesIn } from "@/api/hooks";
import type { EventKey, PitchDetail, PitchEvents, ScalarData, SeriesData, SeriesGroupKey } from "@/api/types";
import type { PoseData } from "@/api/dataSource";

/**
 * 報告書下載 — builds a real .pdf client-side via jsPDF (loaded from a CDN
 * script tag, see index.html) and triggers the browser's save dialog.
 *
 * jsPDF's own text rendering only ships Latin fonts, so any Chinese string
 * (player names, 直球/四縫線速球, 手肘屈曲…) would come out as blank boxes if
 * drawn with `doc.text()` directly. Rather than embedding a CJK font (a multi-
 * MB asset with no easy source here), Chinese text is rasterised through an
 * offscreen <canvas> — the browser's own font stack renders it fine — and
 * placed with `doc.addImage()`. ASCII/numeric text still goes through
 * `doc.text()` for sharper, smaller output. See `drawText` below; every other
 * builder in this file only calls that, never `doc.text`/`doc.addImage` raw.
 *
 * Charts are redrawn with jsPDF's own vector primitives (lines, filled paths
 * for the band) straight from each SeriesData's samples/refLower/refUpper —
 * not a screenshot of the on-screen SVG — so the same series-key pairing the
 * web charts use (see CompareResultPage's PairedCharts) is reused here too.
 * Skeleton panels are drawn the same way, from PoseData's joints2d/bones.
 */

const MARGIN = 36;
const GROUP_ORDER = Object.keys(GROUP_HEADINGS) as SeriesGroupKey[];
/** 圖表上要畫的事件線 — 不含 fps（起始），跟網頁版報告只標 FP/MER/BR 一致。 */
const EVENT_ORDER: EventKey[] = ["fp", "mer", "br"];
const EVENT_LABEL: Record<EventKey, string> = { fps: "FPS", fp: "FP", mer: "MER", br: "BR" };
const POSE_EVENTS: EventKey[] = ["fp", "mer", "br"];
const REC1_RGB: [number, number, number] = [37, 99, 235];
const REC2_RGB: [number, number, number] = [217, 119, 6];
/** One uniform colour for every 個人報告 chart except 動作階段分序 (which still needs one colour per curve to read its legend). */
const CHART_RGB: [number, number, number] = [37, 99, 235];
const INK: [number, number, number] = [23, 23, 23];
const MUTED: [number, number, number] = [115, 115, 115];
const BAND_RGB: [number, number, number] = [225, 225, 225];

function getJsPDF() {
  const ctor = window.jspdf?.jsPDF;
  if (!ctor) throw new Error("jsPDF 尚未載入完成，請稍後再試一次。");
  return ctor;
}

const CJK_RE = /[　-鿿＀-￯]/;

/** Rasterise one line of text (any script) onto an offscreen canvas → PNG. */
function rasterizeText(text: string, pxSize: number, bold: boolean, color: [number, number, number]) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `${bold ? 700 : 400} ${pxSize}px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif`;
  ctx.font = font;
  const w = Math.max(1, Math.ceil(ctx.measureText(text).width) + 4);
  const h = Math.ceil(pxSize * 1.3);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font; // resizing the canvas resets context state
  ctx.textBaseline = "top";
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  ctx.fillText(text, 2, h * 0.12);
  return { dataUrl: canvas.toDataURL("image/png"), w, h };
}

/**
 * Draws one line of text with its top-left at (x, yTop) — every caller in
 * this file uses this, never jsPDF's own `text`/`addImage`. Returns the line
 * height actually used, so callers can advance their cursor by it.
 */
function drawText(
  doc: JsPDFDoc,
  text: string,
  x: number,
  yTop: number,
  opts: { size?: number; color?: [number, number, number]; align?: "left" | "center" | "right"; bold?: boolean } = {},
): number {
  const { size = 9, color = INK, align = "left", bold = false } = opts;
  const lineH = size * 1.25;
  if (!text) return lineH;

  if (!CJK_RE.test(text)) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(text, x, yTop + size * 0.8, { align });
    return lineH;
  }

  const scale = 3; // rasterise a few times larger than needed, for crisp output
  const { dataUrl, w, h } = rasterizeText(text, size * scale, bold, color);
  const hPt = lineH;
  const wPt = hPt * (w / h);
  const drawX = align === "center" ? x - wPt / 2 : align === "right" ? x - wPt : x;
  doc.addImage(dataUrl, "PNG", drawX, yTop, wPt, hPt);
  return lineH;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [90, 90, 90];
}

/** jsPDF fills are fully opaque (no cheap alpha like the web chart's 10%-opacity band) — blend toward white instead. */
function lighten(rgb: [number, number, number], amount = 0.85): [number, number, number] {
  return [rgb[0], rgb[1], rgb[2]].map((c) => Math.round(c + (255 - c) * amount)) as [number, number, number];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Tracks the page cursor and adds a new page when content would overflow. */
class Flow {
  doc: JsPDFDoc;
  pageW: number;
  pageH: number;
  x = MARGIN;
  y = MARGIN;
  constructor(doc: JsPDFDoc) {
    this.doc = doc;
    this.pageW = doc.internal.pageSize.getWidth();
    this.pageH = doc.internal.pageSize.getHeight();
  }
  /** Call before drawing a block of height `h`; starts a new page if it won't fit. */
  ensure(h: number) {
    if (this.y + h > this.pageH - MARGIN) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }
}

/* ------------------------------------------------------------------ chart */

/**
 * Catmull-Rom smoothing, same fit SeriesChart.tsx's `spline()` uses — but
 * returned as plain sampled points rather than jsPDF `lines()` bezier delta
 * segments. jsPDF's bezier-segment delta convention for `lines()` isn't
 * documented clearly enough to trust blindly (an earlier version of this
 * file used it and the band came out warped), so the curve is flattened to
 * many short straight segments instead — at this point density it reads as
 * smooth, and plain `[dx,dy]` line segments have unambiguous behaviour.
 */
function smoothPoints(pts: Array<[number, number]>, tension = 0.18): Array<[number, number]> {
  if (pts.length < 2) return pts;
  const out: Array<[number, number]> = [pts[0]];
  const STEPS = 6;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * tension;
    const c1y = p1[1] + (p2[1] - p0[1]) * tension;
    const c2x = p2[0] - (p3[0] - p1[0]) * tension;
    const c2y = p2[1] - (p3[1] - p1[1]) * tension;
    for (let t = 1; t <= STEPS; t++) {
      const u = t / STEPS;
      const mt = 1 - u;
      const x = mt * mt * mt * p1[0] + 3 * mt * mt * u * c1x + 3 * mt * u * u * c2x + u * u * u * p2[0];
      const y = mt * mt * mt * p1[1] + 3 * mt * mt * u * c1y + 3 * mt * u * u * c2y + u * u * u * p2[1];
      out.push([x, y]);
    }
  }
  return out;
}

/**
 * Normative-range band as one smooth filled shape — the upper edge is a
 * smooth curve (same fit as the on-screen chart's band), the lower edge is
 * drawn straight back underneath it, same simplification SeriesChart.tsx
 * uses (only the boundary against open space needs to read as smooth). Drawn
 * with no stroke, fill only, and always called before any curve line so the
 * band never sits on top of one.
 */
function drawBand(
  doc: JsPDFDoc,
  toX: (i: number) => number,
  toY: (v: number) => number,
  refLower: Array<number | null>,
  refUpper: Array<number | null>,
  rgb: [number, number, number] = BAND_RGB,
) {
  const upper: Array<[number, number]> = [];
  const lower: Array<[number, number]> = [];
  for (let i = 0; i < refUpper.length; i++) {
    const hi = refUpper[i];
    const lo = refLower[i];
    if (hi === null || hi === undefined || lo === null || lo === undefined) continue;
    upper.push([toX(i), toY(hi)]);
    lower.push([toX(i), toY(lo)]);
  }
  if (upper.length < 2) return;

  const path = [...smoothPoints(upper), ...lower.slice().reverse()];
  const segs: number[][] = [];
  for (let i = 1; i < path.length; i++) {
    segs.push([path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]]);
  }

  doc.setFillColor(...rgb);
  doc.lines(segs, path[0][0], path[0][1], [1, 1], "F", true);
}

const EVENT_COLOR: Record<EventKey, [number, number, number]> = {
  fps: [162, 75, 214],
  fp: [74, 127, 209],
  mer: [51, 65, 85],
  br: [51, 65, 85],
};

/**
 * Vertical marker + small label at each event's frame, same as
 * SeriesChart.tsx's event markers. Lines are drawn at each event's true
 * frame position; labels are drawn separately afterwards with a minimum gap
 * enforced left-to-right, so two events landing close together (a fast
 * delivery can put FP and MER only a few frames apart) don't print their
 * labels on top of each other.
 */
function drawEventLines(doc: JsPDFDoc, toX: (i: number) => number, labelY: number, plotY: number, plotH: number, n: number, events: PitchEvents) {
  const items: Array<{ key: EventKey; x: number; rgb: [number, number, number] }> = [];
  for (const key of EVENT_ORDER) {
    const at = events[key as keyof PitchEvents];
    if (at === undefined) continue;
    items.push({ key, x: toX(clamp(at, 0, n - 1)), rgb: EVENT_COLOR[key] });
  }

  for (const it of items) {
    doc.setDrawColor(...it.rgb);
    doc.setLineWidth(0.4);
    doc.line(it.x, plotY, it.x, plotY + plotH);
  }

  const labels = items.map((it) => ({ ...it })).sort((a, b) => a.x - b.x);
  const MIN_LABEL_GAP = 10;
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].x - labels[i - 1].x < MIN_LABEL_GAP) labels[i].x = labels[i - 1].x + MIN_LABEL_GAP;
  }
  for (const it of labels) {
    drawText(doc, EVENT_LABEL[it.key], it.x, labelY, { size: 5, bold: true, color: it.rgb, align: "center" });
  }
}

/** Y-axis tick numbers (max / mid / min) in the chart's own left gutter. */
function drawYAxisTicks(doc: JsPDFDoc, leftEdge: number, toY: (v: number) => number, yMin: number, yMax: number) {
  for (const v of [yMax, (yMax + yMin) / 2, yMin]) {
    drawText(doc, `${Math.round(v)}`, leftEdge - 2, toY(v) - 2.6, { size: 5.5, color: MUTED, align: "right" });
  }
}


/** X-axis tick numbers (0/25/50/75/100% through the clip) under the plot area. */
function drawXAxisTicks(doc: JsPDFDoc, toX: (i: number) => number, baseY: number, n: number) {
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const i = Math.round(f * (n - 1));
    drawText(doc, `${Math.round(f * 100)}%`, toX(i), baseY, { size: 5, color: MUTED, align: "center" });
  }
}

const DASH_LEN = 2.2;
const GAP_LEN = 2.2;

/**
 * Walks a polyline at a constant pt distance, alternating `dash`-long drawn
 * stretches with `gap`-long skipped ones — dash/gap phase carries across
 * each underlying point-to-point segment, so both stay the same physical
 * length regardless of how steep the curve is at any given point (toggling
 * by sample count instead, the first version of this did, gives visibly
 * uneven dashes/gaps wherever the curve's slope changes).
 */
function drawDashedPolyline(doc: JsPDFDoc, points: Array<[number, number]>, dash: number, gap: number) {
  let on = true;
  let phase = 0;
  for (let i = 1; i < points.length; i++) {
    let [px, py] = points[i - 1];
    const [x1, y1] = points[i];
    const dx = x1 - px;
    const dy = y1 - py;
    let remaining = Math.hypot(dx, dy);
    if (remaining === 0) continue;
    const ux = dx / remaining;
    const uy = dy / remaining;
    while (remaining > 0) {
      const budget = (on ? dash : gap) - phase;
      const step = Math.min(budget, remaining);
      const nx = px + ux * step;
      const ny = py + uy * step;
      if (on) doc.line(px, py, nx, ny);
      px = nx;
      py = ny;
      remaining -= step;
      phase += step;
      if (phase >= (on ? dash : gap) - 1e-6) {
        phase = 0;
        on = !on;
      }
    }
  }
}

/** 記錄1 solid, 記錄2 dashed — same convention SeriesChart.tsx uses. */
function drawCurve(
  doc: JsPDFDoc,
  toX: (i: number) => number,
  toY: (v: number) => number,
  samples: Array<number | null>,
  rgb: [number, number, number],
  width: number,
  dashed = false,
) {
  doc.setDrawColor(...rgb);
  doc.setLineWidth(width);
  let poly: Array<[number, number]> = [];
  const flush = () => {
    if (poly.length >= 2) {
      if (dashed) {
        drawDashedPolyline(doc, poly, DASH_LEN, GAP_LEN);
      } else {
        for (let i = 1; i < poly.length; i++) doc.line(poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]);
      }
    }
    poly = [];
  };
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (v === null || v === undefined) {
      flush();
      continue;
    }
    poly.push([toX(i), toY(v)]);
  }
  flush();
}

/**
 * One small chart: axis box, normative-range band (bottom-most), event
 * lines, then the curve(s) on top — for a single series, optionally with a
 * second record overlaid (比較's per-metric charts).
 */
const PAD = { left: 20, top: 9, right: 3, bottom: 8 };

/**
 * `soloColor`, when given, overrides the curve's own colour — 個人報告 uses
 * this to force one uniform colour across every chart except 動作階段分序
 * (its merged chart still needs each curve's own colour for the legend to
 * mean anything, so its own call site leaves this unset).
 */
function drawChart(
  doc: JsPDFDoc,
  x: number,
  y: number,
  w: number,
  h: number,
  primary: SeriesData,
  events: PitchEvents,
  overlay?: SeriesData,
  soloColor?: [number, number, number],
) {
  doc.setDrawColor(225, 225, 225);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h);

  const n = primary.samples.length;
  if (n < 2) return;
  const yMin = Math.min(primary.yMin, overlay?.yMin ?? primary.yMin);
  const yMax = Math.max(primary.yMax, overlay?.yMax ?? primary.yMax);
  const span = yMax - yMin || 1;
  const px = x + PAD.left;
  const py = y + PAD.top;
  const pw = w - PAD.left - PAD.right;
  const ph = h - PAD.top - PAD.bottom;
  const toX = (i: number) => px + (i / (n - 1)) * pw;
  const toY = (v: number) => py + ph - ((v - yMin) / span) * ph;

  const soloRgb = soloColor ?? hexToRgb(primary.color);

  // Band drawn before anything else in the chart — the true bottom-most
  // layer, under the axis numbers and event labels too, not just under the
  // curve — so it can never paper over them. 比較 (overlay present) forces
  // it to flat grey, same as the web chart's `bandColor`; a standalone
  // report chart keeps it in the curve's own colour, also matching the web
  // chart's default.
  if (primary.refLower && primary.refUpper) {
    drawBand(doc, toX, toY, primary.refLower, primary.refUpper, overlay ? BAND_RGB : lighten(soloRgb));
  }

  drawYAxisTicks(doc, px, toY, yMin, yMax);
  drawXAxisTicks(doc, toX, y + h - 1.5, n);
  drawEventLines(doc, toX, y + 5, py, ph, n, events);

  if (overlay) {
    drawCurve(doc, toX, toY, primary.samples, REC1_RGB, 1.1);
    drawCurve(doc, toX, toY, overlay.samples, REC2_RGB, 1.1, true);
  } else {
    drawCurve(doc, toX, toY, primary.samples, soloRgb, 1.1);
  }
}

/**
 * 動作階段分序 merged into one chart, same treatment the web report gives it
 * (ReportPage's GroupBlock `overlaid` branch) — every series in the group on
 * one axis with its own colour, instead of the usual one-chart-per-series
 * grid. Every band draws first (bottom-most layer), then every curve, so a
 * later series' band can never cover an earlier series' line.
 */
function drawMergedChart(doc: JsPDFDoc, x: number, y: number, w: number, h: number, series: SeriesData[], events: PitchEvents, overlaySeries?: SeriesData[]) {
  doc.setDrawColor(225, 225, 225);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h);

  const all = [...series, ...(overlaySeries ?? [])];
  const n = Math.max(...all.map((s) => s.samples.length));
  if (n < 2) return;
  const yMin = Math.min(...all.map((s) => s.yMin));
  const yMax = Math.max(...all.map((s) => s.yMax));
  const span = yMax - yMin || 1;
  const px = x + PAD.left;
  const py = y + PAD.top;
  const pw = w - PAD.left - PAD.right;
  const ph = h - PAD.top - PAD.bottom;
  const toX = (i: number) => px + (i / (n - 1)) * pw;
  const toY = (v: number) => py + ph - ((v - yMin) / span) * ph;

  // Every band drawn before anything else — the true bottom-most layer,
  // under the axis numbers and event labels too, not just under the curves
  // — so a band can never paper over an axis number or an earlier curve.
  // 比較 (overlaySeries present) forces every band to one flat grey, same as
  // the web chart's `bandColor` — otherwise each series' band keeps its own
  // curve colour, also matching the web chart's default.
  for (const s of all) {
    if (!s.refLower || !s.refUpper) continue;
    drawBand(doc, toX, toY, s.refLower, s.refUpper, overlaySeries ? BAND_RGB : lighten(hexToRgb(s.color)));
  }

  drawYAxisTicks(doc, px, toY, yMin, yMax);
  drawXAxisTicks(doc, toX, y + h - 1.5, n);
  drawEventLines(doc, toX, y + 5, py, ph, n, events);
  for (const s of series) drawCurve(doc, toX, toY, s.samples, hexToRgb(s.color), 1.1);
  if (overlaySeries) for (const s of overlaySeries) drawCurve(doc, toX, toY, s.samples, hexToRgb(s.color), 1, true);

  // legend
  let lx = x;
  const ly = y + h + 9;
  for (const s of series) {
    doc.setDrawColor(...hexToRgb(s.color));
    doc.setLineWidth(1.6);
    doc.line(lx, ly - 2.5, lx + 10, ly - 2.5);
    const tw = drawLegendLabel(doc, s.labelEn, lx + 13, ly - 7);
    lx += 13 + tw + 10;
  }
}

function drawLegendLabel(doc: JsPDFDoc, text: string, x: number, yTop: number): number {
  drawText(doc, text, x, yTop, { size: 7.5, color: MUTED });
  doc.setFontSize(7.5);
  return doc.getTextWidth ? doc.getTextWidth(text) : text.length * 4; // width estimate, fine for legend spacing
}

function chartCaption(s: SeriesData) {
  return `${s.label} (${s.labelEn})　${s.unit}`;
}

/* --------------------------------------------------------------- skeleton */

/** One stick-figure skeleton at a given frame, from PoseData's own joints2d/bones (0–1 normalised, same space the on-screen SVG uses). */
function drawSkeleton(doc: JsPDFDoc, x: number, y: number, w: number, h: number, pose: PoseData, frameIndex: number, rgb: [number, number, number], hollow = false) {
  const frame = pose.frames[clamp(frameIndex, 0, pose.frames.length - 1)];
  if (!frame) return;
  const pt = (i: number): [number, number] => [x + frame.joints2d[i][0] * w, y + frame.joints2d[i][1] * h];

  doc.setDrawColor(...rgb);
  doc.setLineWidth(0.9);
  for (const [a, b] of pose.bones) {
    const [ax, ay] = pt(a);
    const [bx, by] = pt(b);
    doc.line(ax, ay, bx, by);
  }

  for (let i = 0; i < frame.joints2d.length; i++) {
    const [px, py] = pt(i);
    if (hollow) {
      doc.setDrawColor(...rgb);
      doc.setLineWidth(0.6);
      doc.circle(px, py, 1.1, "S");
    } else {
      doc.setFillColor(...rgb);
      doc.circle(px, py, 1, "F");
    }
  }
}

/** FP / MER / BR skeleton panels — one row, one pose (or two, overlaid, for 比較). */
function drawPosePanels(flow: Flow, events: PitchEvents, pose: PoseData | null, overlayEvents?: PitchEvents, overlayPose?: PoseData | null) {
  if (!pose) return;
  sectionHeading(flow, "關鍵姿態", "Key Poses");

  const cols = POSE_EVENTS.length;
  const gap = 12;
  const panelW = (flow.pageW - MARGIN * 2 - gap * (cols - 1)) / cols;
  const panelH = 130;
  flow.ensure(panelH + 16);

  POSE_EVENTS.forEach((key, i) => {
    const px = flow.x + i * (panelW + gap);
    const py = flow.y;
    flow.doc.setDrawColor(225, 225, 225);
    flow.doc.setLineWidth(0.6);
    flow.doc.rect(px, py, panelW, panelH);

    const at = events[key as keyof PitchEvents];
    if (at !== undefined) drawSkeleton(flow.doc, px, py, panelW, panelH, pose, at, REC1_RGB);

    if (overlayPose && overlayEvents) {
      const at2 = overlayEvents[key as keyof PitchEvents];
      if (at2 !== undefined) drawSkeleton(flow.doc, px, py, panelW, panelH, overlayPose, at2, REC2_RGB, true);
    }

    drawText(flow.doc, EVENT_LABEL[key], px + 6, py + 6, { size: 9, bold: true, color: MUTED });
  });

  flow.y += panelH + 16;
}

/* --------------------------------------------------------------- summary */

/**
 * Summary metric row: label, a three-band reference bar with a marker per
 * record, and each record's own value labelled right under its own marker
 * (in that record's colour) — not a single combined number, so it's obvious
 * which number belongs to which mark on the bar.
 */
function drawScalarRow(doc: JsPDFDoc, x: number, y: number, w: number, s: ScalarData, s2?: ScalarData | null) {
  drawText(doc, `${s.label} ${s.labelEn}（${s.unit}）`, x, y, { size: 8.5, color: MUTED });
  const barY = y + 13;
  const barH = 6;
  const labelY = barY + barH + 3;

  doc.setFillColor(238, 238, 238);
  doc.rect(x, barY, w, barH, "F");

  const span = s.refMax - s.refMin || 1;
  const posOf = (value: number) => clamp((value - s.refMin) / span, 0, 1);
  const mark = (value: number | null, rgb: [number, number, number]) => {
    if (value === null) return null;
    const pos = posOf(value);
    doc.setFillColor(...rgb);
    doc.rect(x + pos * w - 0.6, barY - 1, 1.2, barH + 2, "F");
    return pos;
  };

  if (s2) {
    const posA = mark(s.value, REC1_RGB);
    const posB = mark(s2.value, REC2_RGB);
    const half = 13;
    const clampCenter = (px: number) => clamp(px, x + half, x + w - half);

    if (posA !== null && posB !== null) {
      // Same/近似值時兩個標記幾乎疊在一起 — 把兩個數字左右推開，保持都看得到，
      // 而不是互相蓋住或黏在一起變成一串看不懂的字。
      let cxA = clampCenter(x + posA * w);
      let cxB = clampCenter(x + posB * w);
      const minGap = half * 2;
      const dist = cxB - cxA;
      if (Math.abs(dist) < minGap) {
        const push = (minGap - Math.abs(dist)) / 2;
        const dir = dist >= 0 ? 1 : -1;
        cxA -= push * dir;
        cxB += push * dir;
      }
      cxA = clampCenter(cxA);
      cxB = clampCenter(cxB);
      drawText(doc, `${s.value}`, cxA, labelY, { size: 8, bold: true, color: REC1_RGB, align: "center" });
      drawText(doc, `${s2.value}`, cxB, labelY, { size: 8, bold: true, color: REC2_RGB, align: "center" });
    } else if (posA !== null) {
      drawText(doc, `${s.value}`, clampCenter(x + posA * w), labelY, { size: 8, bold: true, color: REC1_RGB, align: "center" });
    } else if (posB !== null) {
      drawText(doc, `${s2.value}`, clampCenter(x + posB * w), labelY, { size: 8, bold: true, color: REC2_RGB, align: "center" });
    }
  } else {
    const pos = mark(s.value, INK);
    const half = 13;
    const cx = pos === null ? x : clamp(x + pos * w, x + half, x + w - half);
    drawText(doc, `${s.value ?? "—"}`, cx, labelY, { size: 10, bold: true, align: "center" });
  }
}

function sectionHeading(flow: Flow, zh: string, en: string) {
  flow.ensure(22);
  drawText(flow.doc, `${zh}　${en}`, flow.x, flow.y, { size: 12, bold: true });
  flow.y += 20;
}

/**
 * `subtitleLines` is one or more lines, each optionally led by a small
 * colour dot (比較 uses this — 記錄1/記錄2 each on their own line with their
 * own colour, rather than both crammed onto one very long line: that one
 * long line, run as a single string through `drawText`'s CJK rasteriser,
 * came out too wide and ran off the page edge).
 */
function drawHeader(flow: Flow, title: string, subtitleLines: Array<{ text: string; color?: [number, number, number] }>) {
  drawText(flow.doc, title, flow.x, flow.y, { size: 17, bold: true });
  flow.y += 24;
  for (const line of subtitleLines) {
    if (line.color) {
      flow.doc.setFillColor(...line.color);
      flow.doc.circle(flow.x + 2.5, flow.y + 5, 2, "F");
      drawText(flow.doc, line.text, flow.x + 9, flow.y, { size: 9.5, color: MUTED });
    } else {
      drawText(flow.doc, line.text, flow.x, flow.y, { size: 9.5, color: MUTED });
    }
    flow.y += 13;
  }
  flow.y += 3;
  flow.doc.setDrawColor(225, 225, 225);
  flow.doc.setLineWidth(0.6);
  flow.doc.line(flow.x, flow.y, flow.pageW - MARGIN, flow.y);
  flow.y += 16;
}

function drawSeriesGrid(
  flow: Flow,
  series: SeriesData[],
  events: PitchEvents,
  overlaySeries?: SeriesData[],
  soloColor?: [number, number, number],
) {
  const chartCols = 2;
  const gap = 12;
  const chartW = (flow.pageW - MARGIN * 2 - gap) / chartCols;
  const chartH = 92;
  const rowH = chartH + 26;

  series.forEach((s, i) => {
    const col = i % chartCols;
    if (col === 0) flow.ensure(rowH);
    const cx = flow.x + col * (chartW + gap);
    drawText(flow.doc, chartCaption(s), cx, flow.y, { size: 8, color: MUTED });
    drawChart(flow.doc, cx, flow.y + 12, chartW, chartH, s, events, overlaySeries?.[i], soloColor);
    if (col === chartCols - 1 || i === series.length - 1) flow.y += rowH;
  });
  flow.y += 6;
}

/* ---------------------------------------------------------------- single */

export function downloadReportPdf(
  pitch: PitchDetail,
  playerName: string,
  sessionLabel: string,
  pose: PoseData | null,
  throws?: "L" | "R" | null,
) {
  const doc = new (getJsPDF())({ unit: "pt", format: "a4" });
  const flow = new Flow(doc);

  const throwsLabel = throws ? (throws === "L" ? "左投" : "右投") + "　" : "";
  drawHeader(flow, `${playerName}　第 ${pitch.number} 球`, [
    { text: `${throwsLabel}${pitch.pitchType}　${pitch.velocityKmh ?? "—"} km/h　${sessionLabel}　${pitch.thrownAt.slice(0, 10)}` },
  ]);

  sectionHeading(flow, "總覽", "Summary");
  const cols = 3;
  const cellW = (flow.pageW - MARGIN * 2) / cols;
  const cellH = 48;
  const summary = scalarsIn(pitch.scalars, "summary");
  summary.forEach((s, i) => {
    const col = i % cols;
    if (col === 0) flow.ensure(cellH);
    drawScalarRow(doc, flow.x + col * cellW, flow.y, cellW - 12, s);
    if (col === cols - 1 || i === summary.length - 1) flow.y += cellH;
  });
  flow.y += 8;

  drawPosePanels(flow, pitch.events, pose);

  for (const group of GROUP_ORDER) {
    const series = seriesIn(pitch.series, group);
    if (!series.length) continue;
    const h = GROUP_HEADINGS[group];

    if (group === "phase_sequencing") {
      // 動作階段分序 needs each curve's own colour for its legend to mean
      // anything, so it's the one group exempt from 個人報告's one-colour
      // rule — and shows both the merged (合併) overlay and, right under it,
      // every curve separated (分開) into its own small chart, each keeping
      // that same colour so it's obviously "the same line" as in the legend.
      sectionHeading(flow, h.zh, `${h.en}（${series[0]?.unit ?? ""}）`);
      const chartH = 170;
      flow.ensure(chartH + 24);
      drawMergedChart(doc, flow.x, flow.y, flow.pageW - MARGIN * 2, chartH, series, pitch.events);
      flow.y += chartH + 24;
      drawSeriesGrid(flow, series, pitch.events);
      continue;
    }

    sectionHeading(flow, h.zh, h.en);
    drawSeriesGrid(flow, series, pitch.events, undefined, CHART_RGB);
  }

  doc.save(`${playerName}_第${pitch.number}球_報告書.pdf`);
}

/* --------------------------------------------------------------- compare */

export function downloadComparePdf(
  a: PitchDetail,
  aName: string,
  b: PitchDetail,
  bName: string,
  poseA: PoseData | null,
  poseB: PoseData | null,
  aThrows?: "L" | "R" | null,
  bThrows?: "L" | "R" | null,
) {
  const doc = new (getJsPDF())({ unit: "pt", format: "a4" });
  const flow = new Flow(doc);

  const throwsLabel = (t?: "L" | "R" | null) => (t ? (t === "L" ? "左投" : "右投") + " ・ " : "");
  drawHeader(flow, "投球比較報告書", [
    { text: `記錄1　${aName}　${throwsLabel(aThrows)}第 ${a.number} 球 ・ ${a.pitchType} ・ ${a.velocityKmh ?? "—"} km/h`, color: REC1_RGB },
    { text: `記錄2　${bName}　${throwsLabel(bThrows)}第 ${b.number} 球 ・ ${b.pitchType} ・ ${b.velocityKmh ?? "—"} km/h`, color: REC2_RGB },
  ]);

  sectionHeading(flow, "總覽", "Summary");
  const cols = 2;
  const cellW = (flow.pageW - MARGIN * 2) / cols;
  const cellH = 48;
  const summaryA = scalarsIn(a.scalars, "summary");
  summaryA.forEach((s, i) => {
    const s2 = scalarsIn(b.scalars, "summary").find((x) => x.key === s.key) ?? null;
    const col = i % cols;
    if (col === 0) flow.ensure(cellH);
    drawScalarRow(doc, flow.x + col * cellW, flow.y, cellW - 12, s, s2);
    if (col === cols - 1 || i === summaryA.length - 1) flow.y += cellH;
  });
  flow.y += 8;

  drawPosePanels(flow, a.events, poseA, b.events, poseB);

  for (const group of GROUP_ORDER) {
    const sa = seriesIn(a.series, group);
    const sb = seriesIn(b.series, group);
    if (!sa.length) continue;
    const h = GROUP_HEADINGS[group];
    sectionHeading(flow, h.zh, h.en);

    if (group === "phase_sequencing") {
      const chartH = 170;
      flow.ensure(chartH + 24);
      drawMergedChart(doc, flow.x, flow.y, flow.pageW - MARGIN * 2, chartH, sa, a.events, sb);
      flow.y += chartH + 24;
      continue;
    }

    // Paired by position within the group, same as CompareResultPage's PairedCharts —
    // the two fixture families don't always share series keys.
    drawSeriesGrid(flow, sa, a.events, sb);
  }

  doc.save(`${aName}_vs_${bName}_比較報告書.pdf`);
}
