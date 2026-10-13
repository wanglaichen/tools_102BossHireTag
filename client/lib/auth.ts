import { apiUrl } from "./apiBase";
import type { AuthUser } from "./types";

const TOKEN_KEY = "boss_auth_token";
const USER_KEY = "boss_auth_user";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  sessionStorage.removeItem(TOKEN_KEY);
}

export function clearAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.message || data?.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(apiUrl("/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  setAuthSession(data.token, data.user);
  return data.user as AuthUser;
}

export async function register(
  username: string,
  password: string,
  displayName?: string,
): Promise<AuthUser> {
  const res = await fetch(apiUrl("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, displayName }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  setAuthSession(data.token, data.user);
  return data.user as AuthUser;
}

export async function logout(): Promise<void> {
  try {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    });
  } catch {
    /* ignore */
  }
  clearAuthSession();
}

/** 可选拉取最新用户信息；失败时保留本地会话，不自动登出 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getStoredToken();
  if (!token) return null;
  const cached = getStoredUser();
  try {
    const res = await fetch(apiUrl("/api/auth/me"), { headers: getAuthHeaders() });
    if (!res.ok) return cached;
    const data = await res.json();
    const user = data.user as AuthUser;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  } catch {
    return cached;
  }
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const token = getStoredToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // 不因单次 401 清会话/跳登录：避免探活或短暂网络问题把用户踢出；仅手动退出才清本地会话
  return fetch(apiUrl(path), { ...init, headers });
}

export async function authJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authFetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `HTTP ${res.status}`);
  }
  return data as T;
}
