import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSession } from "@/app/SessionContext";
import { usePlayers } from "@/app/PlayersStore";
import { AvatarUpload } from "@/components/common";
import type { Role } from "@/api/types";

/** What 註冊 hands to 完成註冊 so the read-back matches what was typed. */
type RegisterResult =
  | { role: "player"; name: string; username: string; email: string; height: string; weight: string; throws: string }
  | { role: "coach"; name: string; username: string; email: string; team: string; roster: string[] };

/** "陳OO,王OO ,,李OO" → ["陳OO", "王OO", "李OO"], commas either width. */
function parseRoster(raw: string): string[] {
  const names = raw
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

/* 帳號系統 — 登入 / 註冊 / 完成註冊 */

/**
 * Login is a two-panel split: a full-bleed pitching photo on the left with the
 * product name reversed out of it, and the form on a yellow field to the right.
 * On narrow screens the photo becomes a short banner above the form.
 */
export function LoginPage() {
  const nav = useNavigate();
  const { login } = useSession();
  const [error, setError] = useState("");

  return (
    <div className="grid h-screen grid-rows-[200px_1fr] bg-black md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:grid-rows-1">
      <div className="relative overflow-hidden">
        <img
          src="/media/Rectangle 24.png"
          alt=""
          className="size-full object-cover"
          onError={(e) => (e.currentTarget.style.visibility = "hidden")}
        />
        <div className="absolute inset-0 bg-neutral-500/45" />
        <p className="absolute bottom-10 left-8 text-4xl leading-[1.1] font-bold text-white md:bottom-1/3 md:text-6xl">
          XPORTS
          <br />
          Pitch AI
        </p>
      </div>

      <div className="flex items-center justify-center bg-[var(--color-brand)] px-8 py-12 md:px-14">
        <form
          className="w-full max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const ok = login(String(fd.get("id") ?? ""), String(fd.get("password") ?? ""));
            if (ok) nav("/");
            else setError("帳號／信箱或密碼錯誤");
          }}
        >
          <h1 className="text-3xl font-bold">登入</h1>
          <p className="mt-1 text-sm">選手與教練登入</p>

          <BrandField label="帳號或信箱" type="text" name="id" autoComplete="username" />
          <BrandField label="密碼" type="password" name="password" autoComplete="current-password" />

          {error && <p className="mt-3 text-sm font-bold text-[var(--color-metric-low)]">{error}</p>}

          <button type="submit" className="mt-8 w-full bg-black py-3.5 text-sm font-bold text-white">
            登入
          </button>

          <p className="mt-4 text-center text-sm font-bold">
            還沒有帳號?{" "}
            <Link to="/register" className="underline">
              註冊
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

/** 註冊 — 資料註冊. Player and coach collect different fields. */
export function RegisterPage() {
  const nav = useNavigate();
  const { addPlayer } = usePlayers();
  const { register } = useSession();
  const [role, setRole] = useState<Role>("player");
  const [roster, setRoster] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [error, setError] = useState("");

  const rosterNames = parseRoster(roster);

  return (
    <FormFrame title="註冊" subtitle="資料註冊">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const str = (k: string) => String(fd.get(k) ?? "").trim();

          if (str("password") !== str("passwordConfirm")) {
            setError("兩次輸入的密碼不一致");
            return;
          }

          let result: RegisterResult;
          let selfPlayer: { name: string; throws: "L" | "R"; heightCm: number; weightKg: number } | null =
            null;
          if (role === "coach") {
            result = {
              role,
              name: str("name"),
              username: str("username"),
              email: str("email"),
              team: str("team"),
              roster: rosterNames,
            };
          } else {
            selfPlayer = {
              name: str("name"),
              throws: (str("throws") || "R") as "L" | "R",
              heightCm: Number(str("height")) || 0,
              weightKg: Number(str("weight")) || 0,
            };
            result = {
              role,
              name: str("name"),
              username: str("username"),
              email: str("email"),
              height: str("height"),
              weight: str("weight"),
              throws: str("throws"),
            };
          }

          const outcome = register({
            username: str("username"),
            password: str("password"),
            email: str("email"),
            name: str("name"),
            role,
            avatarUrl: avatar,
          });
          if (!outcome.ok) {
            setError(outcome.error);
            return;
          }

          // Roster writes happen only once the account is created. Both the
          // player registering themselves and each name a coach lists become
          // editable rows in 基本設定.
          if (selfPlayer) {
            addPlayer({ ...selfPlayer, avatarUrl: avatar, birthDate: "" });
          }
          for (const name of rosterNames) {
            addPlayer({ name, throws: "R", heightCm: 0, weightKg: 0, avatarUrl: null, birthDate: "" });
          }
          nav("/register/complete", { state: result });
        }}
      >
        <div className="mb-6 flex flex-col items-center gap-2">
          <AvatarUpload url={avatar} size="size-24" onPick={setAvatar} />
          <span className="text-xs text-neutral-500">
            頭像（可裁切）
            {avatar && (
              <button type="button" onClick={() => setAvatar(null)} className="ml-2 underline">
                移除
              </button>
            )}
          </span>
        </div>

        <fieldset className="mb-6">
          <legend className="mb-2 text-sm font-bold">身分</legend>
          <div className="flex gap-3">
            {(["player", "coach"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                className={`flex-1 py-3 text-sm font-bold ${
                  role === r ? "bg-black text-white" : "bg-white text-neutral-700"
                }`}
              >
                {r === "player" ? "選手" : "教練"}
              </button>
            ))}
          </div>
        </fieldset>

        <PlainField label="姓名" name="name" />
        <PlainField label="信箱" type="email" name="email" autoComplete="email" />
        <PlainField label="帳號" name="username" autoComplete="username" />
        <PlainField label="密碼" type="password" name="password" autoComplete="new-password" />
        <PlainField label="密碼確認" type="password" name="passwordConfirm" autoComplete="new-password" />

        {role === "player" ? (
          <>
            <PlainField label="身高" type="number" name="height" suffix="cm" />
            <PlainField label="體重" type="number" name="weight" suffix="kg" />
            <fieldset className="mt-5">
              <legend className="mb-2 text-sm font-bold">左/右投</legend>
              <div className="flex gap-3">
                {[
                  { v: "L", label: "左投" },
                  { v: "R", label: "右投" },
                ].map((o) => (
                  <label key={o.v} className="flex flex-1 items-center gap-2 bg-white px-4 py-3 text-sm">
                    <input type="radio" name="throws" value={o.v} defaultChecked={o.v === "R"} />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <>
            <PlainField label="隊伍名稱" name="team" />

            <label className="mt-5 block">
              <span className="mb-2 block text-sm font-bold">球員名單</span>
              <textarea
                name="roster"
                value={roster}
                onChange={(e) => setRoster(e.target.value)}
                rows={3}
                placeholder="以逗號分隔，例如：陳OO,王OO"
                className="w-full resize-none bg-white px-4 py-3 text-sm outline-none"
              />
              <span className="mt-1 block text-xs text-neutral-500">
                {rosterNames.length > 0
                  ? `將新增 ${rosterNames.length} 位球員：${rosterNames.join("、")}。註冊後可到基本設定編輯個人資料。`
                  : "先建立姓名即可，其餘資料註冊後在基本設定補齊。"}
              </span>
            </label>
          </>
        )}

        {error && <p className="mt-5 text-sm font-bold text-[var(--color-metric-low)]">{error}</p>}

        <button type="submit" className="mt-8 w-full bg-black py-3.5 text-sm font-bold text-white">
          註冊
        </button>
      </form>
    </FormFrame>
  );
}

/** 完成註冊 — read-back of what the coach or player just entered. */
export function RegisterCompletePage() {
  const nav = useNavigate();
  const result = useLocation().state as RegisterResult | null;

  const dash = (s: string) => s || "—";
  const rows: Array<[string, string]> =
    result?.role === "coach"
      ? [
          ["姓名", dash(result.name)],
          ["帳號", dash(result.username)],
          ["信箱", dash(result.email)],
          ["隊伍名稱", dash(result.team)],
          ["球員名單", result.roster.length ? result.roster.join("、") : "尚未新增"],
        ]
      : result?.role === "player"
        ? [
            ["姓名", dash(result.name)],
            ["帳號", dash(result.username)],
            ["信箱", dash(result.email)],
            ["身高", dash(result.height)],
            ["體重", dash(result.weight)],
            ["慣用手", result.throws === "L" ? "左投" : "右投"],
          ]
        : [
            ["姓名", "XXX"],
            ["信箱", "XXX@gmail.com"],
          ];

  const idLabel = result?.role === "coach" ? "教練 ID" : "ID";

  return (
    <div className="min-h-full bg-[#ededed]">
      <div className="h-10 bg-black" />
      <div className="mx-auto grid max-w-3xl gap-10 px-8 py-20 md:grid-cols-[1fr_auto]">
        <div>
          <h1 className="text-3xl font-bold">完成註冊</h1>
          <p className="mt-2 text-sm text-neutral-600">{idLabel}：XXXXX12345</p>

          <dl className="mt-12 flex flex-col gap-6">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-sm font-bold">
                <dt>{k}：</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <button
            type="button"
            onClick={() => nav("/login")}
            className="mt-12 w-full bg-black py-3.5 text-sm font-bold text-white"
          >
            確認
          </button>
        </div>

        <div className="grid size-44 place-items-center justify-self-center rounded-full bg-white md:justify-self-end">
          <svg viewBox="0 0 24 24" className="size-28 fill-neutral-400">
            <path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-5 0-8 2.5-8 5v3h16v-3c0-2.5-3-5-8-5z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function FormFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full bg-[#ededed]">
      <div className="h-10 bg-black" />
      <div className="mx-auto max-w-md px-8 py-16">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 mb-8 text-sm text-neutral-600">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function BrandField({
  label,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mt-6 block">
      <span className="mb-2 block text-sm font-bold">{label}</span>
      <input {...rest} className="w-full bg-white px-4 py-3 text-sm outline-none" />
    </label>
  );
}

function PlainField({
  label,
  suffix,
  ...rest
}: { label: string; suffix?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mt-5 block">
      <span className="mb-2 block text-sm font-bold">{label}</span>
      <span className="flex items-center bg-white">
        <input {...rest} className="w-full bg-transparent px-4 py-3 text-sm outline-none" />
        {suffix && <span className="pr-4 text-xs text-neutral-500">{suffix}</span>}
      </span>
    </label>
  );
}
