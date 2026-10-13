let watchlistReady = false;

function bindWatchlistEvents() {
    if (watchlistReady) return;
    watchlistReady = true;
    byId("watchlistForm").addEventListener("submit", submitWatchlist);
    byId("watchlistCancelBtn").addEventListener("click", resetWatchlistForm);
    byId("watchlistSearchBtn").addEventListener("click", () => loadWatchlist({ force: true }));
    byId("watchlistRefreshBtn").addEventListener("click", () => {
        byId("watchlistSearchInput").value = "";
        state.watchlistKeyword = "";
        loadWatchlist({ force: true });
    });
    byId("watchlistSearchInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            loadWatchlist({ force: true });
        }
    });
    byId("watchlistBackupBtn").addEventListener("click", createWatchlistBackup);
    byId("watchlistImportBtn").addEventListener("click", () => {
        state.watchlistImportMode = "merge";
        byId("watchlistImportFileInput").click();
    });
    byId("watchlistImportOverwriteBtn").addEventListener("click", () => {
        state.watchlistImportMode = "overwrite";
        byId("watchlistImportFileInput").click();
    });
    byId("watchlistImportFileInput").addEventListener("change", handleWatchlistImportFile);
    byId("watchlistClearBtn").addEventListener("click", openClearWatchlistModal);
    byId("watchlistExportCsvBtn").addEventListener("click", exportWatchlistCsv);
}

async function loadWatchlist(options = {}) {
    const q = byId("watchlistSearchInput").value.trim();
    state.watchlistKeyword = q;
    if (!options.force) {
        const entry = state.cache.watchlist;
        if (entry && !entry.dirty && (entry.keyword || "") === q && Array.isArray(entry.items)) {
            applyWatchlistCache(entry);
            return;
        }
    }
    const data = await requestJson(`/api/watchlist?q=${encodeURIComponent(q)}`);
    state.watchlist = data.items || [];
    const summary = data.summary || {};
    state.watchlistSummaryUpdatedAt = summary.last_updated_at || "";
    renderWatchlistSummary(summary);
    renderWatchlist();
    rememberWatchlistCache();
}

function rememberWatchlistCache() {
    state.cache.watchlist = {
        items: Array.isArray(state.watchlist) ? state.watchlist.slice() : [],
        summary: {
            watchlist_count: Number(byId("watchlistCount")?.textContent || state.watchlist.length) || 0,
            last_updated_at: state.watchlistSummaryUpdatedAt || "",
        },
        keyword: state.watchlistKeyword || "",
        dirty: false,
    };
}

function applyWatchlistCache(entry) {
    state.watchlist = Array.isArray(entry.items) ? entry.items.slice() : [];
    state.watchlistKeyword = entry.keyword || "";
    const search = byId("watchlistSearchInput");
    if (search && search.value.trim() !== state.watchlistKeyword) {
        search.value = state.watchlistKeyword;
    }
    renderWatchlistSummary(entry.summary || {});
    renderWatchlist();
}

function invalidateWatchlistCache() {
    if (state.cache.watchlist) state.cache.watchlist.dirty = true;
}

function renderWatchlistSummary(summary) {
    byId("watchlistCount").textContent = summary.watchlist_count ?? state.watchlist.length;
    byId("watchlistLastUpdated").textContent = formatTime(summary.last_updated_at) || "-";
    if (summary.last_updated_at) {
        state.watchlistSummaryUpdatedAt = summary.last_updated_at;
    }
}

function renderWatchlist() {
    const tbody = byId("watchlistTableBody");
    tbody.replaceChildren();
    if (!state.watchlist.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无匹配的持续关注记录</td></tr>';
        return;
    }
    state.watchlist.forEach((item) => {
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
        tr.querySelector('[data-action="edit"]').addEventListener("click", () => fillWatchlistForm(item));
        tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteWatchlistItem(item));
        tbody.appendChild(tr);
    });
}

function fillWatchlistForm(item) {
    state.watchlistEditingId = item.id;
    byId("watchlistNameInput").value = item.company_name || "";
    byId("watchlistReasonInput").value = item.reason || "";
    byId("watchlistSubmitBtn").textContent = "保存修改";
    byId("watchlistCancelBtn").classList.remove("d-none");
    switchWorkspaceTab("form", byId("watchlistWorkspace"));
    byId("watchlistNameInput").focus();
}

