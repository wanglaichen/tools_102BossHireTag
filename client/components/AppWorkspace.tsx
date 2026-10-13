"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LogOut, RefreshCw, Settings, Shield } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { AdminModal } from "@/components/AdminModal";
import { HirePanel } from "@/components/panels/HirePanel";
import { NamedListPanel } from "@/components/panels/NamedListPanel";
import { JobUpdatesPanel } from "@/components/panels/JobUpdatesPanel";
import { getChannels, getProxy, getVersion, syncCompanyFullNames } from "@/lib/api";
import { authJson } from "@/lib/auth";
import type { Channel, FeatureId } from "@/lib/types";

type SyncProgress = {
  active: boolean;
  label: string;
  total: number;
  done: number;
  updated: number;
  step: number;
  steps: number;
};

const FEATURES: {
  id: FeatureId;
  title: string;
  desc: string;
  channelSubrail: boolean;
}[] = [
  { id: "hire", title: "投递登记", desc: "投过简历正在进度中的企业", channelSubrail: true },
  { id: "ignored", title: "忽略企业", desc: "进行中失败的企业", channelSubrail: true },
  { id: "blocklist", title: "黑名单企业", desc: "永不联系的企业", channelSubrail: false },
  { id: "watchlist", title: "持续关注", desc: "持续关注中的企业", channelSubrail: false },
  { id: "jobUpdates", title: "更新平台职位", desc: "招聘平台岗位采集", channelSubrail: true },
];

