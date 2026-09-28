const state = {
    companies: [],
    editingId: null,
    summary: {},
    settings: {
        status_options: ["拒绝", "加微信", "在考虑"],
        industry_options: ["棋牌", "游戏", "互联网"],
    },
    timeFilter: "all",
    selectedStatuses: [],
    account: null,
    feature: "hire",
    hireChannel: "boss",
    channels: [],
    adminTab: "summary",
    adminImportTarget: null,
    adminImportMode: "merge",
    adminImportKind: "hire",
    blacklist: [],
    blacklistEditingId: null,
    page: 1,
    pageSize: 30,
};

function channelQuery(extra = "") {
    const channel = encodeURIComponent(state.hireChannel || "boss");
    const base = `channel=${channel}`;
    return extra ? `${extra}&${base}` : `?${base}`;
}

function currentChannelLabel() {
    const hit = (state.channels || []).find((item) => item.id === state.hireChannel);
    return hit ? hit.name : (state.hireChannel || "boss");
}

function updateChannelPageTitle() {
    const label = currentChannelLabel();
    const hireTitle = byId("hirePageTitle");
    const blacklistTitle = byId("blacklistPageTitle");
    if (hireTitle) hireTitle.textContent = label;
    if (blacklistTitle) blacklistTitle.textContent = label;
}

const AUTH_TOKEN_KEY = "boss_auth_token";

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function setAuthToken(token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

function clearAuthToken() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

function byId(id) {
    return document.getElementById(id);
}

function showMessage(kind, text) {
    const errorBox = byId("errorBox");
    const successBox = byId("successBox");
    errorBox.classList.add("d-none");
    successBox.classList.add("d-none");

    const box = kind === "error" ? errorBox : successBox;
    box.textContent = text;
    box.classList.remove("d-none");
}

function clearMessages() {
    byId("errorBox").classList.add("d-none");
    byId("successBox").classList.add("d-none");
}

async function requestJson(url, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {}),
    };
    const token = getAuthToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, {
        ...options,
        headers,
    });
    const data = await response.json().catch(() => ({}));
    // 仅在明确未登录/Token 无效时退出；不做定时鉴权探活
    if (response.status === 401 && !String(url).includes("/api/auth/login") && !String(url).includes("/api/auth/register")) {
        clearAuthToken();
        state.account = null;
        showLoginGate();
    }
    if (!response.ok) {
        throw new Error(data.message || "请求失败");
    }
    return data;
}

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
    byId("companyForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setSelectValues(selectId, values) {
    const select = byId(selectId);
    const options = Array.from(select.options);
    if (select.multiple) {
        const selected = new Set(values);
        options.forEach((opt) => {
            opt.selected = selected.has(opt.value);
        });
        return;
    }

    const selectedValue = values.find((value) => options.some((opt) => opt.value === value));
    select.value = selectedValue || "";
}

function populateSelectOptions(selectId, options, placeholder) {
    const select = byId(selectId);
    const selectedValues = Array.from(select.selectedOptions).map((option) => option.value).filter(Boolean);
    select.innerHTML = "";
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    select.appendChild(placeholderOption);

    options.forEach(opt => {
        const option = document.createElement("option");
        option.value = opt;
        option.textContent = opt;
        select.appendChild(option);
    });
    setSelectValues(selectId, selectedValues);
}

