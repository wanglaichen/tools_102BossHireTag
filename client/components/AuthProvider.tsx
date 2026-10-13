"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  fetchCurrentUser,
  getStoredUser,
  login as authLogin,
  logout as authLogout,
  register as authRegister,
} from "@/lib/auth";
import type { AuthUser } from "@/lib/types";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<AuthUser | null>;
  login: (username: string, password: string) => Promise<AuthUser>;
  register: (username: string, password: string, displayName?: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const cached = getStoredUser();
    const next = await fetchCurrentUser();
    // 探活失败时保留本地会话，不因 /me 失败踢出
    const resolved = next || cached;
    setUser(resolved);
    return resolved;
  }, []);

  useEffect(() => {
    // 启动只读本地会话，不做强制 /me 校验登出
    const cached = getStoredUser();
    setUser(cached);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user && pathname === "/") {
      router.replace("/login");
    }
  }, [loading, user, pathname, router]);

  const login = useCallback(async (username: string, password: string) => {
    const next = await authLogin(username, password);
    setUser(next);
    return next;
  }, []);

  const register = useCallback(
    async (username: string, password: string, displayName?: string) => {
      const next = await authRegister(username, password, displayName);
      setUser(next);
      return next;
    },
    [],
  );

  const logout = useCallback(async () => {
    await authLogout();
    setUser(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, refresh, login, register, logout }),
    [user, loading, refresh, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
