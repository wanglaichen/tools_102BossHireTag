"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { clearJobUpdates, deleteJobUpdate, listJobUpdates } from "@/lib/api";
import { getApiBase } from "@/lib/apiBase";
import { formatTime } from "@/lib/format";
import type { JobUpdate, Summary } from "@/lib/types";

type Props = {
  channel: string;
  channelLabel: string;
  reloadKey?: number;
};

const TIME_FILTERS = [
  { id: "all", label: "所有" },
  { id: "today", label: "今天" },
  { id: "yesterday", label: "昨天" },
  { id: "before_yesterday", label: "昨天及以前" },
] as const;

export function JobUpdatesPanel({ channel, channelLabel, reloadKey = 0 }: Props) {
  const [tab, setTab] = useState<"list" | "help">("list");
  const [items, setItems] = useState<JobUpdate[]>([]);
  const [summary, setSummary] = useState<Summary>({});
  const [q, setQ] = useState("");
  const [timeFilter, setTimeFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const data = await listJobUpdates(channel, {
        q: q.trim(),
        time_filter: timeFilter,
      });
      setItems(data.items);
      setSummary(data.summary);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "加载失败");
    }
  }, [channel, q, timeFilter]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, reloadKey]);

  async function onDelete(item: JobUpdate) {
    if (!confirm(`确定删除「${item.company_name} / ${item.job_title}」吗？`)) return;
    try {
      await deleteJobUpdate(item.id);
      toast.success("已删除");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function onClear() {
    if (!confirm(`将清空渠道「${channel}」下全部岗位采集，确认？`)) return;
    try {
      await clearJobUpdates(channel);
      toast.success("已清空");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清空失败");
    }
  }

  const apiBase = getApiBase() || "http://127.0.0.1:9212";

  return (
    <div>
      <header className="panel-head">
        <div className="panel-kicker">更新平台职位</div>
        <h1 className="panel-title">{channelLabel || channel}</h1>
      </header>

      <div className="metrics metrics-compact">
        <article className="metric-card metric-total">
          <span className="metric-label">采集岗位数</span>
          <strong className="metric-value">{summary.job_update_count ?? items.length}</strong>
        </article>
        <article className="metric-card metric-follow">
          <span className="metric-label">最近更新</span>
          <strong className="metric-value metric-value-sm">{formatTime(summary.last_updated_at)}</strong>
        </article>
      </div>

      <div className="workspace-tabs">
        <button type="button" className={`workspace-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          列表
        </button>
        <button type="button" className={`workspace-tab ${tab === "help" ? "active" : ""}`} onClick={() => setTab("help")}>
          API 说明
        </button>
      </div>

      <div className="workspace-body">
      {tab === "help" ? (
        <div className="help-block">
          <h2 style={{ marginTop: 0, color: "var(--text)" }}>如何把招聘平台岗位写入「更新平台职位」</h2>
          <p>登录账号后携带 Token 调用 HTTP API。同渠道下「企业名 + 岗位名」唯一，重复提交会覆盖更新。</p>
          <h3>鉴权</h3>
          <pre>{`Authorization: Bearer <你的 token>
Content-Type: application/json`}</pre>
          <p>Token 来自 <code>POST /api/auth/login</code>，或浏览器登录后本地会话。</p>
          <h3>字段</h3>
          <p>
            必填：<code>channel</code>、<code>company_name</code>、<code>job_title</code>
            <br />
            可选：<code>salary_min</code>、<code>salary_max</code>、<code>location</code>、<code>job_summary</code>
          </p>
          <h3>单条写入</h3>
          <pre>{`POST ${apiBase}/api/job-updates
{
  "channel": "${channel || "boss"}",
  "company_name": "星云互娱",
  "job_title": "前端开发（React）",
  "salary_min": 15,
  "salary_max": 25,
  "location": "深圳·南山区",
  "job_summary": "参与企业投递台页面迭代"
}`}</pre>
          <h3>批量写入</h3>
          <pre>{`POST ${apiBase}/api/job-updates/batch
{
  "channel": "${channel || "boss"}",
  "items": [
    { "company_name": "示例科技", "job_title": "Python 后端", "salary_min": 20, "salary_max": 35 }
  ]
}`}</pre>
          <h3>查询与删除</h3>
          <pre>{`GET  /api/job-updates?channel=${channel || "boss"}&q=关键词
DELETE /api/job-updates/<id>
POST /api/job-updates/clear  body: { "channel": "${channel || "boss"}" }`}</pre>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <span className="muted">时间</span>
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
          </div>
          <div className="tools">
            <div className="search-group">
              <input
                className="input"
                style={{ width: 240 }}
                placeholder="搜索企业、岗位、地点、简介"
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
                onClick={() => {
                  setQ("");
                }}
              >
                刷新
              </button>
            </div>
            <div className="action-group">
              <button className="btn btn-sm btn-danger" type="button" onClick={onClear}>
                清空记录
              </button>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>企业</th>
                  <th>岗位</th>
                  <th>薪资</th>
                  <th>地点</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      暂无岗位采集记录
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="company-name">{item.company_name}</div>
                        {item.job_summary ? <div className="company-full">{item.job_summary}</div> : null}
                      </td>
                      <td>{item.job_title}</td>
                      <td>
                        {item.salary_min != null || item.salary_max != null
                          ? `${item.salary_min ?? "-"}-${item.salary_max ?? "-"}K`
                          : "-"}
                      </td>
                      <td>{item.location || "-"}</td>
                      <td>{formatTime(item.updated_at)}</td>
                      <td>
                        <button className="btn btn-sm btn-danger" type="button" onClick={() => onDelete(item)}>
                          删除
                        </button>
                      </td>
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