function parseDateValue(value) {
    if (value == null || value === "") {
        return null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const ms = value < 1e12 ? value * 1000 : value;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    if (/^\d{10,13}$/.test(text)) {
        const num = Number(text);
        const ms = text.length <= 10 ? num * 1000 : num;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function formatTimeParts(value) {
    const date = parseDateValue(value);
    if (!date) {
        return null;
    }
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mm = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());
    return {
        date: `${y}-${m}-${d}`,
        time: `${hh}:${mm}:${ss}`,
        text: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
    };
}

function formatTime(value) {
    const parts = formatTimeParts(value);
    if (!parts) {
        return value ? String(value) : "-";
    }
    return parts.text;
}

function formatTimeHtml(value) {
    const parts = formatTimeParts(value);
    if (!parts) {
        return escapeHtml(value ? String(value) : "-");
    }
    return `<div class="time-stack"><span>${parts.date}</span><span>${parts.time}</span></div>`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function flagLabel(value) {
    if (value === "yes") {
        return "是";
    }
    if (value === "no") {
        return "否";
    }
    return "未标记";
}

function hunterLabel(value) {
    if (value === "yes") {
        return "是猎头";
    }
    if (value === "no") {
        return "不是猎头";
    }
    return "未标记";
}

function outsourcedLabel(value) {
    if (value === "yes") {
        return "是外包";
    }
    if (value === "no") {
        return "不是外包";
    }
    return "未标记";
}

function interviewLabel(value) {
    return value === "yes" ? "已面试" : "未面试";
}

function interviewFlagClass(value) {
    return value === "yes" ? "yes" : "no";
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
                <div class="row-actions">
                    <button class="btn btn-sm btn-outline-primary" data-action="edit">编辑</button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delete">删除</button>
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
    renderSummary(await requestJson(`/api/summary${channelQuery()}`));
}

async function loadCompanies() {
    const data = await requestJson(`/api/companies?time_filter=${encodeURIComponent(state.timeFilter)}&channel=${encodeURIComponent(state.hireChannel || "boss")}`);
    state.companies = data.items || [];
    resetCompanyPage();
    renderCompanies();
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
        await loadSummary();
        await loadCompanies();
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
        await loadSummary();
        await loadCompanies();
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function importCompanies() {
    clearMessages();
    const text = byId("bulkImportInput").value;
    byId("importButton").disabled = true;
    try {
        const result = await requestJson("/api/companies/import", {
            method: "POST",
            body: JSON.stringify({ text, channel: state.hireChannel || "boss" }),
        });
        byId("bulkImportInput").value = "";
        showMessage("success", result.message || "导入完成");
        renderSummary(result.summary || {});
        state.companies = result.items || [];
        renderCompanies();
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        byId("importButton").disabled = false;
    }
}

let lastImportMode = "merge"; // "merge" or "overwrite"

async function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (lastImportMode === "overwrite") {
        const confirmed = window.confirm("导入并覆盖会用所选文件完全替换当前账号的公司数据，且不可撤销。确定继续？");
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
    if (btn) btn.disabled = true;
    try {
        const result = await requestJson("/api/backup", { method: "POST" });
        const payload = result.payload || {};
        const filename = result.filename || `backup_${Date.now()}.json`;
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
        showMessage("success", (result.message || "备份完成") + "。可用「导入备份」增量合并，或「导入并覆盖」完全替换");
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
    if (error) error.textContent = "";
    if (input) input.value = "";
    syncClearConfirmButton();
    modal.classList.remove("d-none");
    modal.style.display = "flex";
    if (input) input.focus();
}

function closeClearCompaniesModal() {
    const modal = byId("clearCompaniesModal");
    modal.style.display = "none";
    modal.classList.add("d-none");
    byId("clearConfirmInput").value = "";
    byId("clearCompaniesError").textContent = "";
    syncClearConfirmButton();
}

function syncClearConfirmButton() {
    const input = byId("clearConfirmInput");
    const btn = byId("confirmClearCompaniesBtn");
    if (!input || !btn) return;
    btn.disabled = input.value.trim() !== "确认清空";
}

async function confirmClearCompanies() {
    const input = byId("clearConfirmInput");
    const error = byId("clearCompaniesError");
    const btn = byId("confirmClearCompaniesBtn");
    if (!input || input.value.trim() !== "确认清空") {
        if (error) error.textContent = "请输入「确认清空」后再继续";
        return;
    }
    if (btn) btn.disabled = true;
    if (error) error.textContent = "";
    clearMessages();
    try {
        const result = await requestJson("/api/companies/clear", { method: "POST" });
        closeClearCompaniesModal();
        showMessage("success", result.message || "已清空公司记录");
        renderSummary(result.summary || {});
        state.companies = result.items || [];
        renderCompanies();
        resetForm();
    } catch (err) {
        if (error) error.textContent = err.message;
        syncClearConfirmButton();
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

async function loadVersion() {
    const el = byId("appVersion");
    if (!el) return;
    try {
        const data = await requestJson("/api/version");
        if (data.version) {
            el.textContent = data.version;
        }
    } catch (e) {
        // 保留模板中的默认版本号
    }
}

async function boot() {
    bindAccountEvents();
    bindFeatureTabs();
    const user = await restoreSession();
    if (!user) {
        showLoginGate();
        return;
    }
    hideLoginGate();
    applyAccount(user);
    await openWorkspace();
}

function bindFeatureTabs() {
    document.querySelectorAll(".feature-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const feature = btn.dataset.feature || "hire";
            const group = btn.closest(".feature-group");
            // 已选中时再点：只手动展开/收起，不联动关掉其他分组
            if (state.feature === feature) {
                group?.classList.toggle("is-open");
                return;
            }
            switchFeature(feature);
        });
    });
}

function bindChannelSubtabs() {
    document.querySelectorAll(".feature-subtab").forEach((btn) => {
        btn.onclick = (event) => {
            event.stopPropagation();
            const channel = btn.dataset.channel || "boss";
            const group = btn.closest(".feature-group");
            const feature = (group && group.dataset.featureGroup) || state.feature || "hire";
            if (state.feature !== feature) {
                switchFeature(feature, channel);
            } else {
                switchHireChannel(channel);
            }
        };
    });
}

async function loadChannels() {
    const data = await requestJson("/api/channels");
    state.channels = data.items || [];
    if (!state.channels.length) {
        state.channels = [{ id: "boss", name: "boss" }];
    }
    if (!state.channels.some((item) => item.id === state.hireChannel)) {
        state.hireChannel = state.channels[0].id;
    }
    renderChannelTabs();
}

function renderChannelTabs() {
    ["hireSubrail", "blacklistSubrail"].forEach((railId) => {
        const rail = byId(railId);
        if (!rail) return;
        rail.replaceChildren();
        state.channels.forEach((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "feature-subtab";
            btn.dataset.channel = item.id;
            btn.setAttribute("role", "tab");
            btn.setAttribute("aria-selected", "false");
            btn.textContent = item.name || item.id;
            rail.appendChild(btn);
        });
    });
    bindChannelSubtabs();
    syncChannelSubtabActive();
    updateChannelPageTitle();
    const workspace = byId("hireChannelWorkspace");
    if (workspace) {
        workspace.dataset.channel = state.hireChannel || "boss";
        workspace.hidden = false;
        workspace.classList.add("is-active");
    }
}

/** 只有当前大页面下的渠道子页签显示选中；其他大页面展开时渠道不带 active。 */
function syncChannelSubtabActive() {
    const channel = state.hireChannel || "boss";
    document.querySelectorAll(".feature-group").forEach((group) => {
        const inActiveFeature = group.dataset.featureGroup === state.feature;
        group.querySelectorAll(".feature-subtab").forEach((btn) => {
            const active = inActiveFeature && btn.dataset.channel === channel;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-selected", active ? "true" : "false");
        });
    });
}

function switchFeature(feature, channel) {
    state.feature = feature === "blacklist" ? "blacklist" : "hire";
    document.querySelectorAll(".feature-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.feature === state.feature);
    });
    // 点开哪个就保持哪个展开；切换功能页时不自动收起其他分组
    document.querySelectorAll(".feature-group").forEach((group) => {
        if (group.dataset.featureGroup === state.feature) {
            group.classList.add("is-open");
        }
    });
    document.querySelectorAll(".feature-panel").forEach((panel) => {
        const active = panel.dataset.feature === state.feature;
        panel.classList.toggle("is-active", active);
        panel.hidden = !active;
    });
    // 点大页：默认选中该页下第一个渠道；点具体子页签时传入 channel 则沿用
    const firstChannel = (state.channels[0] && state.channels[0].id) || "boss";
    const nextChannel = channel || firstChannel;
    if (state.feature === "blacklist") {
        switchHireChannel(nextChannel, { reloadHire: false });
        loadBlacklist().catch((error) => showMessage("error", error.message));
        return;
    }
    switchHireChannel(nextChannel);
}

function switchHireChannel(channel, options = {}) {
    const reloadHire = options.reloadHire !== false;
    const ids = (state.channels || []).map((item) => item.id);
    const next = ids.includes(channel) ? channel : (ids[0] || "boss");
    const changed = state.hireChannel !== next;
    state.hireChannel = next;

    syncChannelSubtabActive();
    updateChannelPageTitle();

    const workspace = byId("hireChannelWorkspace");
    if (workspace) {
        workspace.dataset.channel = next;
        workspace.hidden = false;
        workspace.classList.add("is-active");
    }

    if (state.feature === "blacklist") {
        if (changed || options.forceReload) {
            loadBlacklist().catch((error) => showMessage("error", error.message));
        }
        return;
    }

    if (reloadHire && (changed || !state.companies.length || options.forceReload)) {
        loadSummary().catch((error) => showMessage("error", error.message));
        loadCompanies().catch((error) => showMessage("error", error.message));
    }
}

let workspaceReady = false;
let blacklistReady = false;

async function openWorkspace() {
    if (!workspaceReady) {
        workspaceReady = true;
        byId("companyForm").addEventListener("submit", submitCompany);
        byId("cancelEditButton").addEventListener("click", resetForm);
        byId("importButton").addEventListener("click", importCompanies);
        byId("importDataBtn").addEventListener("click", () => { setImportMode("merge"); byId("importFileInput").click(); });
        byId("importOverwriteBtn").addEventListener("click", () => { setImportMode("overwrite"); byId("importFileInput").click(); });
        byId("importFileInput").addEventListener("change", handleImportFile);
        byId("backupBtn").addEventListener("click", createBackup);
        byId("clearCompaniesBtn").addEventListener("click", openClearCompaniesModal);
        byId("cancelClearCompaniesBtn").addEventListener("click", closeClearCompaniesModal);
        byId("confirmClearCompaniesBtn").addEventListener("click", confirmClearCompanies);
        byId("clearConfirmInput").addEventListener("input", syncClearConfirmButton);
        byId("exportCsvBtn").addEventListener("click", () => exportCurrentAccount("/api/companies/export.csv", "csv"));
        // 备份文件请用「导入备份 / 导入并覆盖」，不再单独提供还原按钮

        byId("addStatusButton").addEventListener("click", addStatusOption);
        byId("addIndustryButton").addEventListener("click", addIndustryOption);
        byId("searchInput").addEventListener("input", () => {
            resetCompanyPage();
            renderCompanies();
        });
        byId("statusFilterBtn").addEventListener("click", toggleStatusFilterMenu);
        byId("hunterFilter").addEventListener("change", () => {
            resetCompanyPage();
            renderCompanies();
        });
        byId("outsourcedFilter").addEventListener("change", () => {
            resetCompanyPage();
            renderCompanies();
        });
        byId("saveProxyBtn").addEventListener("click", saveProxy);
        byId("proxyEnableCheck").addEventListener("change", toggleProxyInput);
        byId("refreshCompaniesBtn").addEventListener("click", refreshCompanies);
        document.querySelectorAll(".time-filter-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll(".time-filter-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                state.timeFilter = btn.dataset.filter;
                loadCompaniesByTimeFilter();
            });
        });
        byId("fixHistoryBtn").addEventListener("click", fixHistoryData);
        setupWorkspaceResize();
        setupTableDragResize();
        setupColumnHintTips();
        bindCompanyPager();
        bindBlacklistEvents();
    }
    state.companies = [];
    try {
        await loadVersion();
        await loadChannels();
        await loadProxySettings();
        await loadSummary();
        await loadCompanies();
        if (state.feature === "blacklist") {
            await loadBlacklist();
        }
    } catch (error) {
        showMessage("error", error.message);
    }
}

