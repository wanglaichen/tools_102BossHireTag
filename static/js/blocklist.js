let blocklistReady = false;

function bindBlocklistEvents() {
    if (blocklistReady) return;
    blocklistReady = true;
    byId("blocklistForm").addEventListener("submit", submitBlocklist);
    byId("blocklistCancelBtn").addEventListener("click", resetBlocklistForm);
    byId("blocklistSearchBtn").addEventListener("click", () => loadBlocklist({ force: true }));
    byId("blocklistRefreshBtn").addEventListener("click", () => {
        byId("blocklistSearchInput").value = "";
        state.blocklistKeyword = "";
        loadBlocklist({ force: true });
    });
    byId("blocklistSearchInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            loadBlocklist({ force: true });
        }
    });
    byId("blocklistBackupBtn").addEventListener("click", createBlocklistBackup);
    byId("blocklistImportBtn").addEventListener("click", () => {
        state.blocklistImportMode = "merge";
        byId("blocklistImportFileInput").click();
    });
    byId("blocklistImportOverwriteBtn").addEventListener("click", () => {
        state.blocklistImportMode = "overwrite";
        byId("blocklistImportFileInput").click();
    });
    byId("blocklistImportFileInput").addEventListener("change", handleBlocklistImportFile);
    byId("blocklistClearBtn").addEventListener("click", openClearBlocklistModal);
    byId("blocklistExportCsvBtn").addEventListener("click", exportBlocklistCsv);
}

async function loadBlocklist(options = {}) {
    const q = byId("blocklistSearchInput").value.trim();
    state.blocklistKeyword = q;
    if (!options.force) {
        const entry = state.cache.blocklist;
        if (entry && !entry.dirty && (entry.keyword || "") === q && Array.isArray(entry.items)) {
            applyBlocklistCache(entry);
            return;
        }
    }
    const data = await requestJson(`/api/blocklist?q=${encodeURIComponent(q)}`);
    state.blocklist = data.items || [];
    const summary = data.summary || {};
    state.blocklistSummaryUpdatedAt = summary.last_updated_at || "";
    renderBlocklistSummary(summary);
    renderBlocklist();
    rememberBlocklistCache();
}

function rememberBlocklistCache() {
    state.cache.blocklist = {
        items: Array.isArray(state.blocklist) ? state.blocklist.slice() : [],
        summary: {
            blocklist_count: Number(byId("blocklistCount")?.textContent || state.blocklist.length) || 0,
            last_updated_at: state.blocklistSummaryUpdatedAt || "",
        },
        keyword: state.blocklistKeyword || "",
        dirty: false,
    };
}

function applyBlocklistCache(entry) {
    state.blocklist = Array.isArray(entry.items) ? entry.items.slice() : [];
    state.blocklistKeyword = entry.keyword || "";
    const search = byId("blocklistSearchInput");
    if (search && search.value.trim() !== state.blocklistKeyword) {
        search.value = state.blocklistKeyword;
    }
    renderBlocklistSummary(entry.summary || {});
    renderBlocklist();
}

function invalidateBlocklistCache() {
    if (state.cache.blocklist) state.cache.blocklist.dirty = true;
}

function renderBlocklistSummary(summary) {
    byId("blocklistCount").textContent = summary.blocklist_count ?? state.blocklist.length;
    byId("blocklistLastUpdated").textContent = formatTime(summary.last_updated_at) || "-";
    if (summary.last_updated_at) {
        state.blocklistSummaryUpdatedAt = summary.last_updated_at;
    }
}

