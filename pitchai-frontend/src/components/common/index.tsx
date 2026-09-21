import { useState } from "react";
import { Link } from "react-router-dom";
import { STATUS_LABELS, type AnalysisStatus } from "@/api/types";
import { fileToDataUrl } from "@/lib/image";
import { AvatarCropper } from "./AvatarCropper";

/**
 * Player photo, or the placeholder icon when there is none. Point `url` at a
 * file under `public/` (e.g. "/media/players/chen.jpg") or a data URL.
 * `className` sets the size (default `size-20`).
 */
export function PlayerAvatar({
  url,
  name,
  className = "size-20",
}: {
  url?: string | null;
  name?: string;
  className?: string;
}) {
  if (url) {
    return <img src={url} alt={name ?? ""} className={`${className} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span className={`${className} grid shrink-0 place-items-center rounded-full bg-neutral-300`}>
      <svg viewBox="0 0 24 24" className="size-3/5 fill-neutral-500">
        <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-8 2.5-8 5v3h16v-3c0-2.5-3-5-8-5z" />
      </svg>
    </span>
  );
}

/**
 * Click-to-upload avatar: pick a file, crop it in the modal, hand a 256×256 data
 * URL to `onPick` (or `null` when cleared).
 */
export function AvatarUpload({
  url,
  name,
  size = "size-20",
  onPick,
}: {
  url?: string | null;
  name?: string;
  size?: string;
  onPick: (dataUrl: string | null) => void;
}) {
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  return (
    <>
      <label className={`group relative block ${size} shrink-0 cursor-pointer`}>
        <PlayerAvatar url={url} name={name} className={size} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-[10px] font-bold text-white opacity-0 transition-opacity group-hover:opacity-100">
          {url ? "更換" : "上傳"}
        </span>
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) setCropSrc(await fileToDataUrl(file));
          }}
        />
      </label>
      {cropSrc && (
        <AvatarCropper
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onDone={(dataUrl) => {
            onPick(dataUrl);
            setCropSrc(null);
          }}
        />
      )}
    </>
  );
}

/**
 * ⓘ that reveals a short explanation on hover / focus, pinned to the top-right
 * of whatever cell it sits in. Render it inside a `relative` container aligned
 * to that corner.
 */
export function InfoHint({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label="說明"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="grid size-4 place-items-center rounded-full text-neutral-500 hover:text-neutral-900"
      >
        <svg viewBox="0 0 24 24" className="size-4 fill-current">
          <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2zm0-8h-2V7h2z" />
        </svg>
      </button>
      {open && (
        <span className="absolute top-5 right-0 z-30 w-52 rounded-md bg-neutral-900/92 px-3 py-2 text-[11px] leading-relaxed font-medium text-white shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

/** 標記最愛 bookmark — filled when starred, outline otherwise. Size via `className` (default `size-4`). */
export function BookmarkIcon({ filled, className = "size-4" }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 11 15" fill="none" className={className}>
      <path
        d="M10.5 0.5H0.5V13.5L5.5 10.6132L10.5 13.5V0.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeOpacity={filled ? 1 : 0.5}
      />
    </svg>
  );
}

export function StatusBadge({ status }: { status: AnalysisStatus }) {
  const tone: Record<AnalysisStatus, string> = {
    done: "bg-green-500 text-white",
    processing: "bg-red-400 text-white",
    pending: "bg-neutral-300 text-neutral-800",
    failed: "bg-neutral-800 text-white",
  };
  return <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${tone[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-xl font-bold">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
    </div>
  );
}

export function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav aria-label="麵包屑" className="mb-2 text-xs text-neutral-500">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && " / "}
          {it.to ? <Link to={it.to} className="hover:underline">{it.label}</Link> : it.label}
        </span>
      ))}
    </nav>
  );
}

export function Loading({ label = "載入中…" }: { label?: string }) {
  return <p className="p-6 text-sm text-neutral-500">{label}</p>;
}

export function ErrorNote({ error }: { error: Error }) {
  return (
    <div className="m-6 rounded border border-red-300 bg-red-50 p-4 text-sm">
      <p className="font-bold">讀取失敗</p>
      <p className="mt-1 text-neutral-700">{error.message}</p>
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg bg-white p-4 ${className}`}>{children}</div>;
}
