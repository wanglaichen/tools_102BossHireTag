const LOCAL_DEFAULT = "http://127.0.0.1:9212";

function normalizeBase(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

function isLocalDevHost(): boolean {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
}

/** Flask API base. Local Next → :9212；部署时可配同源或独立 API 域名。 */
export function getApiBase(): string {
  const env = normalizeBase(process.env.NEXT_PUBLIC_API_BASE_URL || "");
  if (env) return env;
  if (typeof window === "undefined") return LOCAL_DEFAULT;
  if (isLocalDevHost()) return LOCAL_DEFAULT;
  return "";
}

export function apiUrl(path: string): string {
  const base = getApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
