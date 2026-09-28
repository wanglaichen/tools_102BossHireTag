function bindBlacklistEvents() {
    if (blacklistReady) return;
    blacklistReady = true;
    byId("blacklistForm").addEventListener("submit", submitBlacklist);
    byId("blacklistCancelBtn").addEventListener("click", resetBlacklistForm);
    byId("blacklistSearchBtn").addEventListener("click", () => loadBlacklist({ force: true }));
    byId("blacklistRefreshBtn").addEventListener("click", () => {
        byId("blacklistSearchInput").value = "";
        state.blacklistKeyword = "";
        loadBlacklist({ force: true });
    });
    byId("blacklistSearchInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            loadBlacklist({ force: true });
        }
    });
    byId("blacklistBackupBtn").addEventListener("click", createBlacklistBackup);
    byId("blacklistImportBtn").addEventListener("click", () => {
        state.blacklistImportMode = "merge";
        byId("blacklistImportFileInput").click();
    });
    byId("blacklistImportOverwriteBtn").addEventListener("click", () => {
        state.blacklistImportMode = "overwrite";
        byId("blacklistImportFileInput").click();
    });
    byId("blacklistImportFileInput").addEventListener("change", handleBlacklistImportFile);
    byId("blacklistClearBtn").addEventListener("click", openClearIgnoredModal);
    byId("blacklistExportCsvBtn").addEventListener("click", exportBlacklistCsv);
}

