import { scalarPosition } from "@/api/hooks";
import { InfoHint } from "@/components/common";
import type { ScalarData } from "@/api/types";

/**
 * One metric, two pitches, one shared scale. The bar's three bands are the
 * reference range; each pitch gets a marker so the gap between them is legible
 * without reading the numbers.
 */
export function CompareMetricCard({ a, b }: { a: ScalarData; b: ScalarData | null }) {
  const pa = scalarPosition(a);
  const pb = b ? scalarPosition(b) : null;

  return (
    <div className="relative rounded-lg bg-[var(--color-surface-muted)] p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-bold">
          {a.label}　<span className="font-medium text-neutral-500">{a.labelEn}（{a.unit}）</span>
        </h3>
        <InfoHint text={`${a.hint}${a.atEvent ? `（取樣於 ${a.atEvent.toUpperCase()}）` : ""}`} />
      </div>

      <div className="mt-1 flex items-baseline gap-7">
        <span className="text-[40px] leading-none font-bold" style={{ color: "var(--color-compare-a)" }}>
          {a.value ?? "—"}
        </span>
        <span className="text-[40px] leading-none font-bold" style={{ color: "var(--color-compare-b)" }}>
          {b?.value ?? "—"}
        </span>
      </div>

      <div className="relative mt-4 h-3 overflow-hidden rounded-sm">
        <div className="flex h-full">
          <div className="flex-1" style={{ background: "var(--color-cmpbar-1)" }} />
          <div className="flex-[1.5]" style={{ background: "var(--color-cmpbar-2)" }} />
          <div className="flex-1" style={{ background: "var(--color-cmpbar-3)" }} />
        </div>
        {pa !== null && <Marker position={pa} color="var(--color-compare-a)" label={`記錄 1 ${a.value}`} />}
        {pb !== null && <Marker position={pb} color="var(--color-compare-b)" label={`記錄 2 ${b?.value}`} />}
      </div>
    </div>
  );
}

function Marker({ position, color, label }: { position: number; color: string; label: string }) {
  return (
    <span
      title={label}
      className="absolute top-0 h-full w-[3px] -translate-x-1/2"
      style={{ left: `${position * 100}%`, background: color }}
    />
  );
}
