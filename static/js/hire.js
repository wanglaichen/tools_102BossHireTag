function readForm() {
    const getSelectedValues = (id) => {
        const options = byId(id).selectedOptions;
        return Array.from(options).map(o => o.value).filter(v => v);
    };
    return {
        company_name: byId("companyNameInput").value,
        effect_status: getSelectedValues("effectStatusInput").join(","),
        industry: getSelectedValues("industryInput").join(","),
        is_hunter: byId("hunterInput").value,
        is_outsourced: byId("outsourcedInput").value,
        is_interviewed: byId("interviewedInput").value,
        note: byId("noteInput").value,
        channel: state.hireChannel || "boss",
    };
}

function resetForm() {
    state.editingId = null;
    byId("companyForm").reset();
    byId("hunterInput").value = "unknown";
    byId("outsourcedInput").value = "unknown";
    byId("interviewedInput").value = "unknown";
    byId("submitButton").textContent = "保存记录";
    byId("cancelEditButton").classList.add("d-none");
    byId("companyNameInput").focus();
}

function fillForm(item) {
    state.editingId = item.id;
    byId("companyNameInput").value = item.company_name || "";
    setSelectValues("effectStatusInput", (item.effect_status || "").split(",").filter(v => v));
    setSelectValues("industryInput", (item.industry || "").split(",").filter(v => v));
    byId("hunterInput").value = item.is_hunter || "unknown";
    byId("outsourcedInput").value = item.is_outsourced || "unknown";
    byId("interviewedInput").value = item.is_interviewed || "unknown";
    byId("noteInput").value = item.note || "";
    byId("submitButton").textContent = "更新记录";
    byId("cancelEditButton").classList.remove("d-none");
    switchWorkspaceTab("form", byId("hireChannelWorkspace")?.querySelector(".workspace-with-tabs") || byId("hireChannelWorkspace"));
    byId("companyForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function switchWorkspaceTab(tab, root) {
    const next = String(tab || "list");
    const scope = root && root.querySelectorAll ? root : null;
    const wraps = scope
        ? [root]
        : Array.from(document.querySelectorAll(".workspace-with-tabs"));
    wraps.forEach((wrap) => {
        if (!wrap) return;
        wrap.querySelectorAll(".workspace-tab").forEach((btn) => {
            const active = btn.dataset.workspaceTab === next;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        wrap.querySelectorAll("[data-workspace-panel]").forEach((panel) => {
            const active = panel.dataset.workspacePanel === next;
            panel.classList.toggle("is-active", active);
            panel.hidden = !active;
        });
        if (wrap.id === "jobUpdatesWorkspace" && next === "stats" && typeof renderJobUpdatesChart === "function") {
            requestAnimationFrame(() => renderJobUpdatesChart());
        }
    });
}

function bindWorkspaceTabs() {
    document.querySelectorAll(".workspace-with-tabs").forEach((wrap) => {
        wrap.querySelectorAll(".workspace-tab").forEach((btn) => {
            btn.addEventListener("click", () => {
                switchWorkspaceTab(btn.dataset.workspaceTab || "list", wrap);
            });
        });
        switchWorkspaceTab("list", wrap);
    });
}

function renderSummary(summary) {
    state.summary = summary;
    byId("companyCount").textContent = summary.company_count ?? 0;
    byId("rejectedCount").textContent = summary.rejected_count ?? 0;
    byId("hunterCount").textContent = summary.hunter_count ?? 0;
    byId("outsourcedCount").textContent = summary.outsourced_count ?? 0;
    byId("interviewedCount").textContent = summary.interviewed_count ?? 0;
    byId("followUpCount").textContent = summary.follow_up_count ?? 0;
    byId("lastUpdatedAt").textContent = formatTime(summary.last_updated_at);

    state.settings = summary.settings || state.settings;
    renderStatusFilter(summary.statuses || []);
    renderConfigChips();
    populateSelectOptions("effectStatusInput", state.settings.status_options || [], "请选择交流状态");
    populateSelectOptions("industryInput", state.settings.industry_options || [], "请选择行业");
}

function renderStatusFilter(values) {
    // The old select-based filter is replaced by a dropdown
    // No-op for backward compatibility
}

function updateStatusFilterUI() {
    const menu = byId("statusFilterMenu");
    const btn = byId("statusFilterBtn");
    const statuses = state.settings.status_options || [];

    menu.innerHTML = "";

    const allLabel = document.createElement("label");
    allLabel.innerHTML = `<input type="checkbox" value="" ${state.selectedStatuses.length === 0 ? "checked" : ""}> 全部`;
    allLabel.querySelector("input").addEventListener("change", () => {
        state.selectedStatuses = [];
        updateStatusFilterUI();
        resetCompanyPage();
        renderCompanies();
    });
    menu.appendChild(allLabel);

    statuses.forEach(status => {
        const label = document.createElement("label");
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(status)}" ${state.selectedStatuses.includes(status) ? "checked" : ""}> ${escapeHtml(status)}`;
        label.querySelector("input").addEventListener("change", () => {
            if (state.selectedStatuses.includes(status)) {
                state.selectedStatuses = state.selectedStatuses.filter(s => s !== status);
            } else {
                state.selectedStatuses.push(status);
            }
            const allCheckbox = menu.querySelector('input[value=""]');
            if (allCheckbox) allCheckbox.checked = state.selectedStatuses.length === 0;
            updateStatusFilterUI();
            resetCompanyPage();
            renderCompanies();
        });
        menu.appendChild(label);
    });

    const span = btn.querySelector("span");
    if (state.selectedStatuses.length === 0) {
        span.textContent = "全部状态";
    } else if (state.selectedStatuses.length === 1) {
        span.textContent = state.selectedStatuses[0];
    } else {
        span.textContent = `已选${state.selectedStatuses.length}项`;
    }
}

function toggleStatusFilterMenu() {
    const menu = byId("statusFilterMenu");
    menu.classList.toggle("show");
    if (menu.classList.contains("show")) {
        updateStatusFilterUI();
    }
}

document.addEventListener("click", (e) => {
    const dropdown = byId("statusDropdown");
    if (!dropdown.contains(e.target)) {
        byId("statusFilterMenu").classList.remove("show");
    }
});

function getFilteredCompanies() {
    const keyword = byId("searchInput").value.trim().toLowerCase();
    const selectedStatuses = state.selectedStatuses;
    const statusFilterAll = selectedStatuses.length === 0;
    const hunter = byId("hunterFilter").value;
    const outsourced = byId("outsourcedFilter").value;

    return state.companies.filter((item) => {
        const searchable = [
            item.company_name,
            item.effect_status,
            item.industry,
            flagLabel(item.is_hunter),
            flagLabel(item.is_outsourced),
            hunterLabel(item.is_hunter),
            outsourcedLabel(item.is_outsourced),
            interviewLabel(item.is_interviewed),
            item.note,
        ]
            .join(" ")
            .toLowerCase();

        const itemStatuses = (item.effect_status || "").split(",").map(s => s.trim());

        const matchStatus = statusFilterAll || itemStatuses.some(s => selectedStatuses.includes(s));
        const matchHunter = !hunter || item.is_hunter === hunter;
        const matchOutsourced = !outsourced || item.is_outsourced === outsourced;

        return (!keyword || searchable.includes(keyword)) && matchStatus && matchHunter && matchOutsourced;
    });
}

function renderCompanies() {
    const tbody = byId("companyTableBody");
    const items = getFilteredCompanies();
    const pageSize = Number(state.pageSize) || 30;
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    if (state.page > totalPages) {
        state.page = totalPages;
    }
    if (state.page < 1) {
        state.page = 1;
    }
    const start = (state.page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    tbody.innerHTML = "";
    renderCompanyPager(total, totalPages, start, pageItems.length);

    if (!total) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">暂无匹配记录</td></tr>';
        return;
    }

    pageItems.forEach((item) => {
        const tr = document.createElement("tr");
        const statusParts = (item.effect_status || "未填写").split(",");
        const industryParts = (item.industry || "-").split(",");
        const interviewText = interviewLabel(item.is_interviewed);
        const interviewClass = interviewFlagClass(item.is_interviewed);
        const hunterClass = escapeHtml(item.is_hunter || "unknown");
        const outsourcedClass = escapeHtml(item.is_outsourced || "unknown");
        tr.innerHTML = `
            <td>
                <div class="company-name">${escapeHtml(item.company_name)}</div>
                <div class="muted-line">创建: ${formatTime(item.created_at)}</div>
            </td>
            <td>
                <div class="row-actions row-actions-stack">
                    <div class="row-actions-top">
                        <button class="row-btn row-btn-edit" type="button" data-action="edit">编辑</button>
                        <button class="row-btn row-btn-delete" type="button" data-action="delete">删除</button>
                    </div>
                    <button class="row-btn row-btn-ignored" type="button" data-action="to-ignored">添加到忽略企业</button>
                </div>
            </td>
            <td>
                <div class="status-interview-cell">
                    <div class="status-interview-row status-interview-top">${statusParts.map(s => `<span class="status-pill ${s.includes("拒绝") ? "rejected" : ""}">${escapeHtml(s)}</span>`).join(" ")}</div>
                    <div class="status-interview-row status-interview-bottom">
                        <span class="flag-badge ${interviewClass}">${escapeHtml(interviewText)}</span>
                    </div>
                </div>
            </td>
            <td>${industryParts.map(i => `<span class="industry-tag">${escapeHtml(i)}</span>`).join(" ")}</td>
            <td>
                <div class="status-interview-cell">
                    <div class="status-interview-row">
                        <span class="flag-badge ${hunterClass}">${escapeHtml(hunterLabel(item.is_hunter))}</span>
                    </div>
                    <div class="status-interview-row">
                        <span class="flag-badge ${outsourcedClass}">${escapeHtml(outsourcedLabel(item.is_outsourced))}</span>
                    </div>
                </div>
            </td>
            <td class="note-cell">${escapeHtml(item.note || "")}</td>
            <td>${formatTimeHtml(item.updated_at)}</td>
        `;
        tr.querySelector('[data-action="edit"]').addEventListener("click", () => fillForm(item));
        tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteCompany(item));
        tr.querySelector('[data-action="to-ignored"]').addEventListener("click", () => addCompanyToIgnored(item));
        tr.addEventListener("dblclick", (event) => {
            if (event.target.closest("button")) {
                return;
            }
            fillForm(item);
        });
        tbody.appendChild(tr);
    });
}

function renderCompanyPager(total, totalPages, start, pageCount) {
    const info = byId("pagerInfo");
    const pageLabel = byId("pagerPageLabel");
    const prevBtn = byId("pagerPrevBtn");
    const nextBtn = byId("pagerNextBtn");
    if (!info || !pageLabel || !prevBtn || !nextBtn) {
        return;
    }
    if (!total) {
        info.textContent = "共 0 条";
        pageLabel.textContent = "1 / 1";
    } else {
        const from = start + 1;
        const to = start + pageCount;
        info.textContent = `共 ${total} 条，当前 ${from}-${to}`;
        pageLabel.textContent = `${state.page} / ${totalPages}`;
    }
    prevBtn.disabled = state.page <= 1;
    nextBtn.disabled = state.page >= totalPages;
    document.querySelectorAll(".pager-size-btn").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.size) === Number(state.pageSize));
    });
}