function bindBlacklistEvents() {
    if (blacklistReady) return;
    blacklistReady = true;
    byId("blacklistForm").addEventListener("submit", submitBlacklist);
    byId("blacklistCancelBtn").addEventListener("click", resetBlacklistForm);
    byId("blacklistSearchBtn").addEventListener("click", () => loadBlacklist());
    byId("blacklistRefreshBtn").addEventListener("click", () => {
        byId("blacklistSearchInput").value = "";
        loadBlacklist();
    });
    byId("blacklistSearchInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            loadBlacklist();
        }
    });
}

async function loadBlacklist() {
    const q = byId("blacklistSearchInput").value.trim();
    const channel = encodeURIComponent(state.hireChannel || "boss");
    const data = await requestJson(`/api/blacklist?q=${encodeURIComponent(q)}&channel=${channel}`);
    state.blacklist = data.items || [];
    renderBlacklistSummary(data.summary || {});
    renderBlacklist();
}

function renderBlacklistSummary(summary) {
    byId("blacklistCount").textContent = summary.blacklist_count ?? state.blacklist.length;
    byId("blacklistLastUpdated").textContent = formatTime(summary.last_updated_at) || "-";
}

function renderBlacklist() {
    const tbody = byId("blacklistTableBody");
    tbody.replaceChildren();
    if (!state.blacklist.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">暂无匹配的黑名单记录</td></tr>';
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
    byId("blacklistNameInput").focus();
}

function resetBlacklistForm() {
    state.blacklistEditingId = null;
    byId("blacklistForm").reset();
    byId("blacklistSubmitBtn").textContent = "加入黑名单";
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
            result = await requestJson(`/api/blacklist/${state.blacklistEditingId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
        } else {
            result = await requestJson("/api/blacklist", {
                method: "POST",
                body: JSON.stringify(payload),
            });
        }
        showMessage("success", result.message || "已保存");
        resetBlacklistForm();
        state.blacklist = result.items || [];
        renderBlacklistSummary(result.summary || {});
        renderBlacklist();
    } catch (error) {
        showMessage("error", error.message);
    } finally {
        byId("blacklistSubmitBtn").disabled = false;
    }
}

async function deleteBlacklistItem(item) {
    if (!window.confirm(`确定将「${item.company_name}」移出黑名单吗？`)) {
        return;
    }
    clearMessages();
    try {
        const channel = encodeURIComponent(state.hireChannel || "boss");
        const result = await requestJson(`/api/blacklist/${item.id}?channel=${channel}`, { method: "DELETE" });
        showMessage("success", result.message || "已移出");
        if (state.blacklistEditingId === item.id) {
            resetBlacklistForm();
        }
        state.blacklist = result.items || [];
        renderBlacklistSummary(result.summary || {});
        renderBlacklist();
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function exportCurrentAccount(path, ext) {
    clearMessages();
    try {
        await downloadAccountExport(path, ext);
        if (ext === "csv") {
            showMessage("success", "已导出当前账号公司记录（CSV 不含账号信息）");
        } else {
            showMessage("success", "已导出当前账号的公司记录");
        }
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function downloadAccountExport(path, ext) {
    const username = (state.account && state.account.username) || "account";
    const token = getAuthToken();
    const response = await fetch(path, {
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
    link.download = `${username}-companies.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function loadProxySettings() {
    try {
        const data = await requestJson("/api/proxy");
        const proxyUrl = data.proxy_url || "";
        const check = byId("proxyEnableCheck");
        const input = byId("proxyInput");
        const btn = byId("saveProxyBtn");
        const status = byId("proxyStatus");

        if (proxyUrl) {
            check.checked = true;
            input.classList.remove("d-none");
            btn.classList.remove("d-none");
            input.value = proxyUrl;
            status.textContent = "✓ 代理已配置";
            status.className = "proxy-status ok";
        } else {
            check.checked = false;
            input.classList.add("d-none");
            btn.classList.add("d-none");
            input.value = "";
            status.textContent = "";
            status.className = "proxy-status ok";
        }

        if (data.using_fallback) {
            status.textContent = "⚠️ 使用本地存储（Redis 不可用）";
            status.className = "proxy-status warn";
        }
    } catch (e) {
        // 顶部代理条常驻，失败时不隐藏
    }
}

function toggleProxyInput() {
    const check = byId("proxyEnableCheck");
    const input = byId("proxyInput");
    const btn = byId("saveProxyBtn");

    if (check.checked) {
        input.classList.remove("d-none");
        btn.classList.remove("d-none");
        input.focus();
    } else {
        input.classList.add("d-none");
        btn.classList.add("d-none");
        // 取消勾选时清除代理
        byId("proxyInput").value = "";
        requestJson("/api/proxy", {
            method: "POST",
            body: JSON.stringify({ proxy_url: "" }),
        }).catch(() => {});
    }
}

async function saveProxy() {
    const proxyUrl = byId("proxyInput").value.trim();
    if (!proxyUrl) {
        showMessage("error", "请输入代理地址");
        return;
    }
    clearMessages();
    try {
        const result = await requestJson("/api/proxy", {
            method: "POST",
            body: JSON.stringify({ proxy_url: proxyUrl }),
        });
        showMessage("success", result.message + "，请刷新页面或重启应用。");
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function refreshCompanies() {
    clearMessages();
    try {
        const data = await requestJson(`/api/companies?time_filter=${encodeURIComponent(state.timeFilter)}&channel=${encodeURIComponent(state.hireChannel || "boss")}`);
        state.companies = data.items || [];
        resetCompanyPage();
        renderCompanies();
        showMessage("success", "列表已刷新，共 " + state.companies.length + " 条记录");
    } catch (error) {
        showMessage("error", "刷新失败: " + error.message);
    }
}

async function loadCompaniesByTimeFilter() {
    clearMessages();
    try {
        const data = await requestJson(`/api/companies?time_filter=${encodeURIComponent(state.timeFilter)}&channel=${encodeURIComponent(state.hireChannel || "boss")}`);
        state.companies = data.items || [];
        resetCompanyPage();
        renderCompanies();
    } catch (error) {
        showMessage("error", "加载失败: " + error.message);
    }
}

async function fixHistoryData() {
    clearMessages();
    try {
        const result = await requestJson("/api/companies/fix-history", { method: "POST" });
        showMessage("success", result.message || "修复完成");
        await loadCompanies();
    } catch (error) {
        showMessage("error", "修复失败: " + error.message);
    }
}

document.addEventListener("DOMContentLoaded", boot);

function showLoginGate() {
    byId("loginGate").classList.remove("d-none");
    byId("loginGate").style.display = "flex";
}

function hideLoginGate() {
    byId("loginGate").style.display = "none";
}

function applyAccount(user) {
    state.account = user;
    const label = byId("currentUserLabel");
    if (label) {
        label.textContent = `${user.displayName || user.username}（${user.role === "admin" ? "管理员" : "账号"}）`;
    }
    byId("accountAdminBtn").classList.toggle("d-none", user.role !== "admin");
}

async function restoreSession() {
    if (!getAuthToken()) {
        return null;
    }
    try {
        const data = await requestJson("/api/auth/me");
        return data.user || null;
    } catch (error) {
        return null;
    }
}

function openAccountAdmin() {
    const modal = byId("accountAdmin");
    if (!modal) return;
    modal.classList.add("is-open");
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    switchAdminTab(state.adminTab || "summary");
    refreshAdminPane().catch((error) => {
        byId("accountAdminError").textContent = error.message;
    });
}

function switchAdminTab(tab) {
    state.adminTab = tab;
    document.querySelectorAll(".admin-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.adminTab === tab);
    });
    document.querySelectorAll(".admin-pane").forEach((pane) => {
        const active = pane.dataset.adminPane === tab;
        pane.classList.toggle("is-active", active);
        pane.hidden = !active;
    });
}

async function refreshAdminPane() {
    byId("accountAdminError").textContent = "";
    if (state.adminTab === "channels") {
        await loadAdminChannels();
        return;
    }
    if (state.adminTab === "accounts") {
        await loadAccounts();
        return;
    }
    await loadAdminSummary();
}

async function loadAdminSummary() {
    const data = await requestJson("/api/admin/summary");
    const metrics = byId("adminSummaryMetrics");
    const totals = data.totals || {};
    metrics.innerHTML = `
        <article><span>账号数</span><strong>${totals.user_count ?? 0}</strong></article>
        <article><span>登记总数</span><strong>${totals.company_count ?? 0}</strong></article>
        <article><span>渠道数</span><strong>${totals.channel_count ?? 0}</strong></article>
    `;
    const body = byId("adminSummaryBody");
    body.replaceChildren();
    (data.users || []).forEach((user) => {
        const row = document.createElement("tr");
        const byChannel = user.by_channel || {};
        const channelText = Object.keys(byChannel).length
            ? Object.entries(byChannel).map(([k, v]) => `${k}:${v}`).join(" · ")
            : "-";
        row.innerHTML = "<td></td><td></td><td></td><td></td><td></td>";
        row.children[0].textContent = `${user.username}${user.displayName ? `（${user.displayName}）` : ""}`;
        row.children[1].textContent = user.role === "admin" ? "管理员" : "普通";
        row.children[2].textContent = String(user.company_count ?? 0);
        row.children[3].textContent = String(user.blacklist_count ?? 0);
        row.children[4].textContent = channelText;
        body.appendChild(row);
    });
}

async function loadAdminChannels() {
    const summary = await requestJson("/api/admin/summary");
    const residual = (summary.totals && summary.totals.by_channel) || {};
    state.channels = summary.channels || [];
    const body = byId("adminChannelBody");
    body.replaceChildren();
    (state.channels || []).forEach((item) => {
        const row = document.createElement("tr");
        const action = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn btn-sm btn-outline-danger";
        delBtn.textContent = "删除页签";
        delBtn.addEventListener("click", async () => {
            const count = residual[item.id] || 0;
            const tip = count
                ? `移除渠道「${item.name}」？各账号共 ${count} 条公司数据将保留为残留，不会删除。`
                : `移除渠道「${item.name}」？`;
            if (!window.confirm(tip)) return;
            try {
                const result = await requestJson(`/api/channels/${encodeURIComponent(item.id)}`, { method: "DELETE" });
                byId("accountAdminError").textContent = result.message || "已删除";
                await loadChannels();
                await loadAdminChannels();
                await switchHireChannel(state.hireChannel);
            } catch (error) {
                byId("accountAdminError").textContent = error.message;
            }
        });
        action.appendChild(delBtn);
        row.innerHTML = "<td></td><td></td><td></td><td></td>";
        row.children[0].textContent = item.id;
        row.children[1].textContent = item.name || item.id;
        row.children[2].textContent = String(residual[item.id] || 0);
        row.children[3].replaceWith(action);
        body.appendChild(row);
    });
    renderChannelTabs();
}

function closeAccountAdmin() {
    const modal = byId("accountAdmin");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    byId("accountAdminError").textContent = "";
}

function bindAccountEvents() {
    byId("loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        byId("loginError").textContent = "";
        try {
            const result = await requestJson("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({
                    username: byId("loginUsername").value.trim(),
                    password: byId("loginPassword").value,
                }),
            });
            setAuthToken(result.token);
            hideLoginGate();
            applyAccount(result.user);
            await openWorkspace();
        } catch (error) {
            byId("loginError").textContent = error.message;
        }
    });
    byId("registerForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        byId("registerError").textContent = "";
        try {
            const result = await requestJson("/api/auth/register", {
                method: "POST",
                body: JSON.stringify({
                    username: byId("registerUsername").value.trim(),
                    displayName: byId("registerDisplayName").value.trim(),
                    password: byId("registerPassword").value,
                }),
            });
            setAuthToken(result.token);
            hideLoginGate();
            applyAccount(result.user);
            await openWorkspace();
        } catch (error) {
            byId("registerError").textContent = error.message;
        }
    });
    byId("showRegisterBtn").addEventListener("click", () => {
        byId("loginForm").classList.add("d-none");
        byId("registerForm").classList.remove("d-none");
    });
    byId("showLoginBtn").addEventListener("click", () => {
        byId("registerForm").classList.add("d-none");
        byId("loginForm").classList.remove("d-none");
    });
    byId("logoutBtn").addEventListener("click", async () => {
        try {
            await requestJson("/api/auth/logout", { method: "POST" });
        } catch (error) {
            // 本地退出即可
        }
        clearAuthToken();
        state.account = null;
        state.companies = [];
        renderCompanies();
        showLoginGate();
    });
    byId("accountAdminBtn").addEventListener("click", () => {
        openAccountAdmin();
    });
    byId("closeAccountAdminBtn").addEventListener("click", () => {
        closeAccountAdmin();
    });
    document.querySelectorAll(".admin-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            switchAdminTab(btn.dataset.adminTab || "summary");
            refreshAdminPane().catch((error) => {
                byId("accountAdminError").textContent = error.message;
            });
        });
    });
    byId("createChannelForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        byId("accountAdminError").textContent = "";
        try {
            await requestJson("/api/channels", {
                method: "POST",
                body: JSON.stringify({
                    name: byId("newChannelName").value.trim(),
                    id: byId("newChannelId").value.trim() || undefined,
                }),
            });
            byId("createChannelForm").reset();
            await loadChannels();
            await loadAdminChannels();
        } catch (error) {
            byId("accountAdminError").textContent = error.message;
        }
    });
    byId("adminImportFileInput").addEventListener("change", handleAdminImportFile);
    byId("accountAdmin").addEventListener("click", (event) => {
        if (event.target === byId("accountAdmin")) {
            closeAccountAdmin();
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && byId("accountAdmin").classList.contains("is-open")) {
            closeAccountAdmin();
        }
    });
    byId("cancelResetPasswordBtn").addEventListener("click", closeResetPasswordModal);
    byId("confirmResetPasswordBtn").addEventListener("click", confirmResetPassword);
    byId("createAccountForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        byId("accountAdminError").textContent = "";
        try {
            await requestJson("/api/auth/users", {
                method: "POST",
                body: JSON.stringify({
                    username: byId("newAccountUsername").value.trim(),
                    displayName: byId("newAccountDisplayName").value.trim(),
                    password: byId("newAccountPassword").value,
                    role: byId("newAccountRole").value,
                }),
            });
            byId("createAccountForm").reset();
            await loadAccounts();
        } catch (error) {
            byId("accountAdminError").textContent = error.message;
        }
    });
}

