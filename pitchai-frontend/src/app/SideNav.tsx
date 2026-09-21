import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useSession } from "./SessionContext";

/**
 * Black rail. Collapsed it is an icon strip; expanded it adds the avatar block
 * and labels. 檢測live is in the design but deferred, so it renders disabled
 * rather than being dropped — the slot keeps its place in the order.
 */
const ITEMS = [
  { to: "/", label: "首頁", icon: HomeIcon, end: true },
  { to: "/live", label: "檢測live", icon: LiveIcon, disabled: true },
  { to: "/players", label: "選手資料庫", icon: LibraryIcon },
  { to: "/reports", label: "選手報告", icon: ReportIcon, disabled: true, activePrefix: "/report" },
  { to: "/compare", label: "比較", icon: CompareIcon },
  { to: "/settings", label: "基本設定", icon: SettingsIcon },
];

export function SideNav() {
  const [expanded, setExpanded] = useState(false);
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user, role, setRole, logout } = useSession();

  return (
    <nav
      className={`flex shrink-0 flex-col bg-black text-[var(--color-brand)] transition-[width] duration-200 ${
        expanded ? "w-[148px]" : "w-[56px]"
      }`}
      aria-label="主選單"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "收合選單" : "展開選單"}
        className="flex h-12 items-center px-4"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`size-4 ${expanded ? "rotate-180" : ""}`}>
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="flex flex-col items-center gap-2 px-2 pb-5">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="size-16 rounded-full object-cover" />
          ) : (
            <div className="grid size-16 place-items-center rounded-full bg-neutral-300">
              <svg viewBox="0 0 24 24" className="size-10 fill-neutral-500">
                <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-8 2.5-8 5v3h16v-3c0-2.5-3-5-8-5z" />
              </svg>
            </div>
          )}
          <span className="text-center text-[11px] font-medium text-white">{user.name}, 你好</span>
        </div>
      )}

      <ul className="flex flex-col gap-0.5 px-2">
        {ITEMS.map(({ to, label, icon: Icon, end, disabled, activePrefix }) => {
          const activeByPrefix = activePrefix ? pathname.startsWith(activePrefix) : false;
          return (
          <li key={to}>
            {disabled ? (
              <span
                title={activeByPrefix ? undefined : "尚未開放"}
                aria-current={activeByPrefix ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium ${
                  activeByPrefix ? "bg-[var(--color-brand)] text-black" : "opacity-35"
                }`}
              >
                <Icon />
                {expanded && <span className="whitespace-nowrap">{label}</span>}
              </span>
            ) : (
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium ${
                    isActive ? "bg-[var(--color-brand)] text-black" : "hover:bg-white/10"
                  }`
                }
              >
                <Icon />
                {expanded && <span className="whitespace-nowrap">{label}</span>}
              </NavLink>
            )}
          </li>
          );
        })}

        <li>
          <button
            type="button"
            onClick={() => {
              logout();
              nav("/login", { replace: true });
            }}
            className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-white/10"
          >
            <LogoutIcon />
            {expanded && <span className="whitespace-nowrap">登出</span>}
          </button>
        </li>
      </ul>

      {expanded && (
        <div className="mt-auto border-t border-white/15 p-2">
          <label className="mb-1 block text-[10px] text-neutral-400">開發用身分</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "coach" | "player")}
            className="w-full rounded bg-neutral-800 p-1 text-[11px] text-white"
            aria-label="切換身分"
          >
            <option value="coach">教練</option>
            <option value="player">選手</option>
          </select>
        </div>
      )}
    </nav>
  );
}

const ic = "size-4 shrink-0";
function HomeIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ic}><path d="M3 10l9-7 9 7v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>; }
function LiveIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ic}><rect x="2" y="6" width="13" height="12" rx="2" /><path d="M15 11l6-3v8l-6-3z" /></svg>; }
function LibraryIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ic}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /></svg>; }
function ReportIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ic}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>; }
function CompareIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ic}><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></svg>; }
function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={ic}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
function LogoutIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={ic}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>; }
