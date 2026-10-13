"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AuthProvider, useAuth } from "@/components/AuthProvider";
import { fetchPublicRegistrationPolicy } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const { user, loading, login, register } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [trialHours, setTrialHours] = useState(72);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    fetchPublicRegistrationPolicy()
      .then((policy) => setTrialHours(policy.trialHours))
      .catch(() => setTrialHours(72));
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (tab === "login") {
        await login(username.trim(), password);
        toast.success("登录成功");
      } else {
        await register(username.trim(), password, displayName.trim() || undefined);
        toast.success("注册并登录成功");
      }
      router.replace("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "操作失败";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="login-page">
        <div className="muted">加载中…</div>
      </div>
    );
  }

  const registerTip =
    trialHours <= 0
      ? "创建新账号后自动登录。当前策略下自助注册即为永久账号。"
      : `创建新账号后自动登录。自助注册默认可试用 ${trialHours} 小时${
          trialHours % 24 === 0 ? `（${trialHours / 24} 天）` : ""
        }，到期后需管理员解锁。`;

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>企业投递与风控台</h1>
        <p className="login-tip">每个账号的公司记录互相独立。默认管理员来自服务器配置。</p>
        <div className="login-tabs">
          <button
            type="button"
            className={`workspace-tab ${tab === "login" ? "active" : ""}`}
            onClick={() => setTab("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={`workspace-tab ${tab === "register" ? "active" : ""}`}
            onClick={() => setTab("register")}
          >
            注册
          </button>
        </div>

        <label className="field">
          <span>用户名</span>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        {tab === "register" && (
          <label className="field">
            <span>显示名</span>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="nickname"
              placeholder="可选"
            />
          </label>
        )}

        <label className="field">
          <span>密码</span>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={tab === "login" ? "current-password" : "new-password"}
            required
          />
        </label>

        {tab === "register" ? <p className="muted" style={{ margin: "0 0 8px" }}>{registerTip}</p> : null}

        {error ? <div className="err" style={{ marginBottom: 8 }}>{error}</div> : null}

        <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy} type="submit">
          {busy ? "提交中…" : tab === "login" ? "登录" : "注册并登录"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthProvider>
      <LoginForm />
    </AuthProvider>
  );
}
