"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LogOut, Settings, Shield } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";
import { AccountSettingsModal } from "@/components/AccountSettingsModal";
import { AdminModal } from "@/components/AdminModal";
import { HirePanel } from "@/components/panels/HirePanel";
import { NamedListPanel } from "@/components/panels/NamedListPanel";
import { JobUpdatesPanel } from "@/components/panels/JobUpdatesPanel";
import { getChannels, getProxy, getVersion } from "@/lib/api";
import { authJson } from "@/lib/auth";
import type { Channel, FeatureId } from "@/lib/types";

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
            <HirePanel channel={channel} channelLabel={channelLabel(channels, channel)} reloadKey={channelTick} />
          ) : null}
          {feature === "ignored" ? (
            <NamedListPanel
              kind="ignored"
              title="忽略企业"
              channel={channel}
              channelLabel={channelLabel(channels, channel)}
              channelRequired
              fullNameField
              reloadKey={channelTick}
            />
          ) : null}
          {feature === "blocklist" ? (
            <NamedListPanel
              kind="blocklist"
              title="黑名单企业"
              channel=""
              channelLabel="黑名单企业"
              channelRequired={false}
              fullNameField={false}
              reloadKey={channelTick}
            />
          ) : null}
          {feature === "watchlist" ? (
            <NamedListPanel
              kind="watchlist"
              title="持续关注"
              channel=""
              channelLabel="持续关注"
              channelRequired={false}
              fullNameField={false}
              reloadKey={channelTick}
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
