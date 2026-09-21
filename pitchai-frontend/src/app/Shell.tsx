import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./SessionContext";
import { SideNav } from "./SideNav";

export function Shell() {
  const { authed } = useSession();
  if (!authed) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-full">
      <SideNav />
      <main className="min-w-0 flex-1 overflow-y-auto bg-[var(--color-canvas)]">
        <Outlet />
      </main>
    </div>
  );
}