async function loadAccounts() {
    const data = await requestJson("/api/auth/users");
    const body = byId("accountTableBody");
    body.replaceChildren();
    (data.users || []).forEach((user) => {
        const card = document.createElement("article");
        card.className = "admin-account-card";

        const head = document.createElement("div");
        head.className = "admin-account-head";
        const title = document.createElement("div");
        title.className = "admin-account-title";
        title.innerHTML = `<strong></strong><span></span>`;
        title.querySelector("strong").textContent = user.username;
        title.querySelector("span").textContent = user.displayName || "未设置显示名";
        const meta = document.createElement("div");
        meta.className = "admin-account-meta";
        meta.textContent = `${user.role === "admin" ? "管理员" : "普通账号"} · ${user.locked ? "已锁定" : "正常"}`;
        head.append(title, meta);
        card.appendChild(head);

        const hireGroup = document.createElement("div");
        hireGroup.className = "admin-action-group";
        hireGroup.innerHTML = `<div class="admin-action-label">投递登记</div>`;
        const hireActions = document.createElement("div");
        hireActions.className = "admin-action-btns";
        hireActions.append(
            makeAdminBtn("导出登记备份", "btn-outline-success", () => exportAccountBackup(user)),
            makeAdminBtn("导出登记CSV", "btn-outline-secondary", () => exportAccountCsv(user)),
            makeAdminBtn("导入登记合并", "btn-outline-primary", () => pickAdminImport(user, "merge", "hire")),
            makeAdminBtn("导入登记覆盖", "btn-outline-warning", () => pickAdminImport(user, "overwrite", "hire")),
        );
        hireGroup.appendChild(hireActions);

        const blackGroup = document.createElement("div");
        blackGroup.className = "admin-action-group";
        blackGroup.innerHTML = `<div class="admin-action-label">企业黑名单</div>`;
        const blackActions = document.createElement("div");
        blackActions.className = "admin-action-btns";
        blackActions.append(
            makeAdminBtn("导出黑名单", "btn-outline-success", () => exportAccountBlacklist(user)),
            makeAdminBtn("导出黑名单CSV", "btn-outline-secondary", () => exportAccountBlacklistCsv(user)),
            makeAdminBtn("导入黑名单合并", "btn-outline-primary", () => pickAdminImport(user, "merge", "blacklist")),
            makeAdminBtn("导入黑名单覆盖", "btn-outline-warning", () => pickAdminImport(user, "overwrite", "blacklist")),
        );
        blackGroup.appendChild(blackActions);

        const accountGroup = document.createElement("div");
        accountGroup.className = "admin-action-group";
        accountGroup.innerHTML = `<div class="admin-action-label">账号</div>`;
        const accountActions = document.createElement("div");
        accountActions.className = "admin-action-btns";
        accountActions.appendChild(makeAdminBtn("重置密码", "btn-outline-primary", () => openResetPasswordModal(user)));
        if (!user.legacyStore) {
            accountActions.append(
                makeAdminBtn(user.locked ? "解锁" : "锁定", "btn-outline-warning", async () => {
                    await requestJson(`/api/auth/users/${user.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ locked: !user.locked }),
                    });
                    await loadAccounts();
                }),
                makeAdminBtn("删除账号", "btn-outline-danger", async () => {
                    if (!window.confirm(`删除账号「${user.username}」？登记与黑名单残留数据不会自动并入其他账号。`)) {
                        return;
                    }
                    await requestJson(`/api/auth/users/${user.id}`, { method: "DELETE" });
                    await loadAccounts();
                }),
            );
        } else {
            const tip = document.createElement("span");
            tip.className = "muted-line";
            tip.textContent = "默认管理员";
            accountActions.appendChild(tip);
        }
        accountGroup.appendChild(accountActions);

        card.append(hireGroup, blackGroup, accountGroup);
        body.appendChild(card);
    });
}

function makeAdminBtn(text, styleClass, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-sm ${styleClass}`;
    btn.textContent = text;
    btn.addEventListener("click", onClick);
    return btn;
}

let resetPasswordTarget = null;

function openResetPasswordModal(user) {
    resetPasswordTarget = user;
    byId("resetPasswordTargetLabel").textContent = `${user.username}${user.displayName ? `（${user.displayName}）` : ""}`;
    byId("resetPasswordInput").value = "";
    byId("resetPasswordConfirmInput").value = "";
    byId("resetPasswordError").textContent = "";
    const modal = byId("resetPasswordModal");
    modal.classList.remove("d-none");
    modal.style.display = "flex";
    byId("resetPasswordInput").focus();
}

function closeResetPasswordModal() {
    const modal = byId("resetPasswordModal");
    modal.style.display = "none";
    modal.classList.add("d-none");
    resetPasswordTarget = null;
    byId("resetPasswordInput").value = "";
    byId("resetPasswordConfirmInput").value = "";
    byId("resetPasswordError").textContent = "";
}

async function confirmResetPassword() {
    const error = byId("resetPasswordError");
    if (!resetPasswordTarget) {
        return;
    }
    const password = byId("resetPasswordInput").value;
    const confirm = byId("resetPasswordConfirmInput").value;
    error.textContent = "";
    if (password.length < 2) {
        error.textContent = "密码至少 2 个字符";
        return;
    }
    if (password !== confirm) {
        error.textContent = "两次输入的密码不一致";
        return;
    }
    const btn = byId("confirmResetPasswordBtn");
    btn.disabled = true;
    try {
        await requestJson(`/api/auth/users/${resetPasswordTarget.id}`, {
            method: "PUT",
            body: JSON.stringify({ password }),
        });
        closeResetPasswordModal();
        byId("accountAdminError").textContent = "";
        showMessage("success", "密码已重置");
        await loadAccounts();
    } catch (err) {
        error.textContent = err.message;
    } finally {
        btn.disabled = false;
    }
}

async function exportAccountBackup(user) {
    byId("accountAdminError").textContent = "";
    try {
        await downloadAuthedFile(
            `/api/auth/users/${user.id}/export`,
            `hire-backup_${user.username || "account"}.json`
        );
        showMessage("success", `已导出账号「${user.username}」的登记备份`);
    } catch (error) {
        byId("accountAdminError").textContent = error.message;
    }
}

async function exportAccountCsv(user) {
    byId("accountAdminError").textContent = "";
    try {
        await downloadAuthedFile(
            `/api/auth/users/${user.id}/export.csv`,
            `${user.username || "account"}-hire-companies.csv`
        );
        showMessage("success", `已导出账号「${user.username}」的登记 CSV`);
    } catch (error) {
        byId("accountAdminError").textContent = error.message;
    }
}

async function exportAccountBlacklist(user) {
    byId("accountAdminError").textContent = "";
    try {
        await downloadAuthedFile(
            `/api/auth/users/${user.id}/blacklist/export`,
            `blacklist-backup_${user.username || "account"}.json`
        );
        showMessage("success", `已导出账号「${user.username}」的黑名单备份`);
    } catch (error) {
        byId("accountAdminError").textContent = error.message;
    }
}

async function exportAccountBlacklistCsv(user) {
    byId("accountAdminError").textContent = "";
    try {
        await downloadAuthedFile(
            `/api/auth/users/${user.id}/blacklist/export.csv`,
            `${user.username || "account"}-blacklist.csv`
        );
        showMessage("success", `已导出账号「${user.username}」的黑名单 CSV`);
    } catch (error) {
        byId("accountAdminError").textContent = error.message;
    }
}

async function downloadAuthedFile(path, fallbackName) {
    const token = getAuthToken();
    const response = await fetch(path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "下载失败");
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const matched = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/i);
    let filename = fallbackName;
    if (matched && matched[1]) {
        filename = matched[1].replace(/['"]/g, "").trim() || fallbackName;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}


function pickAdminImport(user, mode, kind = "hire") {
    state.adminImportTarget = user;
    state.adminImportMode = mode === "overwrite" ? "overwrite" : "merge";
    state.adminImportKind = kind === "blacklist" ? "blacklist" : "hire";
    byId("adminImportFileInput").value = "";
    byId("adminImportFileInput").click();
}

async function handleAdminImportFile(event) {
    const file = event.target.files[0];
    const user = state.adminImportTarget;
    if (!file || !user) return;
    const kind = state.adminImportKind === "blacklist" ? "blacklist" : "hire";
    const kindLabel = kind === "blacklist" ? "黑名单" : "登记";
    if (state.adminImportMode === "overwrite") {
        const ok = window.confirm(`导入并覆盖会替换账号「${user.username}」的${kindLabel}数据，确定继续？`);
        if (!ok) {
            event.target.value = "";
            return;
        }
    }
    byId("accountAdminError").textContent = "";
    const reader = new FileReader();
    reader.onload = async (e) => {
        const textContent = e.target.result;
        let endpoint;
        if (kind === "blacklist") {
            endpoint = state.adminImportMode === "overwrite"
                ? `/api/auth/users/${user.id}/blacklist/import-overwrite`
                : `/api/auth/users/${user.id}/blacklist/import`;
        } else {
            endpoint = state.adminImportMode === "overwrite"
                ? `/api/auth/users/${user.id}/import-overwrite`
                : `/api/auth/users/${user.id}/import`;
        }
        try {
            const result = await requestJson(endpoint, {
                method: "POST",
                body: JSON.stringify({ text: textContent }),
            });
            byId("accountAdminError").textContent = result.message || "导入完成";
            await refreshAdminPane();
            if (state.account && state.account.id === user.id) {
                if (kind === "blacklist") {
                    await loadBlacklist();
                } else {
                    await loadSummary();
                    await loadCompanies();
                }
            }
        } catch (error) {
            byId("accountAdminError").textContent = error.message;
        } finally {
            event.target.value = "";
            state.adminImportTarget = null;
            state.adminImportKind = "hire";
        }
    };
    reader.readAsText(file, "utf-8");
}