function resetCompanyPage() {
    state.page = 1;
}

function bindCompanyPager() {
    const prevBtn = byId("pagerPrevBtn");
    const nextBtn = byId("pagerNextBtn");
    if (prevBtn) {
        prevBtn.addEventListener("click", () => {
            if (state.page > 1) {
                state.page -= 1;
                renderCompanies();
            }
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener("click", () => {
            state.page += 1;
            renderCompanies();
        });
    }
    document.querySelectorAll(".pager-size-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const size = Number(btn.dataset.size) || 30;
            if (size === state.pageSize) {
                return;
            }
            state.pageSize = size;
            state.page = 1;
            renderCompanies();
        });
    });
}

function renderConfigChips() {
    renderChips("statusChips", state.settings.status_options || [], removeStatusOption);
    renderChips("industryChips", state.settings.industry_options || [], removeIndustryOption);
}

function renderChips(containerId, values, onRemove) {
    const container = byId(containerId);
    if (!values.length) {
        container.innerHTML = '<span class="chip-empty">暂无选项</span>';
        return;
    }

    container.innerHTML = "";
    values.forEach((value) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.innerHTML = `<span>${escapeHtml(value)}</span><strong>×</strong>`;
        chip.addEventListener("click", () => onRemove(value));
        container.appendChild(chip);
    });
}