export function AppWorkspace() {
  const { user, logout } = useAuth();
  const [feature, setFeature] = useState<FeatureId>("hire");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channel, setChannel] = useState("boss");
  const [version, setVersion] = useState("");
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [channelTick, setChannelTick] = useState(0);
  const [listTick, setListTick] = useState(0);
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({
    active: false,
    label: "",
    total: 0,
    done: 0,
    updated: 0,
    step: 0,
    steps: 6,
  });

  const loadChannels = useCallback(async () => {
    const items = await getChannels();
    setChannels(items);
    if (items.length && !items.some((c) => c.id === channel)) {
      setChannel(items[0].id);
    }
    setChannelTick((n) => n + 1);
  }, [channel]);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
    getProxy()
      .then((data) => {
        const url = String((data as { proxy_url?: string }).proxy_url || data.url || "");
        setProxyUrl(url);
        setProxyEnabled(Boolean(url) || Boolean(data.enabled));
      })
      .catch(() => undefined);
    loadChannels().catch((err) => toast.error(err instanceof Error ? err.message : "加载渠道失败"));
  }, [loadChannels]);

  const activeFeature = useMemo(
    () => FEATURES.find((f) => f.id === feature) || FEATURES[0],
    [feature],
  );

  async function saveProxy(enabled: boolean, url: string) {
    try {
      await authJson("/api/proxy", {
        method: "POST",
        body: JSON.stringify({ proxy_url: enabled ? url.trim() : "" }),
      });
      toast.success(enabled ? "代理已保存（重启后生效）" : "代理已清除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "代理设置失败");
    }
  }

  async function runFullNameSync() {
    if (syncProgress.active) return;
    if (
      !confirm(
        "将按顺序同步企业全称：\n忽略→投递 → 投递→忽略 → 忽略→黑名单 → 黑名单→忽略 → 忽略→关注 → 关注→忽略\n\n仅写入目标侧为空的全称；源侧为空不同步。确定开始？",
      )
    ) {
      return;
    }
    setSyncProgress({
      active: true,
      label: "准备同步…",
      total: 0,
      done: 0,
      updated: 0,
      step: 0,
      steps: 6,
    });
    try {
      const last = await syncCompanyFullNames((event) => {
        setSyncProgress((prev) => ({
          active: true,
          label: event.message || event.label || prev.label,
          total: event.total ?? prev.total,
          done: event.totalDone ?? prev.done,
          updated: event.updated ?? prev.updated,
          step: event.step ?? prev.step,
          steps: typeof event.steps === "number" ? event.steps : prev.steps,
        }));
      });
      toast.success(last.message || `企业全称同步完成：写入 ${last.updated || 0} 条`);
      setListTick((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "企业全称同步失败");
    } finally {
      setSyncProgress((prev) => ({ ...prev, active: false }));
    }
  }

  const syncPercent =
    syncProgress.total > 0 ? Math.min(100, Math.round((syncProgress.done / syncProgress.total) * 100)) : 0;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">企业投递与风控台</div>
        {version ? <span className="topbar-version">v{version}</span> : null}
        <span className="vr" style={{ width: 1, height: 18, background: "var(--border)" }} />
        <label className="check-inline">
          <input
            type="checkbox"
            checked={proxyEnabled}
            onChange={async (e) => {
              const on = e.target.checked;
              setProxyEnabled(on);
              if (!on) {
                setProxyUrl("");
                await saveProxy(false, "");
              }
            }}
          />
          代理
        </label>
        {proxyEnabled ? (
          <>
            <input
              className="input"
              style={{ width: 220 }}
              placeholder="http://127.0.0.1:7890"
              value={proxyUrl}
              onChange={(e) => setProxyUrl(e.target.value)}
            />
            <button className="btn btn-sm btn-primary" type="button" onClick={() => saveProxy(true, proxyUrl)}>
              设置
            </button>
          </>
        ) : null}
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-sm"
          type="button"
          disabled={syncProgress.active}
          onClick={() => void runFullNameSync()}
          title="跨名单补全企业全称（空值不同步）"
        >
          <RefreshCw size={14} className={syncProgress.active ? "spin" : undefined} />
          企业全称同步
        </button>
        <span className="muted">
          {user?.displayName || user?.username}
          （{user?.role === "admin" ? "管理员" : "账号"}）
        </span>
        <button className="btn btn-sm" type="button" onClick={() => setSettingsOpen(true)}>
          <Settings size={14} />
          账号设置
        </button>
        {user?.role === "admin" ? (
          <button className="btn btn-sm" type="button" onClick={() => setAdminOpen(true)}>
            <Shield size={14} />
            管理中心
          </button>
        ) : null}
        <button className="btn btn-sm" type="button" onClick={() => logout()}>
          <LogOut size={14} />
          退出
        </button>
      </header>
      {syncProgress.active ? (
        <div className="sync-progress-bar is-active" role="status" aria-live="polite">
          <div className="sync-progress-meta">
            <span>
              {syncProgress.step > 0 ? `步骤 ${syncProgress.step}/${syncProgress.steps}` : "同步"}
              {syncProgress.label ? ` · ${syncProgress.label}` : ""}
            </span>
            <span>
              {syncProgress.done}/{syncProgress.total || "—"}（已写入 {syncProgress.updated}）
              {syncProgress.total > 0 ? ` · ${syncPercent}%` : ""}
            </span>
          </div>
          <div className="sync-progress-track">
            <div className="sync-progress-fill" style={{ width: `${syncPercent}%` }} />
          </div>
        </div>
      ) : null}

      <div className="app-body">
        <nav className="feature-rail" aria-label="功能页签">
          {FEATURES.map((f) => {
            const open = feature === f.id;
            return (
              <div key={f.id} className={`feature-group${open ? " is-open" : ""}`}>
                <button
                  type="button"
                  className={`feature-tab${open ? " active" : ""}`}
                  onClick={() => setFeature(f.id)}
                >
                  <strong>{f.title}</strong>
                  <span>{f.desc}</span>
                </button>
                {f.channelSubrail && open ? (
                  <div className="feature-subrail" role="tablist" aria-label="招聘渠道">
                    {channels.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`channel-chip${channel === c.id ? " active" : ""}`}
                        onClick={() => setChannel(c.id)}
                      >
                        {c.name || c.label || c.id}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="feature-stage">
          {feature === "hire" ? (
            <HirePanel
              channel={channel}
              channelLabel={channelLabel(channels, channel)}
              reloadKey={channelTick + listTick}
            />
          ) : null}
          {feature === "ignored" ? (
            <NamedListPanel
              kind="ignored"
              title="忽略企业"
              channel={channel}
              channelLabel={channelLabel(channels, channel)}
              channelRequired
              fullNameField
              reloadKey={channelTick + listTick}
            />
          ) : null}
          {feature === "blocklist" ? (
            <NamedListPanel
              kind="blocklist"
              title="黑名单企业"
              channel=""
              channelLabel="黑名单企业"
              channelRequired={false}
              fullNameField
              reloadKey={channelTick + listTick}
            />
          ) : null}
          {feature === "watchlist" ? (
            <NamedListPanel
              kind="watchlist"
              title="持续关注"
              channel=""
              channelLabel="持续关注"
              channelRequired={false}
              fullNameField
              reloadKey={channelTick + listTick}
            />
          ) : null}
          {feature === "jobUpdates" ? (
            <JobUpdatesPanel
              channel={channel}
              channelLabel={channelLabel(channels, channel)}
              reloadKey={channelTick}
            />
          ) : null}
        </div>
      </div>

      {adminOpen ? (
        <AdminModal
          onClose={() => setAdminOpen(false)}
          onChannelsChanged={() => {
            loadChannels().catch(() => undefined);
          }}
        />
      ) : null}

      {settingsOpen ? <AccountSettingsModal onClose={() => setSettingsOpen(false)} /> : null}

      <span className="sr-only">{activeFeature.title}</span>
    </div>
  );
}

function channelLabel(channels: Channel[], id: string) {
  const hit = channels.find((c) => c.id === id);
  return hit?.name || hit?.label || id;
}
