"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { exportMyBundle, importMyBundle } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

type Props = {
  onClose: () => void;
};

export function AccountSettingsModal({ onClose }: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const importOverwriteRef = useRef(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  async function onExport() {
    setBusy(true);
    try {
      await exportMyBundle(user?.username || "account");
      toast.success("已导出本账号全部数据，可用于迁移到其他账号");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setBusy(false);
    }
  }

  function pickImport(overwrite: boolean) {
    if (overwrite) {
      const ok = confirm(
        "覆盖导入会用所选数据包替换本账号的登记/忽略/黑名单/关注/岗位更新，不可撤销。确定继续？",
      );
      if (!ok) return;
    }
    importOverwriteRef.current = overwrite;
    importFileRef.current?.click();
  }

  async function onImportFile(file: File | null) {
    if (!file) return;
    const overwrite = importOverwriteRef.current;
    setBusy(true);
    try {
      const text = await file.text();
      const result = await importMyBundle(text, overwrite);
      toast.success(result.message || (overwrite ? "覆盖导入完成" : "增量导入完成"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card" style={{ width: "min(520px, 100%)" }}>
        <div className="modal-head">
          <h2 style={{ margin: 0, fontSize: 16 }}>账号设置</h2>
          <button className="btn btn-sm btn-ghost" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="workspace-body">
          <input
            ref={importFileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void onImportFile(e.target.files?.[0] || null);
            }}
          />

          <div className="form-card">
            <strong>数据迁移</strong>
            <p className="muted" style={{ margin: "8px 0 12px" }}>
              导出本账号全部业务数据（投递登记、忽略企业、黑名单、持续关注、岗位更新）。
              之后可在本账号或其他账号的设置里做增量导入或覆盖导入。
            </p>
            <div className="toolbar">
              <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void onExport()}>
                {busy ? "处理中…" : "导出全部数据"}
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => pickImport(false)}>
                增量导入
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => pickImport(true)}>
                覆盖导入
              </button>
            </div>
          </div>

          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            当前账号：{user?.displayName || user?.username}
            {user?.role === "admin" ? "（管理员）" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