async function saveSettings(nextSettings) {
    const result = await requestJson("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(nextSettings),
    });
    showMessage("success", result.message || "配置已保存");
    renderSummary(result.summary || {});
}

async function addStatusOption() {
    const input = byId("newStatusInput");
    const value = input.value.trim();
    if (!value) {
        return;
    }
    const next = new Set(state.settings.status_options || []);
    next.add(value);
    input.value = "";
    await saveSettings({
        status_options: Array.from(next),
        industry_options: state.settings.industry_options || [],
    });
}

async function addIndustryOption() {
    const input = byId("newIndustryInput");
    const value = input.value.trim();
    if (!value) {
        return;
    }
    const next = new Set(state.settings.industry_options || []);
    next.add(value);
    input.value = "";
    await saveSettings({
        status_options: state.settings.status_options || [],
        industry_options: Array.from(next),
    });
}

async function removeStatusOption(value) {
    const next = (state.settings.status_options || []).filter((item) => item !== value);
    await saveSettings({
        status_options: next,
        industry_options: state.settings.industry_options || [],
    });
}

async function removeIndustryOption(value) {
    const next = (state.settings.industry_options || []).filter((item) => item !== value);
    await saveSettings({
        status_options: state.settings.status_options || [],
        industry_options: next,
    });
}

