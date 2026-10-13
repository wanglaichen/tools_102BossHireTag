"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  clearNamed,
  createNamed,
  deleteNamed,
  downloadAuthed,
  listNamed,
  updateNamed,
} from "@/lib/api";
import { authJson } from "@/lib/auth";
import { useAuth } from "@/components/AuthProvider";
import { formatTime, qs } from "@/lib/format";
import type { NamedListItem, Summary } from "@/lib/types";

type ListKind = "ignored" | "blocklist" | "watchlist";

type Props = {
  kind: ListKind;
  title: string;
  channel: string;
  channelLabel: string;
  channelRequired: boolean;
  fullNameField?: boolean;
  reloadKey?: number;
};

const labels: Record<
  ListKind,
  { add: string; reason: string; empty: string; countKey: string; searchPh: string }
> = {
  ignored: {
    add: "加入忽略",
    reason: "忽略原因",
    empty: "暂无忽略企业记录",
    countKey: "ignored_count",
    searchPh: "搜索简称、全称或忽略原因",
  },
  blocklist: {
    add: "加入黑名单",
    reason: "拉黑原因",
    empty: "暂无黑名单记录",
    countKey: "blacklist_count",
    searchPh: "搜索简称、全称或拉黑原因",
  },
  watchlist: {
    add: "加入持续关注",
    reason: "关注备注",
    empty: "暂无持续关注记录",
    countKey: "watchlist_count",
    searchPh: "搜索简称、全称或关注备注",
  },
};

