import { authFetch, authJson, getAuthHeaders, getStoredToken } from "./auth";
import { apiUrl } from "./apiBase";
import { qs } from "./format";
import type { Channel, Company, JobUpdate, NamedListItem, Summary } from "./types";

export async function getVersion(): Promise<string> {
  const res = await fetch(apiUrl("/api/version"));
  const data = await res.json().catch(() => ({}));
  return (data as { version?: string }).version || "";
}

export async function getChannels(): Promise<Channel[]> {
  const data = await authJson<{ channels?: Channel[]; items?: Channel[] }>("/api/channels");
  return data.channels || data.items || [];
}

export async function createChannel(name: string, id?: string) {
  return authJson("/api/channels", {
    method: "POST",
    body: JSON.stringify({ name, id: id || undefined }),
  });
}

export async function deleteChannel(id: string) {
  return authJson(`/api/channels/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getSummary(channel: string): Promise<Summary> {
  return authJson(`/api/summary${qs({ channel })}`);
}

export async function listCompanies(channel: string, timeFilter = "all"): Promise<Company[]> {
  const data = await authJson<{ items?: Company[] }>(
    `/api/companies${qs({ channel, time_filter: timeFilter })}`,
  );
  return data.items || [];
}

export async function createCompany(payload: Partial<Company>) {
  return authJson<{ message?: string } & Company>("/api/companies", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCompany(id: string, payload: Partial<Company>) {
  return authJson(`/api/companies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteCompany(id: string) {
  return authJson(`/api/companies/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function clearCompanies(channel: string) {
  return authJson("/api/companies/clear", {
    method: "POST",
    body: JSON.stringify({ channel }),
  });
}

export async function importCompanies(text: string, channel: string, overwrite = false) {
  const path = overwrite ? "/api/companies/import-overwrite" : "/api/companies/import";
  return authJson(path, {
    method: "POST",
    body: JSON.stringify({ text, channel }),
  });
}

export async function backupCompanies(channel: string) {
  return authJson("/api/backup", {
    method: "POST",
    body: JSON.stringify({ channel }),
  });
}

export async function getProxy() {
  return authJson<{ enabled?: boolean; url?: string }>("/api/proxy");
}

export async function setProxy(enabled: boolean, url?: string) {
  return authJson("/api/proxy", {
    method: "POST",
    body: JSON.stringify({ enabled, url }),
  });
}

type ListKind = "ignored" | "blocklist" | "watchlist";

function listBase(kind: ListKind) {
  if (kind === "ignored") return "/api/ignored";
  if (kind === "blocklist") return "/api/blocklist";
  return "/api/watchlist";
}

export async function listNamed(
  kind: ListKind,
  channel: string,
  q = "",
): Promise<{ items: NamedListItem[]; summary: Summary }> {
  const data = await authJson<{ items?: NamedListItem[]; summary?: Summary }>(
    `${listBase(kind)}${qs({ channel, q })}`,
  );
  return { items: data.items || [], summary: data.summary || {} };
}

export async function createNamed(kind: ListKind, payload: Record<string, unknown>) {
  return authJson(`${listBase(kind)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateNamed(kind: ListKind, id: string, payload: Record<string, unknown>) {
  return authJson(`${listBase(kind)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteNamed(kind: ListKind, id: string, channel: string) {
  return authJson(`${listBase(kind)}/${encodeURIComponent(id)}${qs({ channel })}`, {
    method: "DELETE",
  });
}

export async function clearNamed(kind: ListKind, channel?: string) {
  return authJson(`${listBase(kind)}/clear`, {
    method: "POST",
    body: JSON.stringify(channel ? { channel } : {}),
  });
}

export async function listJobUpdates(
  channel: string,
  opts: { q?: string; time_filter?: string; from_ts?: number; to_ts?: number } = {},
): Promise<{ items: JobUpdate[]; summary: Summary }> {
  const data = await authJson<{ items?: JobUpdate[]; summary?: Summary }>(
    `/api/job-updates${qs({ channel, ...opts })}`,
  );
  return { items: data.items || [], summary: data.summary || {} };
}

export async function clearJobUpdates(channel: string) {
  return authJson("/api/job-updates/clear", {
    method: "POST",
    body: JSON.stringify({ channel }),
  });
}

export async function deleteJobUpdate(id: string) {
  return authJson(`/api/job-updates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function adminSummary() {
  return authJson("/api/admin/summary");
}

export async function listUsers() {
  const data = await authJson<{
    users?: unknown[];
    registrationPolicy?: { trialHours?: number; defaultTrialHours?: number };
  }>("/api/auth/users");
  return {
    users: data.users || [],
    registrationPolicy: {
      trialHours: Number(data.registrationPolicy?.trialHours ?? 72),
      defaultTrialHours: Number(data.registrationPolicy?.defaultTrialHours ?? 72),
    },
  };
}

export async function fetchPublicRegistrationPolicy() {
  const res = await fetch(apiUrl("/api/auth/registration-policy/public"), { cache: "no-store" });
  if (!res.ok) return { trialHours: 72 };
  const data = (await res.json().catch(() => ({}))) as { trialHours?: number };
  return { trialHours: Number(data.trialHours ?? 72) };
}

export async function updateRegistrationPolicy(trialHours: number) {
  return authJson<{ trialHours?: number; defaultTrialHours?: number; message?: string }>(
    "/api/auth/registration-policy",
    {
      method: "PUT",
      body: JSON.stringify({ trialHours }),
    },
  );
}

export async function createUser(payload: {
  username: string;
  password: string;
  displayName?: string;
  role?: "admin" | "user";
}) {
  return authJson<{ user?: unknown; message?: string }>("/api/auth/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateUser(
  userId: string,
  payload: {
    password?: string;
    displayName?: string;
    role?: string;
    locked?: boolean;
    permanent?: boolean;
  },
) {
  return authJson<{ user?: unknown; message?: string }>(`/api/auth/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(userId: string) {
  return authJson<{ ok?: boolean; message?: string }>(`/api/auth/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

function filenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const utf = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf?.[1]) {
    try {
      return decodeURIComponent(utf[1]);
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] || fallback;
}

export async function downloadAuthed(path: string, filename: string) {
  const res = await authFetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { message?: string }).message || "下载失败");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFromDisposition(res.headers.get("Content-Disposition"), filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 管理员导出指定账号全部数据 */
export async function exportUserBundle(userId: string, username: string) {
  await downloadAuthed(
    `/api/auth/users/${encodeURIComponent(userId)}/bundle`,
    `account-bundle_${username || "account"}.json`,
  );
}

/** 管理员向指定账号导入全部数据 */
export async function importUserBundle(userId: string, text: string, overwrite = false) {
  const path = overwrite
    ? `/api/auth/users/${encodeURIComponent(userId)}/bundle/import-overwrite`
    : `/api/auth/users/${encodeURIComponent(userId)}/bundle/import`;
  return authJson<{ message?: string }>(path, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** 当前账号导出全部数据 */
export async function exportMyBundle(username: string) {
  await downloadAuthed("/api/account/bundle", `account-bundle_${username || "account"}.json`);
}

/** 当前账号导入全部数据 */
export async function importMyBundle(text: string, overwrite = false) {
  const path = overwrite ? "/api/account/bundle/import-overwrite" : "/api/account/bundle/import";
  return authJson<{ message?: string }>(path, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function exportCompaniesCsv(channel: string, username: string) {
  await downloadAuthed(
    `/api/companies/export.csv${qs({ channel })}`,
    `${username}-${channel}-companies.csv`,
  );
}

export type FullNameSyncEvent = {
  type: "start" | "step_start" | "progress" | "step_done" | "done" | "error";
  message?: string;
  total?: number;
  totalDone?: number;
  updated?: number;
  steps?: number | Array<{ stepId?: string; label?: string; scanned?: number; updated?: number }>;
  step?: number;
  stepId?: string;
  label?: string;
  stepDone?: number;
  stepTotal?: number;
  stepUpdated?: number;
};

/** 企业全称跨名单同步（NDJSON 流式进度） */
export async function syncCompanyFullNames(
  onEvent: (event: FullNameSyncEvent) => void,
): Promise<FullNameSyncEvent> {
  const res = await authFetch("/api/company-full-name-sync", { method: "POST", body: "{}" });
  if (!res.ok) {
    const raw = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const data = JSON.parse(raw) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      if (/not found on the server/i.test(raw) || res.status === 404) {
        message = "同步接口不存在，请重启 API 后再试";
      } else if (raw.trim()) {
        message = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      }
    }
    throw new Error(message);
  }
  if (!res.body) {
    throw new Error("浏览器不支持流式响应");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let last: FullNameSyncEvent = { type: "start" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      const event = JSON.parse(text) as FullNameSyncEvent;
      last = event;
      onEvent(event);
      if (event.type === "error") {
        throw new Error(event.message || "企业全称同步失败");
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const event = JSON.parse(tail) as FullNameSyncEvent;
    last = event;
    onEvent(event);
    if (event.type === "error") {
      throw new Error(event.message || "企业全称同步失败");
    }
  }

  return last;
}

export { getAuthHeaders, getStoredToken };