async function loadSummary() {
    const summary = await requestJson(`/api/summary${channelQuery()}`);
    renderSummary(summary);
    const channel = state.hireChannel || "boss";
    const entry = state.cache.hire[channel] || { companies: state.companies || [], timeFilter: state.timeFilter || "all" };
    entry.summary = summary;
    entry.timeFilter = state.timeFilter || "all";
    entry.dirty = false;
    if (!Array.isArray(entry.companies)) entry.companies = state.companies || [];
    state.cache.hire[channel] = entry;
}

async function loadCompanies() {
    const data = await requestJson(`/api/companies?time_filter=${encodeURIComponent(state.timeFilter)}&channel=${encodeURIComponent(state.hireChannel || "boss")}`);
    state.companies = data.items || [];
    resetCompanyPage();
    renderCompanies();
    rememberHireCache();
}

async function submitCompany(event) {
    event.preventDefault();
    clearMessages();
    const payload = readForm();
    const isEditing = Boolean(state.editingId);
    const url = isEditing ? `/api/companies/${state.editingId}` : "/api/companies";
    const method = isEditing ? "PATCH" : "POST";

    byId("submitButton").disabled = true;
    try {
        const result = await requestJson(url, {
            method,
            body: JSON.stringify(payload),
        });
        showMessage("success", result.message || "已保存");
        resetForm();
        invalidateHireCache(state.hireChannel || "boss");
        await loadSummary();
        await loadCompanies();
        const hireWrap = byId("hireChannelWorkspace")?.querySelector(".workspace-with-tabs") || byId("hireChannelWorkspace");
        switchWorkspaceTab("list", hireWrap);
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        byId("submitButton").disabled = false;
    }
}