async function exportBlacklistCsv() {
    clearMessages();
    const channel = state.hireChannel || "boss";
    const username = (state.account && state.account.username) || "account";
    try {
        const token = getAuthToken();
        const response = await fetch(`/api/ignored/export.csv?channel=${encodeURIComponent(channel)}`, {
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
        link.download = `${username}-ignored-${channel}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showMessage("success", `已导出渠道「${channel}」忽略企业（CSV）`);
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function createBlacklistBackup() {
    clearMessages();
    const btn = byId("blacklistBackupBtn");
    const channel = state.hireChannel || "boss";
    if (btn) btn.disabled = true;
    try {
        const result = await requestJson("/api/ignored/backup", {
            method: "POST",
            body: JSON.stringify({ channel }),
        });
        const payload = result.payload || {};
        const filename = result.filename || `ignored-${channel}-backup.json`;
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
        showMessage(
            "success",
            (result.message || `渠道「${channel}」忽略企业备份完成`)
                + "。可用「导入备份」增量合并，或「导入并覆盖」仅替换本渠道"
        );
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleBlacklistImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const channel = state.hireChannel || "boss";
    const mode = state.blacklistImportMode === "overwrite" ? "overwrite" : "merge";
    if (mode === "overwrite") {
        const confirmed = window.confirm(
            `导入并覆盖会用所选文件替换当前渠道「${channel}」的忽略企业，其他渠道不受影响，且不可撤销。确定继续？`
        );
        if (!confirmed) {
            event.target.value = "";
            return;
        }
    }
    clearMessages();
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const endpoint = mode === "overwrite" ? "/api/ignored/import-overwrite" : "/api/ignored/import";
        try {
            const result = await requestJson(endpoint, {
                method: "POST",
                body: JSON.stringify({ text, channel }),
            });
            showMessage("success", result.message);
            state.blacklist = result.items || [];
            renderBlacklistSummary(result.summary || {});
            renderBlacklist();
            invalidateBlacklistCache(channel);
            rememberBlacklistCache();
        } catch (error) {
            showMessage("error", error.message);
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsText(file);
}

function openClearIgnoredModal() {
    const modal = byId("clearCompaniesModal");
    const error = byId("clearCompaniesError");
    const title = modal?.querySelector("h2");
    const warning = modal?.querySelector(".clear-confirm-warning");
    const channel = state.hireChannel || "boss";
    state.clearKind = "ignored";
    if (title) title.textContent = `清空渠道「${channel}」忽略企业`;
    if (warning) {
        warning.innerHTML = `
                <p><strong>此操作不可撤销。</strong></p>
                <ul>
                    <li>将删除：当前招聘渠道 <strong>${channel}</strong> 下的<strong>全部忽略企业</strong></li>
                    <li>不会删除：其他招聘渠道的忽略企业</li>
                    <li>不会删除：投递登记数据及账号本身</li>
                </ul>
                <p>请先下载本渠道备份后再清空。确认前请完成下方验算。</p>
            `;
    }
    if (error) error.textContent = "";
    prepareClearConfirmChallenge({ focus: true });
    modal.classList.remove("d-none");
    modal.style.display = "flex";
}


async function loadBlacklist(options = {}) {
    const q = byId("blacklistSearchInput").value.trim();
    state.blacklistKeyword = q;
    const channel = state.hireChannel || "boss";
    if (!options.force) {
        const entry = state.cache.blacklist[channel];
        if (entry && !entry.dirty && (entry.keyword || "") === q && Array.isArray(entry.items)) {
            applyBlacklistCache(entry);
            return;
        }
    }
    const data = await requestJson(`/api/ignored?q=${encodeURIComponent(q)}&channel=${encodeURIComponent(channel)}`);
    state.blacklist = data.items || [];
    const summary = data.summary || {};
    state.blacklistSummaryUpdatedAt = summary.last_updated_at || "";
    renderBlacklistSummary(summary);
    renderBlacklist();
    rememberBlacklistCache();
}

function renderBlacklistSummary(summary) {
    byId("blacklistCount").textContent = summary.ignored_count ?? summary.blacklist_count ?? state.blacklist.length;
    byId("blacklistLastUpdated").textContent = formatTime(summary.last_updated_at) || "-";
    if (summary.last_updated_at) {
        state.blacklistSummaryUpdatedAt = summary.last_updated_at;
    }
}

function renderBlacklist() {
    const tbody = byId("blacklistTableBody");
    tbody.replaceChildren();
    if (!state.blacklist.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无匹配的忽略企业记录</td></tr>';
        return;
    }
    state.blacklist.forEach((item) => {
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
        tr.querySelector('[data-action="edit"]').addEventListener("click", () => fillBlacklistForm(item));
        tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteBlacklistItem(item));
        tbody.appendChild(tr);
    });
}

function fillBlacklistForm(item) {
    state.blacklistEditingId = item.id;
    byId("blacklistNameInput").value = item.company_name || "";
    byId("blacklistReasonInput").value = item.reason || "";
    byId("blacklistSubmitBtn").textContent = "保存修改";
    byId("blacklistCancelBtn").classList.remove("d-none");
    switchWorkspaceTab("form", byId("blacklistWorkspace"));
    byId("blacklistNameInput").focus();
}

function resetBlacklistForm() {
    state.blacklistEditingId = null;
    byId("blacklistForm").reset();
    byId("blacklistSubmitBtn").textContent = "加入忽略";
    byId("blacklistCancelBtn").classList.add("d-none");
}

async function submitBlacklist(event) {
    event.preventDefault();
    clearMessages();
    const payload = {
        company_name: byId("blacklistNameInput").value.trim(),
        reason: byId("blacklistReasonInput").value.trim(),
        channel: state.hireChannel || "boss",
    };
    byId("blacklistSubmitBtn").disabled = true;
    try {
        let result;
        if (state.blacklistEditingId) {
            result = await requestJson(`/api/ignored/${state.blacklistEditingId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
        } else {
            result = await requestJson("/api/ignored", {
                method: "POST",
                body: JSON.stringify(payload),
            });
        }
        showMessage("success", result.message || "已保存");
        resetBlacklistForm();
        state.blacklist = result.items || [];
        renderBlacklistSummary(result.summary || {});
        renderBlacklist();
        rememberBlacklistCache();
        switchWorkspaceTab("list", byId("blacklistWorkspace"));
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        byId("blacklistSubmitBtn").disabled = false;
    }
}

async function deleteBlacklistItem(item) {
    if (!window.confirm(`确定将「${item.company_name}」移出忽略企业吗？`)) {
        return;
    }
    clearMessages();
    try {
        const channel = encodeURIComponent(state.hireChannel || "boss");
        const result = await requestJson(`/api/ignored/${item.id}?channel=${channel}`, { method: "DELETE" });
        showMessage("success", result.message || "已移出");
        if (state.blacklistEditingId === item.id) {
            resetBlacklistForm();
        }
        state.blacklist = result.items || [];
        renderBlacklistSummary(result.summary || {});
        renderBlacklist();
        rememberBlacklistCache();
    } catch (error) {
        showMessage("error", error.message);
    }
}
