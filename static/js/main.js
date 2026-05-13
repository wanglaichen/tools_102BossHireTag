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
};

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
    const response = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    const data = await response.json().catch(() => ({}));
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

function formatTime(value) {
    if (!value) {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString("zh-CN", { hour12: false });
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
    populateSelectOptions("effectStatusInput", state.settings.status_options || [], "请选择效果状态");
    populateSelectOptions("industryInput", state.settings.industry_options || [], "请选择行业");
}

function renderStatusFilter(values) {
    const select = byId("statusFilter");
    const currentValue = select.value;
    select.innerHTML = '<option value="">全部状态</option>';
    values.forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
    });
    select.value = values.includes(currentValue) ? currentValue : "";
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
            flagLabel(item.is_interviewed),
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
        tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">暂无匹配记录</td></tr>';
        return;
    }

    items.forEach((item) => {
        const tr = document.createElement("tr");
        const isRejected = (item.effect_status || "").split(",").some(v => v.includes("拒绝"));
        const statusParts = (item.effect_status || "未填写").split(",");
        const industryParts = (item.industry || "-").split(",");
        tr.innerHTML = `
            <td>
                <div class="company-name">${escapeHtml(item.company_name)}</div>
                <div class="muted-line">创建: ${formatTime(item.created_at)}</div>
            </td>
            <td>${statusParts.map(s => `<span class="status-pill ${s.includes("拒绝") ? "rejected" : ""}">${escapeHtml(s)}</span>`).join(" ")}</td>
            <td>${industryParts.map(i => `<span class="industry-tag">${escapeHtml(i)}</span>`).join(" ")}</td>
            <td><span class="flag-badge ${escapeHtml(item.is_hunter || "unknown")}">${flagLabel(item.is_hunter)}</span></td>
            <td><span class="flag-badge ${escapeHtml(item.is_outsourced || "unknown")}">${flagLabel(item.is_outsourced)}</span></td>
            <td><span class="flag-badge ${escapeHtml(item.is_interviewed || "unknown")}">${flagLabel(item.is_interviewed)}</span></td>
            <td class="note-cell">${escapeHtml(item.note || "")}</td>
            <td>${formatTime(item.updated_at)}</td>
            <td>
                <div class="row-actions">
                    <button class="btn btn-sm btn-outline-primary" data-action="edit">编辑</button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delete">删除</button>
                </div>
            </td>
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

async function boot() {
    byId("companyForm").addEventListener("submit", submitCompany);
    byId("cancelEditButton").addEventListener("click", resetForm);
    byId("importButton").addEventListener("click", importCompanies);
    byId("importDataBtn").addEventListener("click", () => { setImportMode("merge"); byId("importFileInput").click(); });
    byId("importOverwriteBtn").addEventListener("click", () => { setImportMode("overwrite"); byId("importFileInput").click(); });
    byId("importFileInput").addEventListener("change", handleImportFile);

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

    try {
        setupWorkspaceResize();
        setupTableDragResize();
        await loadProxySettings();
        await loadSummary();
        await loadCompanies();
    } catch (error) {
        showMessage("error", error.message);
    }
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
