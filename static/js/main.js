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
};

// 页面闲置时定时续期会话，保证开着一天不刷新也不掉登录
const SESSION_KEEPALIVE_MS = 30 * 60 * 1000;
let sessionKeepaliveTimer = null;
let sessionVisibilityBound = false;

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
    const token = sessionStorage.getItem("boss_auth_token");
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, {
        ...options,
        headers,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
        sessionStorage.removeItem("boss_auth_token");
        state.account = null;
        stopSessionKeepalive();
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
    tbody.innerHTML = "";

    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">暂无匹配记录</td></tr>';
        return;
    }

    items.forEach((item) => {
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
    renderSummary(await requestJson("/api/summary"));
}

async function loadCompanies() {
    const data = await requestJson("/api/companies?time_filter=" + state.timeFilter);
    state.companies = data.items || [];
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
        const result = await requestJson(`/api/companies/${item.id}`, { method: "DELETE" });
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
            body: JSON.stringify({ text }),
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
                body: JSON.stringify({ text }),
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
    const user = await restoreSession();
    if (!user) {
        showLoginGate();
        return;
    }
    hideLoginGate();
    applyAccount(user);
    await openWorkspace();
}

let workspaceReady = false;

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
        byId("searchInput").addEventListener("input", renderCompanies);
        byId("statusFilterBtn").addEventListener("click", toggleStatusFilterMenu);
        byId("hunterFilter").addEventListener("change", renderCompanies);
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
    }
    state.companies = [];
    try {
        await loadVersion();
        await loadProxySettings();
        await loadSummary();
        await loadCompanies();
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
    const token = sessionStorage.getItem("boss_auth_token");
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

        byId("proxyBar").style.display = "flex";

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
        byId("proxyBar").style.display = "flex";
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
        const data = await requestJson("/api/companies?time_filter=" + state.timeFilter);
        state.companies = data.items || [];
        renderCompanies();
        showMessage("success", "列表已刷新，共 " + state.companies.length + " 条记录");
    } catch (error) {
        showMessage("error", "刷新失败: " + error.message);
    }
}

async function loadCompaniesByTimeFilter() {
    clearMessages();
    try {
        const data = await requestJson("/api/companies?time_filter=" + state.timeFilter);
        state.companies = data.items || [];
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
    startSessionKeepalive();
}

function stopSessionKeepalive() {
    if (sessionKeepaliveTimer) {
        clearInterval(sessionKeepaliveTimer);
        sessionKeepaliveTimer = null;
    }
}

function startSessionKeepalive() {
    stopSessionKeepalive();
    if (!sessionStorage.getItem("boss_auth_token")) {
        return;
    }
    sessionKeepaliveTimer = setInterval(() => {
        keepSessionAlive();
    }, SESSION_KEEPALIVE_MS);
    if (!sessionVisibilityBound) {
        sessionVisibilityBound = true;
        document.addEventListener("visibilitychange", onSessionVisibility);
    }
}

async function keepSessionAlive() {
    if (!sessionStorage.getItem("boss_auth_token") || !state.account) {
        stopSessionKeepalive();
        return;
    }
    try {
        const data = await requestJson("/api/auth/me");
        if (data.user) {
            state.account = data.user;
        }
    } catch (error) {
        // 401 时 requestJson 已清 token 并弹登录；其它错误忽略，下次再试
        if (!sessionStorage.getItem("boss_auth_token")) {
            stopSessionKeepalive();
        }
    }
}

function onSessionVisibility() {
    if (document.visibilityState === "visible" && state.account) {
        keepSessionAlive();
    }
}

async function restoreSession() {
    if (!sessionStorage.getItem("boss_auth_token")) {
        return null;
    }
    try {
        const data = await requestJson("/api/auth/me");
        return data.user || null;
    } catch (error) {
        return null;
    }
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
            sessionStorage.setItem("boss_auth_token", result.token);
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
            sessionStorage.setItem("boss_auth_token", result.token);
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
        sessionStorage.removeItem("boss_auth_token");
        state.account = null;
        state.companies = [];
        stopSessionKeepalive();
        renderCompanies();
        showLoginGate();
    });
    byId("accountAdminBtn").addEventListener("click", () => {
        byId("accountAdmin").classList.remove("d-none");
        loadAccounts();
    });
    byId("closeAccountAdminBtn").addEventListener("click", () => {
        byId("accountAdmin").classList.add("d-none");
    });
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
        const row = document.createElement("tr");
        const action = document.createElement("td");
        if (!user.legacyStore) {
            const lockBtn = document.createElement("button");
            lockBtn.type = "button";
            lockBtn.className = "btn btn-sm btn-outline-warning";
            lockBtn.textContent = user.locked ? "解锁" : "锁定";
            lockBtn.addEventListener("click", async () => {
                await requestJson(`/api/auth/users/${user.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ locked: !user.locked }),
                });
                await loadAccounts();
            });
            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "btn btn-sm btn-outline-danger";
            deleteBtn.textContent = "删除";
            deleteBtn.addEventListener("click", async () => {
                if (!window.confirm(`删除账号「${user.username}」？该公司数据不会自动并入其他账号。`)) {
                    return;
                }
                await requestJson(`/api/auth/users/${user.id}`, { method: "DELETE" });
                await loadAccounts();
            });
            action.append(lockBtn, deleteBtn);
        } else {
            action.textContent = "默认管理员";
        }
        row.innerHTML = `<td></td><td></td><td></td><td></td><td></td>`;
        row.children[0].textContent = user.username;
        row.children[1].textContent = user.displayName || "";
        row.children[2].textContent = user.role === "admin" ? "管理员" : "普通账号";
        row.children[3].textContent = user.locked ? "已锁定" : "正常";
        row.children[4].replaceWith(action);
        body.appendChild(row);
    });
}
