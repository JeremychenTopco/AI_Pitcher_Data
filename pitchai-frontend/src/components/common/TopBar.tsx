import { Link } from "react-router-dom";
import { useSession } from "@/app/SessionContext";

interface Props {
  breadcrumb?: Array<{ label: string; to?: string }>;
  center?: React.ReactNode;
  right?: React.ReactNode;
}

/** Yellow bar that sits above the page content on every signed-in screen. */
export function TopBar({ breadcrumb, center, right }: Props) {
  const { user } = useSession();

  return (
    <header className="sticky top-0 z-20 flex h-11 shrink-0 items-center gap-6 bg-[var(--color-brand)] px-4">
      {breadcrumb && (
        <nav aria-label="麵包屑" className="truncate text-[11px] font-medium">
          {breadcrumb.map((b, i) => (
            <span key={i}>
              {i > 0 && " / "}
              {b.to ? (
                <Link to={b.to} className="hover:underline">
                  {b.label}
                </Link>
              ) : (
                b.label
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="flex flex-1 items-center justify-center gap-3">{center}</div>

      {right}

      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs font-bold">{user.name}</span>
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="size-6 rounded-full object-cover" />
        ) : (
          <div className="grid size-6 place-items-center rounded-full bg-neutral-300">
            <svg viewBox="0 0 24 24" className="size-4 fill-neutral-500">
              <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-8 2.5-8 5v3h16v-3c0-2.5-3-5-8-5z" />
            </svg>
          </div>
        )}
      </div>
    </header>
  );
}
