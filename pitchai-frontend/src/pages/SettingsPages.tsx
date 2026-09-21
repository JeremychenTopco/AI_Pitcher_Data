import { useMemo, useState } from "react";
import { AvatarUpload, ErrorNote, Loading, PlayerAvatar } from "@/components/common";
import { TopBar } from "@/components/common/TopBar";
import { useSessions, useTeam } from "@/api/hooks";
import { usePlayers, type NewPlayer, type PlayerPatch } from "@/app/PlayersStore";
import { useSession } from "@/app/SessionContext";
import type { Player } from "@/api/types";

/* --------------------------------------------------------------- 基本設定 */

/**
 * 基本設定. The signed-in account's own details at the top, then 選手設定 —
 * the live team roster, editable in place. Coaches edit and add here; adding a
 * player writes straight into the shared roster store, so the new player also
 * appears in 選手資料庫 and the player switcher without a round trip.
 */
export function SettingsPage() {
  const { user, role, setAvatar, updateProfile, changePassword, teamName, setTeamName } = useSession();
  const team = useTeam();
  const { players, loading, error, addPlayer, updatePlayer, removePlayer } = usePlayers();
  const sessions = useSessions();

  const canEdit = role === "coach";

  /** Total pitches per player, for the "N 球" line under each card. */
  const ballCounts = useMemo(() => {
    const by: Record<string, number> = {};
    for (const s of sessions.data ?? []) by[s.playerId] = (by[s.playerId] ?? 0) + s.pitchCount;
    return by;
  }, [sessions.data]);

  if (loading || team.loading) return <Loading />;
  if (error) return <ErrorNote error={error} />;

  return (
    <>
      <TopBar breadcrumb={[{ label: "基本設定" }]} />
      <div className="p-8">
        <h1 className="text-3xl font-bold">你好, {user.name}</h1>

        <ProfileSection
          name={user.name}
          email={user.email}
          avatarUrl={user.avatarUrl}
          teamName={teamName || team.data?.name || "—"}
          onAvatar={(url) => {
            setAvatar(url);
            if (user.playerId) updatePlayer(user.playerId, { avatarUrl: url });
          }}
          onSaveProfile={updateProfile}
          onSaveTeam={setTeamName}
          onChangePassword={changePassword}
        />

        <section className="mt-8 rounded-lg bg-[var(--color-surface-muted)] p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold">選手設定</h2>
            <p className="text-xs text-neutral-500">
              目前共 {players.length} 位
              {canEdit ? "　·　編輯後即時儲存，新增選手會同步寫入選手資料庫" : ""}
            </p>
          </div>

          {sessions.loading ? (
            <Loading label="載入選手名單…" />
          ) : (
            <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {players.map((p) => (
                <li key={p.id}>
                  <PlayerTile
                    player={p}
                    balls={ballCounts[p.id] ?? 0}
                    editable={canEdit}
                    onSave={(patch) => updatePlayer(p.id, patch)}
                    onDelete={() => removePlayer(p.id)}
                  />
                </li>
              ))}
              {canEdit && (
                <li>
                  <AddPlayerTile onAdd={addPlayer} />
                </li>
              )}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- pieces */

type Result = { ok: true } | { ok: false; error: string };

function ProfileSection({
  name,
  email,
  avatarUrl,
  teamName,
  onAvatar,
  onSaveProfile,
  onSaveTeam,
  onChangePassword,
}: {
  name: string;
  email: string;
  avatarUrl?: string | null;
  teamName: string;
  onAvatar: (url: string | null) => void;
  onSaveProfile: (patch: { name?: string; email?: string }) => Result;
  onSaveTeam: (name: string) => void;
  onChangePassword: (current: string, next: string) => Result;
}) {
  const [tab, setTab] = useState<"view" | "profile" | "password">("view");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-5">
        <AvatarUpload url={avatarUrl} name={name} size="size-24" onPick={onAvatar} />
        <div className="flex-1">
          <p className="text-sm font-bold">{name}</p>
          <p className="text-xs text-neutral-500">點頭像可更換照片</p>
        </div>
        {tab === "view" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setMsg(null);
                setTab("profile");
              }}
              className="bg-black px-3 py-2 text-xs font-bold text-white"
            >
              編輯資料
            </button>
            <button
              type="button"
              onClick={() => {
                setMsg(null);
                setTab("password");
              }}
              className="bg-neutral-200 px-3 py-2 text-xs font-bold"
            >
              變更密碼
            </button>
          </div>
        )}
      </div>

      {msg && (
        <p
          className={`mt-3 text-sm font-bold ${
            msg.ok ? "text-[var(--color-status-done)]" : "text-[var(--color-metric-low)]"
          }`}
        >
          {msg.text}
        </p>
      )}

      {tab === "view" && (
        <dl className="mt-4 flex flex-col gap-3">
          <Row label="姓名" value={name} highlight />
          <Row label="信箱" value={email} />
          <Row label="所屬球隊" value={teamName} />
        </dl>
      )}

      {tab === "profile" && (
        <form
          className="mt-4 flex flex-col gap-3 rounded-lg bg-neutral-100 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const r = onSaveProfile({
              name: String(fd.get("name") ?? ""),
              email: String(fd.get("email") ?? ""),
            });
            if (!r.ok) {
              setMsg({ ok: false, text: r.error });
              return;
            }
            onSaveTeam(String(fd.get("team") ?? ""));
            setMsg({ ok: true, text: "已更新" });
            setTab("view");
          }}
        >
          <Field label="姓名" name="name" defaultValue={name} />
          <Field label="信箱" name="email" type="email" defaultValue={email} />
          <Field label="所屬球隊" name="team" defaultValue={teamName === "—" ? "" : teamName} />
          <Actions onCancel={() => setTab("view")} />
        </form>
      )}

      {tab === "password" && (
        <form
          className="mt-4 flex flex-col gap-3 rounded-lg bg-neutral-100 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const cur = String(fd.get("current") ?? "");
            const next = String(fd.get("next") ?? "");
            const confirm = String(fd.get("confirm") ?? "");
            if (next !== confirm) {
              setMsg({ ok: false, text: "兩次新密碼不一致" });
              return;
            }
            const r = onChangePassword(cur, next);
            if (r.ok) {
              setMsg({ ok: true, text: "密碼已變更" });
              setTab("view");
            } else {
              setMsg({ ok: false, text: r.error });
            }
          }}
        >
          <Field label="目前密碼" name="current" type="password" autoComplete="current-password" />
          <Field label="新密碼" name="next" type="password" autoComplete="new-password" />
          <Field label="確認新密碼" name="confirm" type="password" autoComplete="new-password" />
          <Actions onCancel={() => setTab("view")} />
        </form>
      )}
    </div>
  );
}