function resetWatchlistForm() {
    state.watchlistEditingId = null;
    byId("watchlistForm").reset();
    byId("watchlistSubmitBtn").textContent = "加入持续关注";
    byId("watchlistCancelBtn").classList.add("d-none");
}

async function submitWatchlist(event) {
    event.preventDefault();
    clearMessages();
    const payload = {
        company_name: byId("watchlistNameInput").value.trim(),
        reason: byId("watchlistReasonInput").value.trim(),
    };
    byId("watchlistSubmitBtn").disabled = true;
    try {
        let result;
        if (state.watchlistEditingId) {
            result = await requestJson(`/api/watchlist/${state.watchlistEditingId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
        } else {
            result = await requestJson("/api/watchlist", {
                method: "POST",
                body: JSON.stringify(payload),
            });
        }
        showMessage("success", result.message || "已保存");
        resetWatchlistForm();
        state.watchlist = result.items || [];
        renderWatchlistSummary(result.summary || {});
        renderWatchlist();
        rememberWatchlistCache();
        switchWorkspaceTab("list", byId("watchlistWorkspace"));
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        byId("watchlistSubmitBtn").disabled = false;
    }
}

async function deleteWatchlistItem(item) {
    if (!window.confirm(`确定将「${item.company_name}」移出持续关注吗？`)) {
        return;
    }
    clearMessages();
    try {
        const result = await requestJson(`/api/watchlist/${item.id}`, { method: "DELETE" });
        showMessage("success", result.message || "已移出");
        if (state.watchlistEditingId === item.id) {
            resetWatchlistForm();
        }
        state.watchlist = result.items || [];
        renderWatchlistSummary(result.summary || {});
        renderWatchlist();
        rememberWatchlistCache();
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function createWatchlistBackup() {
    clearMessages();
    const btn = byId("watchlistBackupBtn");
    if (btn) btn.disabled = true;
    try {
        const result = await requestJson("/api/watchlist/backup", { method: "POST", body: "{}" });
        const payload = result.payload || {};
        const filename = result.filename || "watchlist-backup.json";
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
        showMessage("success", (result.message || "持续关注备份完成") + "。可用「导入备份」合并，或「导入并覆盖」替换全部");
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleWatchlistImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const mode = state.watchlistImportMode === "overwrite" ? "overwrite" : "merge";
    if (mode === "overwrite") {
        const confirmed = window.confirm("导入并覆盖会用所选文件完全替换当前账号的持续关注企业，且不可撤销。确定继续？");
        if (!confirmed) {
            event.target.value = "";
            return;
        }
    }
    clearMessages();
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target.result;
        const endpoint = mode === "overwrite" ? "/api/watchlist/import-overwrite" : "/api/watchlist/import";
        try {
            const result = await requestJson(endpoint, {
                method: "POST",
                body: JSON.stringify({ text }),
            });
            showMessage("success", result.message);
            state.watchlist = result.items || [];
            renderWatchlistSummary(result.summary || {});
            renderWatchlist();
            invalidateWatchlistCache();
            rememberWatchlistCache();
        } catch (error) {
            showMessage("error", error.message);
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsText(file);
}

async function exportWatchlistCsv() {
    clearMessages();
    const username = (state.account && state.account.username) || "account";
    try {
        const token = getAuthToken();
        const response = await fetch("/api/watchlist/export.csv", {
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
        link.download = `${username}-watchlist.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showMessage("success", "已导出持续关注企业（CSV）");
    } catch (error) {
        showMessage("error", error.message);
    }
}

function openClearWatchlistModal() {
    const modal = byId("clearCompaniesModal");
    const error = byId("clearCompaniesError");
    const title = modal?.querySelector("h2");
    const warning = modal?.querySelector(".clear-confirm-warning");
    state.clearKind = "watchlist";
    if (title) title.textContent = "清空持续关注企业";
    if (warning) {
        warning.innerHTML = `
                <p><strong>此操作不可撤销。</strong></p>
                <ul>
                    <li>将删除：当前账号下的<strong>全部持续关注企业</strong></li>
                    <li>不会删除：投递登记、忽略企业、黑名单及其他账号数据</li>
                </ul>
                <p>请先下载备份后再清空。确认前请完成下方验算。</p>
            `;
    }
    if (error) error.textContent = "";
    prepareClearConfirmChallenge({ focus: true });
    modal.classList.remove("d-none");
    modal.style.display = "flex";
}
