import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Role, User } from "@/api/types";

/**
 * Stands in for a real auth service. Accounts are held here and persisted to
 * localStorage; there is no server, so passwords are stored in the clear — fine
 * for the prototype, replace with a real `/auth` endpoint before shipping.
 *
 * Login accepts either the username or the email, matched case-insensitively.
 */

export interface Account {
  id: string;
  username: string;
  email: string;
  password: string;
  role: Role;
  name: string;
  teamId: string;
  playerId: string | null;
  avatarUrl: string | null;
}

/** Demo logins that always work: coach/coach1234, player/player1234. */
const SEED_ACCOUNTS: Account[] = [
  {
    id: "u_coach",
    username: "coach",
    email: "coach@example.com",
    password: "coach1234",
    role: "coach",
    name: "張教練",
    teamId: "team_ntsu",
    playerId: null,
    avatarUrl: null,
  },
  {
    id: "u_player",
    username: "player",
    email: "chen@example.com",
    password: "player1234",
    role: "player",
    name: "陳OO",
    teamId: "team_ntsu",
    playerId: "p_chen",
    avatarUrl: null,
  },
];

const ACCOUNTS_KEY = "pitchai.accounts";
const TEAM_NAME_KEY = "pitchai.teamName";

function readTeamName(): string {
  try {
    return localStorage.getItem(TEAM_NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function readAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    const added = raw ? (JSON.parse(raw) as Account[]) : [];
    return [...SEED_ACCOUNTS, ...added];
  } catch {
    return SEED_ACCOUNTS;
  }
}

function writeAddedAccounts(all: Account[]) {
  const seedIds = new Set(SEED_ACCOUNTS.map((a) => a.id));
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(all.filter((a) => !seedIds.has(a.id))));
  } catch {
    /* private mode / quota — accounts still work for this session */
  }
}

function toUser(a: Account): User {
  return {
    id: a.id,
    role: a.role,
    name: a.name,
    email: a.email,
    playerId: a.playerId,
    teamId: a.teamId,
    avatarUrl: a.avatarUrl,
  };
}

export interface NewAccount {
  username: string;
  password: string;
  email: string;
  role: Role;
  name: string;
  playerId?: string | null;
  avatarUrl?: string | null;
}

type RegisterResult = { ok: true; account: Account } | { ok: false; error: string };

interface Ctx {
  role: Role;
  user: User;
  setRole: (r: Role) => void;
  /** Whether a session is active. The signed-in shell is gated on this. */
  authed: boolean;
  /** Match by username or email (case-insensitive) + password. */
  login: (idOrEmail: string, password: string) => boolean;
  register: (input: NewAccount) => RegisterResult;
  logout: () => void;
  /** Replace the signed-in account's photo (data URL, or null to clear). */
  setAvatar: (url: string | null) => void;
  /** Edit 姓名 / 信箱 of the signed-in account. */
  updateProfile: (patch: { name?: string; email?: string }) => { ok: true } | { ok: false; error: string };
  /** Change the signed-in account's password (checks the current one). */
  changePassword: (current: string, next: string) => { ok: true } | { ok: false; error: string };
  /** Team-name override — "" means fall back to the fixture team name. */
  teamName: string;
  setTeamName: (name: string) => void;
}

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>(readAccounts);
  const [current, setCurrent] = useState<Account | null>(null);
  const [teamName, setTeamNameState] = useState<string>(readTeamName);
  /** Dev-only role override, used by the sidebar switcher when signed in. */
  const [roleOverride, setRoleOverride] = useState<Role | null>(null);

  const value = useMemo<Ctx>(() => {
    const overrideAccount = roleOverride
      ? SEED_ACCOUNTS.find((a) => a.role === roleOverride) ?? SEED_ACCOUNTS[0]
      : null;
    const shown = overrideAccount ?? current ?? SEED_ACCOUNTS[0];

    /** Persist a changed copy of the signed-in account. */
    const commit = (updated: Account | null | undefined | false) => {
      if (!updated || !current) return;
      const next = accounts.map((a) => (a.id === current.id ? updated : a));
      setAccounts(next);
      setCurrent(updated);
      writeAddedAccounts(next);
    };

    return {
      role: shown.role,
      user: toUser(shown),
      setRole: (r) => setRoleOverride(r),
      authed: current !== null,

      login: (idOrEmail, password) => {
        const key = idOrEmail.trim().toLowerCase();
        const match = accounts.find(
          (a) =>
            (a.username.toLowerCase() === key || a.email.toLowerCase() === key) &&
            a.password === password,
        );
        if (!match) return false;
        setCurrent(match);
        setRoleOverride(null);
        return true;
      },

      register: (input) => {
        const username = input.username.trim();
        const email = input.email.trim();
        if (!username || !input.password || !email) {
          return { ok: false, error: "帳號、密碼、信箱皆為必填" };
        }
        const taken = accounts.some(
          (a) =>
            a.username.toLowerCase() === username.toLowerCase() ||
            a.email.toLowerCase() === email.toLowerCase(),
        );
        if (taken) return { ok: false, error: "帳號或信箱已被使用" };

        const account: Account = {
          id: `u_local_${Date.now().toString(36)}`,
          username,
          email,
          password: input.password,
          role: input.role,
          name: input.name.trim() || username,
          teamId: "team_ntsu",
          playerId: input.playerId ?? null,
          avatarUrl: input.avatarUrl ?? null,
        };
        const next = [...accounts, account];
        setAccounts(next);
        writeAddedAccounts(next);
        return { ok: true, account };
      },

      logout: () => {
        setCurrent(null);
        setRoleOverride(null);
      },

      setAvatar: (url) => commit(current && { ...current, avatarUrl: url }),

      updateProfile: (patch) => {
        if (!current) return { ok: false, error: "尚未登入" };
        const name = patch.name?.trim();
        const email = patch.email?.trim();
        if (patch.name !== undefined && !name) return { ok: false, error: "姓名不可空白" };
        if (patch.email !== undefined && !email) return { ok: false, error: "信箱不可空白" };
        if (
          email &&
          accounts.some((a) => a.id !== current.id && a.email.toLowerCase() === email.toLowerCase())
        ) {
          return { ok: false, error: "信箱已被其他帳號使用" };
        }
        commit({ ...current, name: name ?? current.name, email: email ?? current.email });
        return { ok: true };
      },

      changePassword: (cur, nextPw) => {
        if (!current) return { ok: false, error: "尚未登入" };
        if (current.password !== cur) return { ok: false, error: "目前密碼不正確" };
        if (!nextPw) return { ok: false, error: "新密碼不可空白" };
        commit({ ...current, password: nextPw });
        return { ok: true };
      },

      teamName,
      setTeamName: (n) => {
        const v = n.trim();
        setTeamNameState(v);
        try {
          localStorage.setItem(TEAM_NAME_KEY, v);
        } catch {
          /* ignore */
        }
      },
    };
  }, [accounts, current, roleOverride, teamName]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside a SessionProvider");
  return ctx;
}
