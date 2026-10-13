"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  backupCompanies,
  clearCompanies,
  createCompany,
  createNamed,
  deleteCompany,
  exportCompaniesCsv,
  getSummary,
  importCompanies,
  listCompanies,
  listNamed,
  updateCompany,
} from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { flagLabel, formatTime } from "@/lib/format";
import type { Company, Summary } from "@/lib/types";

const TIME_FILTERS = [
  { id: "all", label: "所有" },
  { id: "today", label: "今天" },
  { id: "yesterday", label: "昨天" },
  { id: "before_yesterday", label: "昨天及以前" },
] as const;

type Props = {
  channel: string;
  channelLabel: string;
  reloadKey?: number;
};

const emptyForm = {
  company_name: "",
  effect_status: "",
  industry: "",
  is_hunter: "unknown",
  is_outsourced: "unknown",
  is_interviewed: "unknown",
  note: "",
};

export function HirePanel({ channel, channelLabel, reloadKey = 0 }: Props) {
  const { user } = useAuth();
  const [tab, setTab] = useState<"list" | "form">("list");
  const [items, setItems] = useState<Company[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [timeFilter, setTimeFilter] = useState("all");
  const [q, setQ] = useState("");
  const [hunter, setHunter] = useState("");
  const [outsourced, setOutsourced] = useState("");
  const [hideIgnored, setHideIgnored] = useState(false);
  const [ignoredNames, setIgnoredNames] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const statusOptions = summary.settings?.status_options || summary.statuses || [];
  const industryOptions = summary.settings?.industry_options || summary.industries || [];

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        listCompanies(channel, timeFilter),
        getSummary(channel),
      ]);
      setItems(list);
      setSummary(sum);
      setPage(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    }
  }, [channel, timeFilter]);

  const loadIgnored = useCallback(async () => {
    try {
      const data = await listNamed("ignored", channel, "");
      const set = new Set<string>();
      data.items.forEach((row) => {
        const name = String(row.company_name || "").trim().toLowerCase();
        if (name) set.add(name);
      });
      setIgnoredNames(set);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载忽略企业失败");
    }
  }, [channel]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, reloadKey]);

  useEffect(() => {
    if (hideIgnored) loadIgnored().catch(() => undefined);
  }, [hideIgnored, loadIgnored]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return items.filter((item) => {
      if (hideIgnored && ignoredNames.size) {
        const name = String(item.company_name || "").trim().toLowerCase();
        if (name && ignoredNames.has(name)) return false;
      }
      if (hunter && item.is_hunter !== hunter) return false;
      if (outsourced && item.is_outsourced !== outsourced) return false;
      if (!keyword) return true;
      const searchable = [
        item.company_name,
        item.effect_status,
        item.industry,
        flagLabel(item.is_hunter),
        flagLabel(item.is_outsourced),
        flagLabel(item.is_interviewed),
        item.note,
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(keyword);
    });
  }, [items, q, hunter, outsourced, hideIgnored, ignoredNames]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize) || 1);
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function fillForm(item: Company) {
    setEditingId(item.id);
    setForm({
      company_name: item.company_name || "",
      effect_status: item.effect_status || "",
      industry: item.industry || "",
      is_hunter: item.is_hunter || "unknown",
      is_outsourced: item.is_outsourced || "unknown",
      is_interviewed: item.is_interviewed || "unknown",
      note: item.note || "",
    });
    setTab("form");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form, channel };
      if (editingId) {
        await updateCompany(editingId, payload);
        toast.success("已更新");
      } else {
        await createCompany(payload);
        toast.success("已保存");
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

  async function onDelete(item: Company) {
    if (!confirm(`确定删除「${item.company_name}」吗？`)) return;
    try {
      await deleteCompany(item.id);
      toast.success("已删除");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function onAddToIgnored(item: Company) {
    const name = String(item.company_name || "").trim();
    if (!name) return;
    if (!confirm(`将「${name}」添加到当前渠道「${channel}」的忽略企业？`)) return;
    try {
      const reasonParts: string[] = [];
      if (item.effect_status) reasonParts.push(`原交流状态：${item.effect_status}`);
      if (item.note) reasonParts.push(String(item.note));
      const result = (await createNamed("ignored", {
        company_name: name,
        reason: reasonParts.join("；").slice(0, 500),
        channel,
      })) as { message?: string };
      toast.success(result.message || `已将「${name}」加入忽略企业`);
      if (hideIgnored) await loadIgnored();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加入忽略失败");
    }
  }

  async function onClear() {
    if (!confirm(`将清空渠道「${channel}」下全部投递记录，确认？`)) return;
    try {
      await clearCompanies(channel);
      toast.success("已清空");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败");
    }
  }

  async function onBackup() {
    try {
      const result = (await backupCompanies(channel)) as {
        payload?: unknown;
        filename?: string;
        message?: string;
      };
      const blob = new Blob([JSON.stringify(result.payload ?? result, null, 2) + "\n"], {
        type: "application/json;charset=utf-8",
      });
      downloadBlob(blob, result.filename || `${channel}-companies-backup.json`);
      toast.success(result.message || "备份完成");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "备份失败");
    }
  }

  async function onExport() {
    try {
      await exportCompaniesCsv(channel, user?.username || "account");
      toast.success("已导出 CSV");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    }
  }

  async function onImportFile(file: File, overwrite: boolean) {
    try {
      const text = await file.text();
      const result = (await importCompanies(text, channel, overwrite)) as { message?: string };
      toast.success(result.message || (overwrite ? "覆盖导入完成" : "导入完成"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    }
  }

  return (
    <div>
      <header className="panel-head">
        <div className="panel-kicker">投递登记</div>
        <h1 className="panel-title">{channelLabel || channel}</h1>
      </header>

      <div className="metrics">
        <Metric tone="total" label="公司总数" value={summary.company_count} />
        <Metric tone="rejected" label="已拒绝" value={summary.rejected_count} />
        <Metric tone="hunter" label="猎头" value={summary.hunter_count} />
        <Metric tone="outsourced" label="外包" value={summary.outsourced_count} />
        <Metric tone="interviewed" label="已面试" value={summary.interviewed_count} />
        <Metric tone="follow" label="需跟进" value={summary.follow_up_count} />
      </div>

      <div className="toolbar">
        <span className="muted">创建时间</span>
        {TIME_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn-sm ${timeFilter === f.id ? "btn-primary" : ""}`}
            onClick={() => setTimeFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <button className="btn btn-sm" type="button" style={{ marginLeft: "auto" }} onClick={() => load()}>
          刷新列表
        </button>
      </div>

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
        <form className="form-card" onSubmit={onSubmit}>
          <div className="toolbar" style={{ justifyContent: "space-between" }}>
            <strong>{editingId ? "编辑记录" : "新增记录"}</strong>
            <span className="muted">最近更新 {formatTime(summary.last_updated_at)}</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>企业名称</span>
              <input
                className="input"
                required
                value={form.company_name}
                onChange={(e) => setForm((s) => ({ ...s, company_name: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>交流状态</span>
              <select
                className="select"
                value={form.effect_status}
                onChange={(e) => setForm((s) => ({ ...s, effect_status: e.target.value }))}
              >
                <option value="">请选择交流状态</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>行业</span>
              <select
                className="select"
                value={form.industry}
                onChange={(e) => setForm((s) => ({ ...s, industry: e.target.value }))}
              >
                <option value="">请选择行业</option>
                {industryOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid-flags">
            <FlagSelect
              label="猎头"
              value={form.is_hunter}
              onChange={(v) => setForm((s) => ({ ...s, is_hunter: v }))}
            />
            <FlagSelect
              label="外包"
              value={form.is_outsourced}
              onChange={(v) => setForm((s) => ({ ...s, is_outsourced: v }))}
            />
            <FlagSelect
              label="已面试"
              value={form.is_interviewed}
              onChange={(v) => setForm((s) => ({ ...s, is_interviewed: v }))}
            />
          </div>
          <label className="field">
            <span>备注</span>
            <textarea
              className="textarea"
              rows={2}
              placeholder="联系人、渠道、下一步动作"
              value={form.note}
              onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            />
          </label>
          <div className="toolbar">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {editingId ? "更新记录" : "保存记录"}
            </button>
            {editingId ? (
              <button className="btn" type="button" onClick={resetForm}>
                取消编辑
              </button>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          <div className="tools">
            <div className="search-group">
              <input
                className="input"
                style={{ width: 220 }}
                placeholder="搜索公司、状态、行业、备注"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
              <select
                className="select"
                style={{ width: 110 }}
                value={hunter}
                onChange={(e) => {
                  setHunter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部类型</option>
                <option value="yes">猎头</option>
                <option value="no">非猎头</option>
                <option value="unknown">未标记</option>
              </select>
              <select
                className="select"
                style={{ width: 110 }}
                value={outsourced}
                onChange={(e) => {
                  setOutsourced(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">全部</option>
                <option value="yes">外包</option>
                <option value="no">非外包</option>
                <option value="unknown">未标记</option>
              </select>
              <label className="check-inline" title="与左侧「忽略企业」同渠道名单精确匹配">
                <input
                  type="checkbox"
                  checked={hideIgnored}
                  onChange={(e) => {
                    setHideIgnored(e.target.checked);
                    setPage(1);
                  }}
                />
                隐藏忽略企业
              </label>
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
                    if (f) onImportFile(f, false);
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
                    if (f) onImportFile(f, true);
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
                  <th>操作</th>
                  <th>状态</th>
                  <th>行业</th>
                  <th>猎头/外包</th>
                  <th>备注</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-cell">
                      暂无记录
                    </td>
                  </tr>
                ) : (
                  pageItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="company-name">{item.company_name}</div>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn btn-sm" type="button" onClick={() => fillForm(item)}>
                            编辑
                          </button>
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => onDelete(item)}>
                            删除
                          </button>
                          <button
                            className="btn btn-sm"
                            type="button"
                            title="加入当前渠道的忽略企业名单"
                            onClick={() => onAddToIgnored(item)}
                          >
                            添加到忽略企业
                          </button>
                        </div>
                      </td>
                      <td>
                        <div>{item.effect_status || "-"}</div>
                        <div className="muted">面试：{flagLabel(item.is_interviewed)}</div>
                      </td>
                      <td>{item.industry || "-"}</td>
                      <td>
                        {flagLabel(item.is_hunter)} / {flagLabel(item.is_outsourced)}
                      </td>
                      <td>{item.note || ""}</td>
                      <td>{formatTime(item.updated_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pager-bar">
            <div>共 {filtered.length} 条</div>
            <div className="pager-size">
              <span>每页</span>
              {[10, 20, 30, 50, 100].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`pager-size-btn ${pageSize === n ? "active" : ""}`}
                  onClick={() => {
                    setPageSize(n);
                    setPage(1);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="row-actions">
              <button
                className="btn btn-sm"
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span>
                {safePage} / {totalPages}
              </span>
              <button
                className="btn btn-sm"
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "total",
}: {
  label: string;
  value?: number;
  tone?: "total" | "rejected" | "hunter" | "outsourced" | "interviewed" | "follow";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value ?? 0}</strong>
    </article>
  );
}

function FlagSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="unknown">未标记</option>
        <option value="yes">是</option>
        <option value="no">否</option>
      </select>
    </label>
  );
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
