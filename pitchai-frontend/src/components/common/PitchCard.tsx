import { Link } from "react-router-dom";
import type { Pitch } from "@/api/types";
import { BookmarkIcon, StatusBadge } from "./index";

interface Props {
  pitch: Pitch;
  /** Rendered when the card is selectable (compare picking, batch actions). */
  selected?: boolean;
  onToggleSelect?: (id: string, next: boolean) => void;
  onToggleStar?: (id: string, next: boolean) => void;
}

/** Thumbnail tile used by both the player log and the session grid. */
export function PitchCard({ pitch, selected, onToggleSelect, onToggleStar }: Props) {
  return (
    <div className="overflow-hidden rounded-lg bg-white">
      <Link to={`/report/${pitch.id}`} className="block">
        <div className="aspect-video bg-neutral-300" />
      </Link>
      <div className="flex items-center gap-2 px-3 py-2">
        <StatusBadge status={pitch.status} />
        <Link to={`/report/${pitch.id}`} className="text-xs font-bold hover:underline">
          第 {pitch.number} 球
        </Link>

        <button
          type="button"
          onClick={() => onToggleStar?.(pitch.id, !pitch.starred)}
          aria-pressed={pitch.starred}
          aria-label={pitch.starred ? "取消標記最愛" : "標記為最愛"}
          className={`leading-none ${pitch.starred ? "text-amber-400 hover:text-amber-500" : "text-neutral-300 hover:text-neutral-500"}`}
        >
          <BookmarkIcon filled={pitch.starred} />
        </button>

        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => onToggleSelect(pitch.id, e.target.checked)}
            aria-label={`選取第 ${pitch.number} 球`}
            className="ml-auto"
          />
        )}
      </div>
    </div>
  );
}
