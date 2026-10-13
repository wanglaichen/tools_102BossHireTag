export function formatTime(ts?: string | number | null): string {
  if (ts === undefined || ts === null || ts === "") return "-";
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) {
    // already ISO-ish
    const d = new Date(String(ts));
    if (Number.isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("zh-CN", { hour12: false });
  }
  const ms = n < 1e12 ? n * 1000 : n;
  return new Date(ms).toLocaleString("zh-CN", { hour12: false });
}

export function flagLabel(v?: string): string {
  if (v === "yes") return "是";
  if (v === "no") return "否";
  return "未标记";
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}