function renderBlocklist() {
    const tbody = byId("blocklistTableBody");
    tbody.replaceChildren();
    if (!state.blocklist.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无匹配的黑名单记录</td></tr>';
        return;
    }
    state.blocklist.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><div class="company-name">${escapeHtml(item.company_name)}</div></td>
            <td>${formatTimeHtml(item.updated_at)}</td>
            <td>
                <div class="row-actions">
                    <button class="btn btn-sm btn-outline-primary" data-action="edit">编辑</button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delete">移出</button>
                </div>
            </td>
            <td class="note-cell">${escapeHtml(item.reason || "")}</td>
        `;
        tr.querySelector('[data-action="edit"]').addEventListener("click", () => fillBlocklistForm(item));
        tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteBlocklistItem(item));
        tbody.appendChild(tr);
    });
}

function fillBlocklistForm(item) {
    state.blocklistEditingId = item.id;
    byId("blocklistNameInput").value = item.company_name || "";
    byId("blocklistReasonInput").value = item.reason || "";
    byId("blocklistSubmitBtn").textContent = "保存修改";
    byId("blocklistCancelBtn").classList.remove("d-none");
    switchWorkspaceTab("form", byId("blocklistWorkspace"));
    byId("blocklistNameInput").focus();
}

function resetBlocklistForm() {
    state.blocklistEditingId = null;
    byId("blocklistForm").reset();
    byId("blocklistSubmitBtn").textContent = "加入黑名单";
    byId("blocklistCancelBtn").classList.add("d-none");
}

async function submitBlocklist(event) {
    event.preventDefault();
    clearMessages();
    const payload = {
        company_name: byId("blocklistNameInput").value.trim(),
        reason: byId("blocklistReasonInput").value.trim(),
    };
    byId("blocklistSubmitBtn").disabled = true;
    try {
        let result;
        if (state.blocklistEditingId) {
            result = await requestJson(`/api/blocklist/${state.blocklistEditingId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
        } else {
            result = await requestJson("/api/blocklist", {
                method: "POST",
                body: JSON.stringify(payload),
            });
        }
        showMessage("success", result.message || "已保存");
        resetBlocklistForm();
        state.blocklist = result.items || [];
        renderBlocklistSummary(result.summary || {});
        renderBlocklist();
        rememberBlocklistCache();
        switchWorkspaceTab("list", byId("blocklistWorkspace"));
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        byId("blocklistSubmitBtn").disabled = false;
    }
}

async function deleteBlocklistItem(item) {
    if (!window.confirm(`确定将「${item.company_name}」移出黑名单吗？`)) {
        return;
    }
    clearMessages();
    try {
        const result = await requestJson(`/api/blocklist/${item.id}`, { method: "DELETE" });
        showMessage("success", result.message || "已移出");
        if (state.blocklistEditingId === item.id) {
            resetBlocklistForm();
        }
        state.blocklist = result.items || [];
        renderBlocklistSummary(result.summary || {});
        renderBlocklist();
        rememberBlocklistCache();
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function createBlocklistBackup() {
    clearMessages();
    const btn = byId("blocklistBackupBtn");
    if (btn) btn.disabled = true;
    try {
        const result = await requestJson("/api/blocklist/backup", { method: "POST", body: "{}" });
        const payload = result.payload || {};
        const filename = result.filename || `blocklist-backup.json`;
        const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], {
            type: "application/json;charset=utf-8",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showMessage("success", (result.message || "黑名单备份完成") + "。可用「导入备份」合并，或「导入并覆盖」替换全部黑名单");
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleBlocklistImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const mode = state.blocklistImportMode === "overwrite" ? "overwrite" : "merge";
    if (mode === "overwrite") {
        const confirmed = window.confirm("导入并覆盖会用所选文件完全替换当前账号的黑名单企业，且不可撤销。确定继续？");
        if (!confirmed) {
            event.target.value = "";
            return;
        }
    }
    clearMessages();
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const endpoint = mode === "overwrite" ? "/api/blocklist/import-overwrite" : "/api/blocklist/import";
        try {
            const result = await requestJson(endpoint, {
                method: "POST",
                body: JSON.stringify({ text }),
            });
            showMessage("success", result.message);
            state.blocklist = result.items || [];
            renderBlocklistSummary(result.summary || {});
            renderBlocklist();
            invalidateBlocklistCache();
            rememberBlocklistCache();
        } catch (error) {
            showMessage("error", error.message);
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsText(file);
}

async function exportBlocklistCsv() {
    clearMessages();
    const username = (state.account && state.account.username) || "account";
    try {
        const token = getAuthToken();
        const response = await fetch("/api/blocklist/export.csv", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "导出失败");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${username}-blocklist.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showMessage("success", "已导出黑名单企业（CSV）");
    } catch (error) {
        showMessage("error", error.message);
    }
}

function openClearBlocklistModal() {
    const modal = byId("clearCompaniesModal");
    const error = byId("clearCompaniesError");
    const title = modal?.querySelector("h2");
    const warning = modal?.querySelector(".clear-confirm-warning");
    state.clearKind = "blocklist";
    if (title) title.textContent = "清空黑名单企业";
    if (warning) {
        warning.innerHTML = `
                <p><strong>此操作不可撤销。</strong></p>
                <ul>
                    <li>将删除：当前账号下的<strong>全部黑名单企业</strong></li>
                    <li>不会删除：投递登记、忽略企业及其他账号数据</li>
                </ul>
                <p>请先下载备份后再清空。确认前请完成下方验算。</p>
            `;
    }
    if (error) error.textContent = "";
    prepareClearConfirmChallenge({ focus: true });
    modal.classList.remove("d-none");
    modal.style.display = "flex";
}
