const state = {
    companies: [],
    editingId: null,
    summary: {},
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
    return {
        company_name: byId("companyNameInput").value,
        effect_status: byId("effectStatusInput").value,
        industry: byId("industryInput").value,
        is_hunter: byId("hunterInput").value,
        note: byId("noteInput").value,
    };
}

function resetForm() {
    state.editingId = null;
    byId("companyForm").reset();
    byId("hunterInput").value = "unknown";
    byId("submitButton").textContent = "保存记录";
    byId("cancelEditButton").classList.add("d-none");
    byId("companyNameInput").focus();
}

function fillForm(item) {
    state.editingId = item.id;
    byId("companyNameInput").value = item.company_name || "";
    byId("effectStatusInput").value = item.effect_status || "";
    byId("industryInput").value = item.industry || "";
    byId("hunterInput").value = item.is_hunter || "unknown";
    byId("noteInput").value = item.note || "";
    byId("submitButton").textContent = "更新记录";
    byId("cancelEditButton").classList.remove("d-none");
    byId("companyNameInput").focus();
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

function hunterLabel(value) {
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
    byId("followUpCount").textContent = summary.follow_up_count ?? 0;
    byId("lastUpdatedAt").textContent = formatTime(summary.last_updated_at);
    renderOptions("statusList", summary.statuses || []);
    renderOptions("industryList", summary.industries || []);
    renderStatusFilter(summary.statuses || []);
}

function renderOptions(id, values) {
    byId(id).innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
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

function getFilteredCompanies() {
    const keyword = byId("searchInput").value.trim().toLowerCase();
    const status = byId("statusFilter").value;
    const hunter = byId("hunterFilter").value;

    return state.companies.filter((item) => {
        const searchable = [
            item.company_name,
            item.effect_status,
            item.industry,
            hunterLabel(item.is_hunter),
            item.note,
        ]
            .join(" ")
            .toLowerCase();

        return (!keyword || searchable.includes(keyword))
            && (!status || item.effect_status === status)
            && (!hunter || item.is_hunter === hunter);
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
        const isRejected = String(item.effect_status || "").includes("拒绝");
        tr.innerHTML = `
            <td>
                <div class="company-name">${escapeHtml(item.company_name)}</div>
                <div class="muted-line">创建: ${formatTime(item.created_at)}</div>
            </td>
            <td><span class="status-pill ${isRejected ? "rejected" : ""}">${escapeHtml(item.effect_status || "未填写")}</span></td>
            <td>${escapeHtml(item.industry || "-")}</td>
            <td><span class="hunter-badge ${escapeHtml(item.is_hunter || "unknown")}">${hunterLabel(item.is_hunter)}</span></td>
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
        tbody.appendChild(tr);
    });
}

async function loadSummary() {
    renderSummary(await requestJson("/api/summary"));
}

async function loadCompanies() {
    const data = await requestJson("/api/companies");
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

async function boot() {
    byId("companyForm").addEventListener("submit", submitCompany);
    byId("cancelEditButton").addEventListener("click", resetForm);
    byId("importButton").addEventListener("click", importCompanies);
    byId("searchInput").addEventListener("input", renderCompanies);
    byId("statusFilter").addEventListener("change", renderCompanies);
    byId("hunterFilter").addEventListener("change", renderCompanies);

    try {
        await loadSummary();
        await loadCompanies();
    } catch (error) {
        showMessage("error", error.message);
    }
}

document.addEventListener("DOMContentLoaded", boot);