function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg px-5 py-4 ${highlight ? "bg-[var(--color-brand)]" : "bg-neutral-100"}`}>
      <dt className="text-xs font-bold">{label}</dt>
      <dd className="mt-1 text-sm font-bold break-all">{value}</dd>
    </div>
  );
}

function Field({
  label,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold">{label}</span>
      <input {...rest} className="w-full bg-white px-3 py-2 text-sm outline-none" />
    </label>
  );
}

function Actions({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="mt-1 flex gap-2">
      <button type="submit" className="flex-1 bg-black py-2 text-xs font-bold text-white">
        儲存
      </button>
      <button type="button" onClick={onCancel} className="flex-1 bg-neutral-200 py-2 text-xs font-bold">
        取消
      </button>
    </div>
  );
}

function PlayerTile({
  player,
  balls,
  editable,
  onSave,
  onDelete,
}: {
  player: Player;
  balls: number;
  editable: boolean;
  onSave: (patch: PlayerPatch) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "confirmDelete">("view");

  if (mode === "edit") {
    return (
      <PlayerForm
        title="編輯選手"
        initial={player}
        submitLabel="儲存"
        onCancel={() => setMode("view")}
        onSubmit={(values) => {
          onSave(values);
          setMode("view");
        }}
      />
    );
  }

  if (mode === "confirmDelete") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg bg-white px-4 py-5 text-center">
        <p className="text-sm font-bold">刪除 {player.name}？</p>
        <p className="text-[11px] text-neutral-500">投球紀錄不受影響，僅從名單移除</p>
        <div className="mt-auto flex w-full gap-2">
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 bg-[var(--color-metric-low)] py-2 text-xs font-bold text-white"
          >
            刪除
          </button>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="flex-1 bg-neutral-200 py-2 text-xs font-bold text-neutral-700"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center gap-2 rounded-lg bg-white px-4 py-5 text-center">
      {editable ? (
        <AvatarUpload
          url={player.avatarUrl}
          name={player.name}
          onPick={(dataUrl) => onSave({ avatarUrl: dataUrl })}
        />
      ) : (
        <PlayerAvatar url={player.avatarUrl} name={player.name} />
      )}
      <p className="mt-1 text-sm font-bold">{player.name} 球員</p>
      <p className="text-xs font-bold text-neutral-500">{balls} 球</p>
      <p className="text-[11px] text-neutral-400">
        {player.throws === "L" ? "左投" : "右投"} · {player.heightCm}cm / {player.weightKg}kg
      </p>
      {editable && (
        <div className="mt-auto flex w-full gap-2">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="flex-1 bg-black py-2 text-xs font-bold text-white"
          >
            編輯
          </button>
          <button
            type="button"
            onClick={() => setMode("confirmDelete")}
            aria-label={`刪除 ${player.name}`}
            className="bg-neutral-200 px-3 py-2 text-xs font-bold text-neutral-700 hover:bg-[var(--color-metric-low)] hover:text-white"
          >
            刪除
          </button>
        </div>
      )}
    </div>
  );
}

function AddPlayerTile({ onAdd }: { onAdd: (input: NewPlayer) => void }) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <PlayerForm
        title="新增選手"
        initial={{ name: "", throws: "R", heightCm: 175, weightKg: 75 }}
        submitLabel="新增"
        onCancel={() => setOpen(false)}
        onSubmit={(values) => {
          onAdd({
            name: values.name ?? "",
            throws: values.throws ?? "R",
            heightCm: values.heightCm ?? 0,
            weightKg: values.weightKg ?? 0,
            avatarUrl: null,
            birthDate: "",
          });
          setOpen(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex h-full min-h-[190px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-400 text-neutral-500 hover:border-black hover:text-black"
    >
      <span className="text-3xl leading-none">＋</span>
      <span className="text-xs font-bold">新增選手</span>
    </button>
  );
}

/** Shared editor for both add and edit; returns only the fields it manages. */
function PlayerForm({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: Pick<Player, "name" | "throws" | "heightCm" | "weightKg">;
  submitLabel: string;
  onSubmit: (values: PlayerPatch) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [throws, setThrows] = useState<Player["throws"]>(initial.throws);
  const [heightCm, setHeightCm] = useState(String(initial.heightCm || ""));
  const [weightKg, setWeightKg] = useState(String(initial.weightKg || ""));

  return (
    <form
      className="flex h-full flex-col gap-2 rounded-lg bg-white p-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({
          name: name.trim(),
          throws,
          heightCm: Number(heightCm) || 0,
          weightKg: Number(weightKg) || 0,
        });
      }}
    >
      <p className="text-xs font-bold text-neutral-500">{title}</p>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold">姓名</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="w-full bg-neutral-100 px-2 py-1.5 text-sm outline-none"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-[11px] font-bold">慣用手</span>
        <select
          value={throws}
          onChange={(e) => setThrows(e.target.value as Player["throws"])}
          className="w-full bg-neutral-100 px-2 py-1.5 text-sm outline-none"
        >
          <option value="R">右投</option>
          <option value="L">左投</option>
        </select>
      </label>

      <div className="flex gap-2">
        <label className="block flex-1">
          <span className="mb-1 block text-[11px] font-bold">身高</span>
          <input
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            className="w-full bg-neutral-100 px-2 py-1.5 text-sm outline-none"
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-[11px] font-bold">體重</span>
          <input
            type="number"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            className="w-full bg-neutral-100 px-2 py-1.5 text-sm outline-none"
          />
        </label>
      </div>

      <div className="mt-auto flex gap-2 pt-1">
        <button type="submit" className="flex-1 bg-black py-2 text-xs font-bold text-white">
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 bg-neutral-200 py-2 text-xs font-bold text-neutral-700"
        >
          取消
        </button>
      </div>
    </form>
  );
}
