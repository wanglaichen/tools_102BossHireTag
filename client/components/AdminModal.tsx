"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Eye, EyeOff, X } from "lucide-react";
import { toast } from "sonner";
import {
  adminSummary,
  createUser,
  deleteChannel,
  deleteUser,
  exportUserBundle,
  importUserBundle,
  listUsers,
  updateRegistrationPolicy,
  updateUser,
} from "@/lib/api";
import { authJson } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import type { AuthUser, Channel, RegistrationPolicy, TrialStatus } from "@/lib/types";

type Props = {
  onClose: () => void;
  onChannelsChanged?: () => void;
};

type AdminUserRow = AuthUser & {
  company_count?: number;
  ignored_count?: number;
  blacklist_count?: number;
  by_channel?: Record<string, number>;
};

type AdminSummary = {
  totals?: {
    user_count?: number;
    company_count?: number;
    channel_count?: number;
    by_channel?: Record<string, number>;
  };
  users?: AdminUserRow[];
  channels?: Channel[];
};

function formatExpireAt(iso?: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

function TrialBadge({ user }: { user: AdminUserRow }) {
  if (user.locked) {
    return <span className="muted" style={{ marginLeft: 6 }}>已锁定</span>;
  }
  const status = (user.trialStatus || "permanent") as TrialStatus;
  if (user.role === "admin" || status === "permanent" || !user.trialExpiresAt) {
    return <span className="muted" style={{ marginLeft: 6 }}>永久</span>;
  }
  if (status === "expired") {
    return <span className="err" style={{ marginLeft: 6 }}>试用已到期</span>;
  }
  return (
    <span className="muted" style={{ marginLeft: 6 }} title={formatExpireAt(user.trialExpiresAt)}>
      试用中
    </span>
  );
}

export function AdminModal({ onClose, onChannelsChanged }: Props) {
  const { user: me } = useAuth();
  const [tab, setTab] = useState<"summary" | "channels" | "accounts">("summary");
  const [data, setData] = useState<AdminSummary>({});
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [policy, setPolicy] = useState<RegistrationPolicy>({ trialHours: 72, defaultTrialHours: 72 });
  const [trialHoursInput, setTrialHoursInput] = useState("72");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelId, setChannelId] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "user" as "admin" | "user",
  });
  const [resetTarget, setResetTarget] = useState<AdminUserRow | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [actionId, setActionId] = useState("");
  const importTargetRef = useRef<AdminUserRow | null>(null);
  const importOverwriteRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  async function loadSummary() {
    const next = (await adminSummary()) as AdminSummary;
    setData(next);
  }

  async function loadAccounts() {
    const { users: list, registrationPolicy } = await listUsers();
    setUsers(list as AdminUserRow[]);
    setPolicy(registrationPolicy);
    setTrialHoursInput(String(registrationPolicy.trialHours));
  }

  useEffect(() => {
    setError("");
    (async () => {
      try {
        if (tab === "accounts") await loadAccounts();
        else await loadSummary();
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载失败");
      }
    })();
  }, [tab]);

  async function onSavePolicy(e: FormEvent) {
    e.preventDefault();
    setError("");
    const hours = Number(trialHoursInput);
    if (!Number.isFinite(hours) || hours < 0 || !Number.isInteger(hours)) {
      setError("试用时长须为 ≥ 0 的整数小时");
      return;
    }
    setSavingPolicy(true);
    try {
      const next = await updateRegistrationPolicy(hours);
      const trialHours = Number(next.trialHours ?? hours);
      setPolicy({
        trialHours,
        defaultTrialHours: Number(next.defaultTrialHours ?? policy.defaultTrialHours),
      });
      setTrialHoursInput(String(trialHours));
      toast.success(
        trialHours === 0
          ? "已更新：自助注册直接永久"
          : `已更新：自助注册试用 ${trialHours} 小时`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败";
      setError(msg);
      toast.error(msg);
    } finally {
      setSavingPolicy(false);
    }
  }

  async function onCreateUser(e: FormEvent) {
    e.preventDefault();
    setError("");
    const username = createForm.username.trim();
    const password = createForm.password;
    if (!username) {
      setError("请填写用户名");
      return;
    }
    if (password.length < 2) {
      setError("密码至少 2 个字符");
      return;
    }
    setCreating(true);
    try {
      await createUser({
        username,
        password,
        displayName: createForm.displayName.trim() || undefined,
        role: createForm.role,
      });
      toast.success("账号已创建（无试用期）");
      setCreateForm({ username: "", password: "", displayName: "", role: "user" });
      setShowCreatePassword(false);
      await loadAccounts();
      await loadSummary();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "创建失败";
      setError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }

  async function onConfirmReset() {
    if (!resetTarget?.id) return;
    setError("");
    if (resetPassword.length < 2) {
      setError("密码至少 2 个字符");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setResetting(true);
    try {
      await updateUser(resetTarget.id, { password: resetPassword });
      toast.success(`已重置「${resetTarget.username}」的密码`);
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
      setShowResetPassword(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "重置失败";
      setError(msg);
      toast.error(msg);
    } finally {
      setResetting(false);
    }
  }

  async function onDeleteAccount(u: AdminUserRow) {
    if (!u.id) return;
    if (u.id === me?.id) {
      toast.error("不能删除当前登录账号");
      return;
    }
    if (!confirm(`确定删除账号「${u.username}」？其登记数据将一并清理。`)) return;
    try {
      await deleteUser(u.id);
      toast.success("账号已删除");
      await loadAccounts();
      await loadSummary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function onToggleRole(u: AdminUserRow) {
    if (!u.id) return;
    if (u.id === me?.id) {
      toast.error("不能修改当前登录账号角色");
      return;
    }
    const next = u.role === "admin" ? "user" : "admin";
    if (!confirm(`将「${u.username}」设为${next === "admin" ? "管理员" : "普通账号"}？`)) return;
    try {
      await updateUser(u.id, { role: next });
      toast.success("角色已更新");
      await loadAccounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    }
  }

  async function onMakePermanent(u: AdminUserRow) {
    if (!u.id) return;
    if (!confirm(`解除「${u.username}」的试用限制，变为永久账号？`)) return;
    setActionId(u.id);
    try {
      await updateUser(u.id, { permanent: true });
      toast.success("已解除试用，账号永久可用");
      await loadAccounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setActionId("");
    }
  }

  async function onSetLocked(u: AdminUserRow, locked: boolean) {
    if (!u.id) return;
    const tip = locked
      ? `锁定「${u.username}」？锁定后无法登录。`
      : `解锁「${u.username}」？`;
    if (!confirm(tip)) return;
    setActionId(u.id);
    try {
      await updateUser(u.id, { locked });
      toast.success(locked ? "账号已锁定" : "账号已解锁");
      await loadAccounts();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失败");
    } finally {
      setActionId("");
    }
  }

  async function onExportBundle(u: AdminUserRow) {
    if (!u.id) return;
    setActionId(u.id);
    try {
      await exportUserBundle(u.id, u.username || "account");
      toast.success(`已导出「${u.username}」全部数据`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setActionId("");
    }
  }

  function pickImportBundle(u: AdminUserRow, overwrite: boolean) {
    if (!u.id) return;
    if (overwrite) {
      const ok = confirm(
        `覆盖导入会用所选数据包替换「${u.username}」的登记/忽略/黑名单/关注/岗位更新，不可撤销。确定继续？`,
      );
      if (!ok) return;
    }
    importTargetRef.current = u;
    importOverwriteRef.current = overwrite;
    importFileRef.current?.click();
  }

  async function onImportFileSelected(file: File | null) {
    const target = importTargetRef.current;
    const overwrite = importOverwriteRef.current;
    importTargetRef.current = null;
    if (!file || !target?.id) return;
    setActionId(target.id);
    try {
      const text = await file.text();
      const result = await importUserBundle(target.id, text, overwrite);
      toast.success(result.message || (overwrite ? "覆盖导入完成" : "增量导入完成"));
      await loadSummary();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setActionId("");
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  async function onCreateChannel(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await authJson("/api/channels", {
        method: "POST",
        body: JSON.stringify({
          name: channelName.trim(),
          id: channelId.trim() || undefined,
        }),
      });
      setChannelName("");
      setChannelId("");
      toast.success("渠道已添加");
      await loadSummary();
      onChannelsChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "添加失败";
      setError(msg);
      toast.error(msg);
    }
  }

  async function onDeleteChannel(ch: Channel) {
    const residual = data.totals?.by_channel?.[ch.id] || 0;
    const tip = residual
      ? `移除渠道「${ch.name || ch.id}」？各账号共 ${residual} 条公司数据将保留为残留，不会删除。`
      : `移除渠道「${ch.name || ch.id}」？`;
    if (!confirm(tip)) return;
    try {
      await deleteChannel(ch.id);
      toast.success("渠道页签已移除");
      await loadSummary();
      onChannelsChanged?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "删除失败";
      setError(msg);
      toast.error(msg);
    }
  }

  const totals = data.totals || {};
  const channels = data.channels || [];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>管理中心</h2>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="workspace-tabs">
          <button
            type="button"
            className={`workspace-tab ${tab === "summary" ? "active" : ""}`}
            onClick={() => setTab("summary")}
          >
            汇总
          </button>
          <button
            type="button"
            className={`workspace-tab ${tab === "channels" ? "active" : ""}`}
            onClick={() => setTab("channels")}
          >
            招聘渠道
          </button>
          <button
            type="button"
            className={`workspace-tab ${tab === "accounts" ? "active" : ""}`}
            onClick={() => setTab("accounts")}
          >
            账号管理
          </button>
        </div>

        <div className="workspace-body">
        {error ? <div className="err" style={{ marginBottom: 8 }}>{error}</div> : null}

        {tab === "summary" ? (
          <>
            <div className="metrics metrics-compact">
              <article className="metric-card metric-total">
                <span className="metric-label">账号数</span>
                <strong className="metric-value">{totals.user_count ?? 0}</strong>
              </article>
              <article className="metric-card metric-hunter">
                <span className="metric-label">登记总数</span>
                <strong className="metric-value">{totals.company_count ?? 0}</strong>
              </article>
              <article className="metric-card metric-interviewed">
                <span className="metric-label">渠道数</span>
                <strong className="metric-value">{totals.channel_count ?? 0}</strong>
              </article>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>角色</th>
                    <th>登记数</th>
                    <th>忽略企业</th>
                    <th>各渠道</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.users || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-cell">
                        暂无数据
                      </td>
                    </tr>
                  ) : (
                    (data.users || []).map((u) => {
                      const by = u.by_channel || {};
                      const channelText = Object.keys(by).length
                        ? Object.entries(by)
                            .map(([k, v]) => `${k}:${v}`)
                            .join(" · ")
                        : "-";
                      return (
                        <tr key={u.username}>
                          <td>
                            {u.username}
                            {u.displayName ? `（${u.displayName}）` : ""}
                          </td>
                          <td>{u.role === "admin" ? "管理员" : "普通"}</td>
                          <td>{u.company_count ?? 0}</td>
                          <td>{u.ignored_count ?? u.blacklist_count ?? 0}</td>
                          <td>{channelText}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === "channels" ? (
          <>
            <form className="toolbar" onSubmit={onCreateChannel}>
              <input
                className="input"
                style={{ width: 160 }}
                placeholder="渠道显示名，如 智联"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                required
              />
              <input
                className="input"
                style={{ width: 140 }}
                placeholder="可选 ID，如 zhilian"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              />
              <button className="btn btn-primary" type="submit">
                添加渠道
              </button>
            </form>
            <p className="muted" style={{ marginTop: 0 }}>
              删除渠道只移除页签，不会删除各账号已有公司数据（残留数据保留，同 ID 重建后可再看见）。
            </p>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>名称</th>
                    <th>残留公司数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((ch) => (
                    <tr key={ch.id}>
                      <td>{ch.id}</td>
                      <td>{ch.name || ch.label || ch.id}</td>
                      <td>{totals.by_channel?.[ch.id] || 0}</td>
                      <td>
                        <button className="btn btn-sm btn-danger" type="button" onClick={() => onDeleteChannel(ch)}>
                          删除页签
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {tab === "accounts" ? (
          <>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                void onImportFileSelected(file);
              }}
            />
            <form className="form-card" onSubmit={onSavePolicy} style={{ marginBottom: 12 }}>
              <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <strong>自助注册试用时长</strong>
                <span className="muted">默认 {policy.defaultTrialHours} 小时</span>
              </div>
              <p className="muted" style={{ marginTop: 0 }}>
                仅影响登录页自助注册的新账号。管理员在此创建的账号为永久，无试用限制。填 0 表示自助注册也直接永久。
              </p>
              <div className="toolbar">
                <input
                  className="input"
                  style={{ width: 120 }}
                  type="number"
                  min={0}
                  step={1}
                  value={trialHoursInput}
                  onChange={(e) => setTrialHoursInput(e.target.value)}
                  required
                />
                <span className="muted">小时</span>
                <button className="btn btn-primary" type="submit" disabled={savingPolicy}>
                  {savingPolicy ? "保存中…" : "保存策略"}
                </button>
              </div>
            </form>

            <form className="form-card admin-create-user" onSubmit={onCreateUser}>
              <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <strong>创建用户</strong>
                <span className="muted">管理员创建 = 永久账号</span>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <label className="field">
                  <span>用户名</span>
                  <input
                    className="input"
                    required
                    autoComplete="off"
                    value={createForm.username}
                    onChange={(e) => setCreateForm((s) => ({ ...s, username: e.target.value }))}
                    placeholder="例如 user01"
                  />
                </label>
                <label className="field">
                  <span>显示名（可选）</span>
                  <input
                    className="input"
                    value={createForm.displayName}
                    onChange={(e) => setCreateForm((s) => ({ ...s, displayName: e.target.value }))}
                    placeholder="列表里显示的名字"
                  />
                </label>
                <label className="field">
                  <span>初始密码</span>
                  <div className="input-with-icon">
                    <input
                      className="input"
                      required
                      type={showCreatePassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm((s) => ({ ...s, password: e.target.value }))}
                      placeholder="至少 2 位"
                    />
                    <button
                      className="btn btn-sm btn-ghost input-icon-btn"
                      type="button"
                      onClick={() => setShowCreatePassword((v) => !v)}
                      aria-label={showCreatePassword ? "隐藏密码" : "显示密码"}
                    >
                      {showCreatePassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>角色</span>
                  <select
                    className="select"
                    value={createForm.role}
                    onChange={(e) =>
                      setCreateForm((s) => ({
                        ...s,
                        role: e.target.value === "admin" ? "admin" : "user",
                      }))
                    }
                  >
                    <option value="user">普通账号</option>
                    <option value="admin">管理员</option>
                  </select>
                </label>
              </div>
              <div className="toolbar" style={{ marginTop: 10 }}>
                <button className="btn btn-primary" type="submit" disabled={creating}>
                  {creating ? "创建中…" : "创建账号"}
                </button>
              </div>
            </form>

            {resetTarget ? (
              <div className="form-card" style={{ marginTop: 12 }}>
                <div className="toolbar" style={{ justifyContent: "space-between" }}>
                  <strong>重置密码 · {resetTarget.username}</strong>
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => {
                      setResetTarget(null);
                      setResetPassword("");
                      setResetConfirm("");
                    }}
                  >
                    取消
                  </button>
                </div>
                <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 8 }}>
                  <label className="field">
                    <span>新密码</span>
                    <div className="input-with-icon">
                      <input
                        className="input"
                        type={showResetPassword ? "text" : "password"}
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                      />
                      <button
                        className="btn btn-sm btn-ghost input-icon-btn"
                        type="button"
                        onClick={() => setShowResetPassword((v) => !v)}
                      >
                        {showResetPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </label>
                  <label className="field">
                    <span>确认密码</span>
                    <input
                      className="input"
                      type={showResetPassword ? "text" : "password"}
                      value={resetConfirm}
                      onChange={(e) => setResetConfirm(e.target.value)}
                    />
                  </label>
                </div>
                <div className="toolbar" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary" type="button" disabled={resetting} onClick={onConfirmReset}>
                    {resetting ? "提交中…" : "确认重置"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>状态</th>
                    <th>角色</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-cell">
                        暂无账号
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => {
                      const canMakePermanent =
                        u.role !== "admin"
                        && u.trialStatus !== "permanent"
                        && Boolean(u.trialExpiresAt);
                      const canManageLock = u.role !== "admin" && u.id !== me?.id;
                      const busy = actionId === u.id;
                      return (
                        <tr key={u.id || u.username}>
                          <td>
                            <div>{u.username}</div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {u.displayName || "-"}
                              {u.source === "self" ? " · 自助注册" : ""}
                              {u.source === "admin" && u.role !== "admin" ? " · 管理员创建" : ""}
                            </div>
                            {u.trialExpiresAt && u.trialStatus === "active" && !u.locked ? (
                              <div className="muted" style={{ fontSize: 12 }}>
                                到期：{formatExpireAt(u.trialExpiresAt)}
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <TrialBadge user={u} />
                          </td>
                          <td>{u.role === "admin" ? "管理员" : "普通账号"}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                className="btn btn-sm"
                                type="button"
                                disabled={busy}
                                onClick={() => onExportBundle(u)}
                                title="导出该账号全部业务数据（登记/忽略/黑名单/关注/岗位）"
                              >
                                {busy ? "…" : "导出全部"}
                              </button>
                              <button
                                className="btn btn-sm"
                                type="button"
                                disabled={busy}
                                onClick={() => pickImportBundle(u, false)}
                                title="增量合并导入到该账号"
                              >
                                增量导入
                              </button>
                              <button
                                className="btn btn-sm"
                                type="button"
                                disabled={busy}
                                onClick={() => pickImportBundle(u, true)}
                                title="用数据包覆盖该账号全部业务数据"
                              >
                                覆盖导入
                              </button>
                              {canMakePermanent ? (
                                <button
                                  className="btn btn-sm"
                                  type="button"
                                  disabled={busy}
                                  onClick={() => onMakePermanent(u)}
                                  title="解除试用限制，变为永久账号"
                                >
                                  {busy ? "…" : "解除试用"}
                                </button>
                              ) : null}
                              {canManageLock ? (
                                u.locked ? (
                                  <button
                                    className="btn btn-sm"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => onSetLocked(u, false)}
                                  >
                                    {busy ? "…" : "解锁"}
                                  </button>
                                ) : (
                                  <button
                                    className="btn btn-sm"
                                    type="button"
                                    disabled={busy}
                                    onClick={() => onSetLocked(u, true)}
                                  >
                                    {busy ? "…" : "锁定"}
                                  </button>
                                )
                              ) : null}
                              <button
                                className="btn btn-sm"
                                type="button"
                                onClick={() => {
                                  setResetTarget(u);
                                  setResetPassword("");
                                  setResetConfirm("");
                                  setError("");
                                }}
                              >
                                重置密码
                              </button>
                              <button className="btn btn-sm" type="button" onClick={() => onToggleRole(u)}>
                                {u.role === "admin" ? "降为普通" : "升为管理员"}
                              </button>
                              <button className="btn btn-sm btn-danger" type="button" onClick={() => onDeleteAccount(u)}>
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        </div>
      </div>
    </div>
  );
}