async function deleteCompany(item) {
    if (!window.confirm(`确定删除「${item.company_name}」吗？`)) {
        return;
    }

    clearMessages();
    try {
        const result = await requestJson(`/api/companies/${item.id}?channel=${encodeURIComponent(state.hireChannel || "boss")}`, { method: "DELETE" });
        showMessage("success", result.message || "已删除");
        if (state.editingId === item.id) {
            resetForm();
        }
        invalidateHireCache(state.hireChannel || "boss");
        await loadSummary();
        await loadCompanies();
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function addCompanyToIgnored(item) {
    const channel = state.hireChannel || "boss";
    const name = item.company_name || "";
    if (!name) return;
    if (!window.confirm(`将「${name}」添加到当前渠道「${channel}」的忽略企业？`)) {
        return;
    }
    clearMessages();
    try {
        const reasonParts = [];
        if (item.effect_status) reasonParts.push(`原交流状态：${item.effect_status}`);
        if (item.note) reasonParts.push(item.note);
        const result = await requestJson("/api/ignored", {
            method: "POST",
            body: JSON.stringify({
                company_name: name,
                reason: reasonParts.join("；").slice(0, 500),
                channel,
            }),
        });
        showMessage("success", result.message || `已将「${name}」加入忽略企业`);
        invalidateBlacklistCache(channel);
        if (state.feature === "blacklist" || state.cache.blacklist[channel]) {
            state.cache.blacklist[channel] = {
                items: result.items || [],
                summary: result.summary || {},
                keyword: state.blacklistKeyword || "",
                dirty: false,
            };
        }
    } catch (error) {
        showMessage("error", error.message);
    }
}

let lastImportMode = "merge"; // "merge" or "overwrite"

async function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (lastImportMode === "overwrite") {
        const channel = state.hireChannel || "boss";
        const confirmed = window.confirm(
            `导入并覆盖会用所选文件替换当前渠道「${channel}」的公司数据，其他渠道不受影响，且不可撤销。确定继续？`
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
        const endpoint = lastImportMode === "overwrite" ? "/api/companies/import-overwrite" : "/api/companies/import";
        try {
            const result = await requestJson(endpoint, {
                method: "POST",
                body: JSON.stringify({ text, channel: state.hireChannel || "boss" }),
            });
            showMessage("success", result.message);
            renderSummary(result.summary || {});
            state.companies = result.items || [];
            renderCompanies();
            invalidateHireCache();
            rememberHireCache();
        } catch (error) {
            showMessage("error", error.message);
        } finally {
            event.target.value = "";
        }
    };
    reader.readAsText(file);
}

function setImportMode(mode) {
    lastImportMode = mode;
}

async function createBackup() {
    clearMessages();
    const btn = byId("backupBtn");
    const channel = state.hireChannel || "boss";
    if (btn) btn.disabled = true;
    try {
        const result = await requestJson("/api/backup", {
            method: "POST",
            body: JSON.stringify({ channel }),
        });
        const payload = result.payload || {};
        const filename = result.filename || `backup_${channel}_${Date.now()}.json`;
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
        showMessage("success", (result.message || `渠道「${channel}」备份完成`) + "。可用「导入备份」增量合并，或「导入并覆盖」仅替换本渠道");
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function openClearCompaniesModal() {
    const modal = byId("clearCompaniesModal");
    const input = byId("clearConfirmInput");
    const error = byId("clearCompaniesError");
    const title = modal?.querySelector("h2");
    const warning = modal?.querySelector(".clear-confirm-warning");
    const channel = state.hireChannel || "boss";
    state.clearKind = "hire";
    if (title) title.textContent = `清空渠道「${channel}」记录`;
    if (warning) {
        warning.innerHTML = `
                <p><strong>此操作不可撤销。</strong></p>
                <ul>
                    <li>将删除：当前招聘渠道 <strong>${channel}</strong> 下的<strong>全部公司投递记录</strong></li>
                    <li>不会删除：其他招聘渠道的记录</li>
                    <li>不会删除：左侧「交流状态」「行业」的<strong>自定义标签</strong></li>
                    <li>不会删除：账号本身及其他账号的数据</li>
                </ul>
                <p>请先下载本渠道备份后再清空。确认前请完成下方验算。</p>
            `;
    }
    prepareClearConfirmChallenge({ focus: true });
    if (error) error.textContent = "";
    modal.classList.remove("d-none");
    modal.style.display = "flex";
}

function closeClearCompaniesModal() {
    const modal = byId("clearCompaniesModal");
    modal.style.display = "none";
    modal.classList.add("d-none");
    byId("clearConfirmInput").value = "";
    byId("clearCompaniesError").textContent = "";
    state.clearConfirmAnswer = null;
    syncClearConfirmButton();
}

function prepareClearConfirmChallenge(options = {}) {
    const a = 2 + Math.floor(Math.random() * 18);
    const b = 1 + Math.floor(Math.random() * 12);
    const useAdd = Math.random() < 0.55;
    let left = a;
    let right = b;
    let op = "+";
    let answer = a + b;
    if (!useAdd) {
        left = Math.max(a, b);
        right = Math.min(a, b);
        op = "-";
        answer = left - right;
    }
    state.clearConfirmAnswer = answer;
    const challenge = byId("clearConfirmChallenge");
    if (challenge) challenge.textContent = `${left} ${op} ${right} = ?`;
    const input = byId("clearConfirmInput");
    if (input) {
        input.value = "";
        if (options.focus) input.focus();
    }
    const error = byId("clearCompaniesError");
    if (error) error.textContent = "";
    syncClearConfirmButton();
}

function isClearConfirmAnswerCorrect() {
    const input = byId("clearConfirmInput");
    if (!input || state.clearConfirmAnswer === null || state.clearConfirmAnswer === undefined) {
        return false;
    }
    const raw = input.value.trim();
    if (!/^-?\d+$/.test(raw)) return false;
    return Number(raw) === Number(state.clearConfirmAnswer);
}

function syncClearConfirmButton() {
    const btn = byId("confirmClearCompaniesBtn");
    if (!btn) return;
    btn.disabled = !isClearConfirmAnswerCorrect();
}

async function confirmClearCompanies() {
    const error = byId("clearCompaniesError");
    const btn = byId("confirmClearCompaniesBtn");
    if (!isClearConfirmAnswerCorrect()) {
        if (error) error.textContent = "验算结果不正确，请重试";
        prepareClearConfirmChallenge({ focus: true });
        return;
    }
    if (btn) btn.disabled = true;
    if (error) error.textContent = "";
    clearMessages();
    const channel = state.hireChannel || "boss";
    const kind = state.clearKind === "ignored"
        ? "ignored"
        : (state.clearKind === "blocklist"
            ? "blocklist"
            : (state.clearKind === "jobUpdates" ? "jobUpdates" : "hire"));
    try {
        if (kind === "ignored") {
            const result = await requestJson("/api/ignored/clear", {
                method: "POST",
                body: JSON.stringify({ channel }),
            });
            closeClearCompaniesModal();
            showMessage("success", result.message || "已清空当前渠道忽略企业");
            state.blacklist = result.items || [];
            renderBlacklistSummary(result.summary || {});
            renderBlacklist();
            resetBlacklistForm();
            invalidateBlacklistCache(channel);
            rememberBlacklistCache();
        } else if (kind === "blocklist") {
            const result = await requestJson("/api/blocklist/clear", { method: "POST", body: "{}" });
            closeClearCompaniesModal();
            showMessage("success", result.message || "已清空黑名单");
            state.blocklist = result.items || [];
            renderBlocklistSummary(result.summary || {});
            renderBlocklist();
            resetBlocklistForm();
            invalidateBlocklistCache();
            rememberBlocklistCache();
        } else if (kind === "jobUpdates") {
            const result = await requestJson("/api/job-updates/clear", {
                method: "POST",
                body: JSON.stringify({ channel }),
            });
            closeClearCompaniesModal();
            showMessage("success", result.message || "已清空当前渠道岗位采集");
            state.jobUpdates = result.items || [];
            renderJobUpdatesSummary(result.summary || {});
            renderJobUpdates();
            invalidateJobUpdatesCache(channel);
            rememberJobUpdatesCache();
        } else {
            const result = await requestJson("/api/companies/clear", {
                method: "POST",
                body: JSON.stringify({ channel }),
            });
            closeClearCompaniesModal();
            showMessage("success", result.message || "已清空当前渠道公司记录");
            renderSummary(result.summary || {});
            state.companies = result.items || [];
            renderCompanies();
            resetForm();
            invalidateHireCache(channel);
            rememberHireCache();
        }
    } catch (err) {
        if (error) error.textContent = err.message;
        prepareClearConfirmChallenge({ focus: true });
    }
}

function setupWorkspaceResize() {
    const handle = byId("workspaceResizeHandle");
    const sidePanel = document.querySelector(".side-panel");
    const workspace = document.querySelector(".workspace");
    if (!handle || !sidePanel || !workspace) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener("mousedown", (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidePanel.offsetWidth;
        handle.style.pointerEvents = "none";
        e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.max(260, Math.min(startWidth + diff, 600));
        sidePanel.style.width = newWidth + "px";
        sidePanel.style.flexShrink = "0";
        // Update grid column
        workspace.style.gridTemplateColumns = newWidth + "px minmax(0, 1fr)";
    });

    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            handle.style.pointerEvents = "";
        }
    });
}

function setupColumnHintTips() {
    let tipEl = document.querySelector(".col-hint-float");
    if (!tipEl) {
        tipEl = document.createElement("div");
        tipEl.className = "col-hint-float";
        tipEl.setAttribute("role", "tooltip");
        document.body.appendChild(tipEl);
    }

    const hideTip = () => {
        tipEl.classList.remove("is-visible");
    };

    const showTip = (dot) => {
        const text = (dot.getAttribute("data-tip") || "").replace(/&#10;/g, "\n");
        if (!text) {
            return;
        }
        tipEl.textContent = text;
        tipEl.classList.add("is-visible");
        const rect = dot.getBoundingClientRect();
        const tipWidth = tipEl.offsetWidth || 120;
        const tipHeight = tipEl.offsetHeight || 40;
        let left = rect.left + rect.width / 2 - tipWidth / 2;
        let top = rect.bottom + 8;
        left = Math.max(8, Math.min(left, window.innerWidth - tipWidth - 8));
        if (top + tipHeight > window.innerHeight - 8) {
            top = rect.top - tipHeight - 8;
        }
        tipEl.style.left = `${left}px`;
        tipEl.style.top = `${top}px`;
    };

    document.querySelectorAll(".col-hint-dot").forEach((dot) => {
        dot.addEventListener("mouseenter", () => showTip(dot));
        dot.addEventListener("mouseleave", hideTip);
        dot.addEventListener("focus", () => showTip(dot));
        dot.addEventListener("blur", hideTip);
        dot.addEventListener("mousedown", (event) => {
            event.stopPropagation();
        });
        dot.addEventListener("dragstart", (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
    });

    window.addEventListener("scroll", hideTip, true);
    window.addEventListener("resize", hideTip);
}

function setupTableDragResize() {
    const table = byId("companyTable");
    if (!table) return;

    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    const headerCells = thead.querySelectorAll("th[data-col]");
    const originalOrder = Array.from(headerCells).map(th => th.dataset.col);

    // Column drag-and-drop
    headerCells.forEach(th => {
        th.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", th.dataset.col);
            th.style.opacity = "0.5";
        });
        th.addEventListener("dragend", () => {
            th.style.opacity = "1";
        });
        th.addEventListener("dragover", (e) => {
            e.preventDefault();
            th.style.borderTop = "2px solid var(--blue)";
        });
        th.addEventListener("dragleave", () => {
            th.style.borderTop = "";
        });
        th.addEventListener("drop", (e) => {
            e.preventDefault();
            th.style.borderTop = "";
            const draggedCol = e.dataTransfer.getData("text/plain");
            const targetCol = th.dataset.col;
            if (draggedCol === targetCol) return;

            // Reorder header cells
            const allTh = thead.querySelectorAll("th[data-col]");
            const draggedIdx = originalOrder.indexOf(draggedCol);
            const targetIdx = originalOrder.indexOf(targetCol);

            // Get all rows
            const rows = [thead.querySelector("tr"), ...tbody.querySelectorAll("tr")];
            rows.forEach(row => {
                const cells = row.querySelectorAll("th[data-col], td[data-col]");
                const draggedCell = cells[draggedIdx];
                const targetCell = cells[targetIdx];
                if (draggedCell && targetCell) {
                    if (draggedIdx < targetIdx) {
                        targetCell.parentNode.insertBefore(draggedCell, targetCell.nextSibling);
                    } else {
                        targetCell.parentNode.insertBefore(draggedCell, targetCell);
                    }
                }
            });

            // Update original order
            const newHeaders = thead.querySelectorAll("th[data-col]");
            originalOrder.length = 0;
            newHeaders.forEach(h => originalOrder.push(h.dataset.col));
        });
    });

    // Column resize
    const resizeHandle = document.createElement("div");
    resizeHandle.style.cssText = `
        position: fixed; top: 0; left: 0; width: 0; height: 0;
        cursor: col-resize; display: none; z-index: 9999;
    `;
    document.body.appendChild(resizeHandle);

    let isResizing = false;
    let currentTh = null;
    let startX = 0;
    let startWidth = 0;

    headerCells.forEach(th => {
        th.addEventListener("mousedown", (e) => {
            const rect = th.getBoundingClientRect();
            if (e.clientX > rect.right - 8) {
                isResizing = true;
                currentTh = th;
                startX = e.clientX;
                startWidth = rect.width;
                resizeHandle.style.display = "block";
                resizeHandle.style.top = rect.top + "px";
                resizeHandle.style.left = e.clientX + "px";
                resizeHandle.style.height = rect.height + "px";
                e.preventDefault();
            }
        });
    });

    document.addEventListener("mousemove", (e) => {
        if (isResizing && currentTh) {
            const diff = e.clientX - startX;
            const newWidth = Math.max(60, startWidth + diff);
            currentTh.style.width = newWidth + "px";
            currentTh.style.minWidth = newWidth + "px";
            resizeHandle.style.left = (e.clientX) + "px";
        }
    });

    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.style.display = "none";
            currentTh = null;
        }
    });
}

async function refreshCompanies() {
    clearMessages();
    try {
        invalidateHireCache(state.hireChannel || "boss");
        await ensureHireLoaded({ forceReload: true });
        showMessage("success", "列表已刷新，共 " + state.companies.length + " 条记录");
    } catch (error) {
        showMessage("error", "刷新失败: " + error.message);
    }
}

async function loadCompaniesByTimeFilter() {
    clearMessages();
    try {
        invalidateHireCache(state.hireChannel || "boss");
        await ensureHireLoaded({ forceReload: true });
    } catch (error) {
        showMessage("error", "加载失败: " + error.message);
    }
}

async function fixHistoryData() {
    clearMessages();
    try {
        const result = await requestJson("/api/companies/fix-history", { method: "POST" });
        showMessage("success", result.message || "修复完成");
        invalidateHireCache();
        await loadCompanies();
    } catch (error) {
        showMessage("error", "修复失败: " + error.message);
    }
}