export function NamedListPanel({
  kind,
  title,
  channel,
  channelLabel,
  channelRequired,
  fullNameField = false,
  reloadKey = 0,
}: Props) {
  const { user } = useAuth();
  const meta = labels[kind];
  const [tab, setTab] = useState<"list" | "form">("list");
  const [items, setItems] = useState<NamedListItem[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyFullName, setCompanyFullName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listNamed(kind, channelRequired ? channel : "", q.trim());
      setItems(data.items);
      setSummary(data.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    }
  }, [kind, channel, channelRequired, q]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, reloadKey]);

  function resetForm() {
    setEditingId(null);
    setCompanyName("");
    setCompanyFullName("");
    setReason("");
  }

  function fillForm(item: NamedListItem) {
    setEditingId(item.id);
    setCompanyName(item.company_name || "");
    setCompanyFullName(item.company_full_name || "");
    setReason(item.reason || "");
    setTab("form");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        company_name: companyName.trim(),
        reason: reason.trim(),
      };
      if (fullNameField) payload.company_full_name = companyFullName.trim();
      if (channelRequired) payload.channel = channel;

      if (editingId) {
        await updateNamed(kind, editingId, payload);
        toast.success("已保存修改");
      } else {
        await createNamed(kind, payload);
        toast.success(meta.add + "成功");
      }
      resetForm();
      setTab("list");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(item: NamedListItem) {
    if (!confirm(`确定将「${item.company_name}」移出${title}吗？`)) return;
    try {
      await deleteNamed(kind, item.id, channelRequired ? channel : "");
      toast.success("已移出");
      if (editingId === item.id) resetForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function onClear() {
    const tip = channelRequired
      ? `将清空渠道「${channel}」下全部${title}，确认？`
      : `将清空全部${title}，确认？`;
    if (!confirm(tip)) return;
    try {
      await clearNamed(kind, channelRequired ? channel : undefined);
      toast.success("已清空");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败");
    }
  }

  async function onExport() {
    try {
      const path = channelRequired
        ? `${basePath(kind)}/export.csv${qs({ channel })}`
        : `${basePath(kind)}/export.csv`;
      const filename = channelRequired
        ? `${user?.username || "account"}-${kind}-${channel}.csv`
        : `${user?.username || "account"}-${kind}.csv`;
      await downloadAuthed(path, filename);
      toast.success("已导出 CSV");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function onBackup() {
    try {
      const result = await authJson<{
        payload?: unknown;
        filename?: string;
        message?: string;
      }>(`${basePath(kind)}/backup`, {
        method: "POST",
        body: JSON.stringify(channelRequired ? { channel } : {}),
      });
      const blob = new Blob([JSON.stringify(result.payload ?? result, null, 2) + "\n"], {
        type: "application/json;charset=utf-8",
      });
      downloadBlob(blob, result.filename || `${kind}-backup.json`);
      toast.success(result.message || "备份完成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "备份失败");
    }
  }

  async function onImport(file: File, overwrite: boolean) {
    try {
      const text = await file.text();
      const path = overwrite ? `${basePath(kind)}/import-overwrite` : `${basePath(kind)}/import`;
      const body = channelRequired ? { text, channel } : { text };
      const result = await authJson<{ message?: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast.success(result.message || "导入完成");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    }
  }

  const count =
    Number(summary[meta.countKey] ?? summary.blacklist_count ?? summary.ignored_count ?? items.length) ||
    items.length;

  return (
    <div>
      <header className="panel-head">
        <div className="panel-kicker">{title}</div>
        <h1 className="panel-title">{channelRequired ? channelLabel || channel : title}</h1>
      </header>

      <div className="workspace-tabs">
        <button type="button" className={`workspace-tab ${tab === "form" ? "active" : ""}`} onClick={() => setTab("form")}>
          新增
        </button>
        <button type="button" className={`workspace-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          列表
        </button>
      </div>

      <div className="workspace-body">
      {tab === "form" ? (
        <form className="form-card" style={{ maxWidth: 420 }} onSubmit={onSubmit}>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <strong>{editingId ? "保存修改" : meta.add}</strong>
            <span className="muted">{formatTime(summary.last_updated_at)}</span>
          </div>
          <label className="field">
            <span>{fullNameField ? "企业简称" : "企业名称"}</span>
            <input
              className="input"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={fullNameField ? "列表上方显示的简称" : `输入要${meta.add.replace("加入", "")}的企业`}
            />
          </label>
          {fullNameField ? (
            <label className="field">
              <span>企业全称</span>
              <input
                className="input"
                value={companyFullName}
                onChange={(e) => setCompanyFullName(e.target.value)}
                placeholder="可选，列表下方显示的全称"
              />
            </label>
          ) : null}
          <label className="field">
            <span>{meta.reason}</span>
            <textarea
              className="textarea"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="toolbar">
            <button className="btn btn-danger" type="submit" disabled={busy}>
              {editingId ? "保存修改" : meta.add}
            </button>
            {editingId ? (
              <button className="btn" type="button" onClick={resetForm}>
                取消编辑
              </button>
            ) : null}
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            {title} <strong style={{ color: "var(--text)", marginLeft: 8 }}>{count}</strong>
          </div>
        </form>
      ) : (
        <>
          <div className="tools">
            <div className="search-group">
              <input
                className="input"
                style={{ width: 240 }}
                placeholder={meta.searchPh}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    load();
                  }
                }}
              />
              <button className="btn btn-sm btn-primary" type="button" onClick={() => load()}>
                查询
              </button>
              <button
                className="btn btn-sm"
                type="button"
                onClick={async () => {
                  setQ("");
                  try {
                    const data = await listNamed(kind, channelRequired ? channel : "", "");
                    setItems(data.items);
                    setSummary(data.summary);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "刷新失败");
                  }
                }}
              >
                刷新
              </button>
            </div>
            <div className="action-group">
              <button className="btn btn-sm" type="button" onClick={onBackup}>
                下载备份
              </button>
              <label className="btn btn-sm">
                导入备份
                <input
                  type="file"
                  accept=".json,.csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onImport(f, false);
                  }}
                />
              </label>
              <label className="btn btn-sm btn-danger">
                导入并覆盖
                <input
                  type="file"
                  accept=".json,.csv"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onImport(f, true);
                  }}
                />
              </label>
              <button className="btn btn-sm btn-danger" type="button" onClick={onClear}>
                清空记录
              </button>
              <button className="btn btn-sm" type="button" onClick={onExport}>
                导出 CSV
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>企业名称</th>
                  <th>更新时间</th>
                  <th>操作</th>
                  <th>{meta.reason}</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="empty-cell">
                      {meta.empty}
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="company-name">{item.company_name}</div>
                        {item.company_full_name ? (
                          <div className="company-full">{item.company_full_name}</div>
                        ) : null}
                      </td>
                      <td>{formatTime(item.updated_at)}</td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-sm" type="button" onClick={() => fillForm(item)}>
                            编辑
                          </button>
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => onDelete(item)}>
                            移出
                          </button>
                        </div>
                      </td>
                      <td>{item.reason || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function basePath(kind: ListKind) {
  if (kind === "ignored") return "/api/ignored";
  if (kind === "blocklist") return "/api/blocklist";
  return "/api/watchlist";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
