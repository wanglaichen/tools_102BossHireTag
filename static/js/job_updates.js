/**
 * 更新企业 · 列表：查询、时间筛选、缓存、删除 / 清空、帮助复制
 */
let jobUpdatesReady = false;
let jobUpdatesRangePicker = null;

function bindJobUpdatesEvents() {
    if (jobUpdatesReady) return;
    jobUpdatesReady = true;

    byId("jobUpdatesSearchBtn").addEventListener("click", () => loadJobUpdates({ force: true }));
    byId("jobUpdatesRefreshBtn").addEventListener("click", () => {
        byId("jobUpdatesSearchInput").value = "";
        state.jobUpdatesKeyword = "";
        loadJobUpdates({ force: true });
    });
    byId("jobUpdatesSearchInput").addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            loadJobUpdates({ force: true });
        }
    });
    byId("jobUpdatesClearBtn").addEventListener("click", openClearJobUpdatesModal);
    document.querySelectorAll(".job-updates-time-btn").forEach((btn) => {
        btn.addEventListener("click", () => setJobUpdatesQuickFilter(btn.dataset.filter || "all"));
    });

    bindJobUpdatesHelpCopy();
    if (typeof bindJobUpdatesStatsEvents === "function") {
        bindJobUpdatesStatsEvents();
    }
    initJobUpdatesRangePicker();
}

function initJobUpdatesRangePicker() {
    const host = byId("jobUpdatesRangePicker");
    if (!host || !window.DateTimeRangePicker) return;
    jobUpdatesRangePicker = new window.DateTimeRangePicker(host, {
        placeholder: "选择日期和时间范围",
        toDate: new Date(),
        onChange: (range) => applyJobUpdatesRange(range),
    });
}

function applyJobUpdatesRange(range) {
    if (!range?.from && !range?.to) {
        state.jobUpdatesFromTs = 0;
        state.jobUpdatesToTs = 0;
        state.jobUpdatesTimeFilter = "all";
    } else {
        const from = range.from || range.to;
        const to = range.to || range.from;
        state.jobUpdatesFromTs = Math.floor(from.getTime() / 1000);
        state.jobUpdatesToTs = Math.floor(to.getTime() / 1000);
        state.jobUpdatesTimeFilter = "range";
        state.jobUpdatesDate = "";
    }
    syncJobUpdatesTimeButtons();
    invalidateJobUpdatesCache(state.hireChannel || "boss");
    loadJobUpdates({ force: true }).catch((error) => showMessage("error", error.message));
}

function setJobUpdatesQuickFilter(filter) {
    const next = filter || "all";
    state.jobUpdatesTimeFilter = next;
    state.jobUpdatesDate = "";
    const helpers = window.DateTimeRangePickerHelpers;
    if (next === "all") {
        state.jobUpdatesFromTs = 0;
        state.jobUpdatesToTs = 0;
        jobUpdatesRangePicker?.setValue({ from: undefined, to: undefined }, { silent: true });
    } else if (helpers) {
        const offset = next === "today" ? 0 : (next === "yesterday" ? -1 : -2);
        const range = helpers.dayRange(offset);
        state.jobUpdatesFromTs = Math.floor(range.from.getTime() / 1000);
        state.jobUpdatesToTs = Math.floor(range.to.getTime() / 1000);
        jobUpdatesRangePicker?.setValue(range, { silent: true });
    }
    syncJobUpdatesTimeButtons();
    invalidateJobUpdatesCache(state.hireChannel || "boss");
    loadJobUpdates({ force: true }).catch((error) => showMessage("error", error.message));
}

function syncJobUpdatesTimeButtons() {
    const usingRange = state.jobUpdatesTimeFilter === "range";
    document.querySelectorAll(".job-updates-time-btn").forEach((btn) => {
        const active = !usingRange && btn.dataset.filter === (state.jobUpdatesTimeFilter || "all");
        btn.classList.toggle("active", active);
    });
    byId("jobUpdatesRangePicker")?.classList.toggle("is-active", usingRange || Boolean(state.jobUpdatesFromTs));
}

function jobUpdatesCurrentTimeFilter() {
    return (state.jobUpdatesFromTs || state.jobUpdatesToTs)
        ? "range"
        : (state.jobUpdatesTimeFilter || "all");
}

function jobUpdatesQueryString() {
    const channel = encodeURIComponent(state.hireChannel || "boss");
    const q = encodeURIComponent(state.jobUpdatesKeyword || "");
    const params = [`q=${q}`, `channel=${channel}`];
    if (state.jobUpdatesFromTs || state.jobUpdatesToTs) {
        params.push("time_filter=range");
        if (state.jobUpdatesFromTs) params.push(`from_ts=${encodeURIComponent(state.jobUpdatesFromTs)}`);
        if (state.jobUpdatesToTs) params.push(`to_ts=${encodeURIComponent(state.jobUpdatesToTs)}`);
    } else {
        params.push(`time_filter=${encodeURIComponent(state.jobUpdatesTimeFilter || "all")}`);
    }
    return params.join("&");
}

async function loadJobUpdates(options = {}) {
    const q = byId("jobUpdatesSearchInput")?.value.trim() || "";
    state.jobUpdatesKeyword = q;
    const channel = state.hireChannel || "boss";
    const timeFilter = jobUpdatesCurrentTimeFilter();
    const fromTs = state.jobUpdatesFromTs || 0;
    const toTs = state.jobUpdatesToTs || 0;
    if (!options.force) {
        const entry = state.cache.jobUpdates[channel];
        if (
            entry
            && !entry.dirty
            && (entry.keyword || "") === q
            && (entry.timeFilter || "all") === timeFilter
            && (entry.fromTs || 0) === fromTs
            && (entry.toTs || 0) === toTs
            && Array.isArray(entry.items)
        ) {
            applyJobUpdatesCache(entry);
            return;
        }
    }
    const data = await requestJson(`/api/job-updates?${jobUpdatesQueryString()}`);
    state.jobUpdates = data.items || [];
    const summary = data.summary || {};
    state.jobUpdatesSummaryUpdatedAt = summary.last_updated_at || "";
    renderJobUpdatesSummary(summary);
    renderJobUpdates();
    rememberJobUpdatesCache();
    syncJobUpdatesTimeButtons();
}

function rememberJobUpdatesCache() {
    const channel = state.hireChannel || "boss";
    state.cache.jobUpdates[channel] = {
        items: Array.isArray(state.jobUpdates) ? state.jobUpdates.slice() : [],
        summary: {
            job_update_count: Number(byId("jobUpdateCount")?.textContent || state.jobUpdates.length) || 0,
            last_updated_at: state.jobUpdatesSummaryUpdatedAt || "",
        },
        keyword: state.jobUpdatesKeyword || "",
        timeFilter: jobUpdatesCurrentTimeFilter(),
        fromTs: state.jobUpdatesFromTs || 0,
        toTs: state.jobUpdatesToTs || 0,
        dirty: false,
    };
}

function applyJobUpdatesCache(entry) {
    state.jobUpdates = Array.isArray(entry.items) ? entry.items.slice() : [];
    state.jobUpdatesKeyword = entry.keyword || "";
    state.jobUpdatesTimeFilter = entry.timeFilter || "all";
    state.jobUpdatesFromTs = entry.fromTs || 0;
    state.jobUpdatesToTs = entry.toTs || 0;
    const search = byId("jobUpdatesSearchInput");
    if (search && search.value.trim() !== state.jobUpdatesKeyword) {
        search.value = state.jobUpdatesKeyword;
    }
    if (jobUpdatesRangePicker && (state.jobUpdatesFromTs || state.jobUpdatesToTs)) {
        jobUpdatesRangePicker.setValue({
            from: state.jobUpdatesFromTs ? new Date(state.jobUpdatesFromTs * 1000) : undefined,
            to: state.jobUpdatesToTs ? new Date(state.jobUpdatesToTs * 1000) : undefined,
        }, { silent: true });
    } else if (jobUpdatesRangePicker) {
        jobUpdatesRangePicker.setValue({ from: undefined, to: undefined }, { silent: true });
    }
    renderJobUpdatesSummary(entry.summary || {});
    renderJobUpdates();
    syncJobUpdatesTimeButtons();
}

function invalidateJobUpdatesCache(channel) {
    if (channel) {
        const entry = state.cache.jobUpdates[channel];
        if (entry) entry.dirty = true;
        return;
    }
    Object.keys(state.cache.jobUpdates).forEach((key) => {
        state.cache.jobUpdates[key].dirty = true;
    });
}

function renderJobUpdatesSummary(summary) {
    byId("jobUpdateCount").textContent = summary.job_update_count ?? state.jobUpdates.length;
    byId("jobUpdateLastUpdated").textContent = formatTime(summary.last_updated_at) || "-";
    if (summary.last_updated_at) {
        state.jobUpdatesSummaryUpdatedAt = summary.last_updated_at;
    }
}

function formatJobSalaryRange(item) {
    const min = item?.salary_min;
    const max = item?.salary_max;
    const hasMin = min !== null && min !== undefined && min !== "";
    const hasMax = max !== null && max !== undefined && max !== "";
    if (!hasMin && !hasMax) return "-";
    if (hasMin && hasMax) return `${min}-${max}K`;
    if (hasMin) return `${min}K起`;
    return `最高${max}K`;
}

function renderJobUpdates() {
    const tbody = byId("jobUpdatesTableBody");
    tbody.replaceChildren();
    if (!state.jobUpdates.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">暂无匹配的采集记录</td></tr>';
    } else {
        state.jobUpdates.forEach((item) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><div class="company-name">${escapeHtml(item.company_name || "")}</div></td>
                <td>${escapeHtml(item.job_title || "")}</td>
                <td>${escapeHtml(formatJobSalaryRange(item))}</td>
                <td>${escapeHtml(item.location || "-")}</td>
                <td class="note-cell">${escapeHtml(item.job_summary || "")}</td>
                <td>${formatTimeHtml(item.updated_at)}</td>
                <td>
                    <div class="row-actions">
                        <button class="btn btn-sm btn-outline-danger" data-action="delete" type="button">删除</button>
                    </div>
                </td>
            `;
            tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteJobUpdateItem(item));
            tbody.appendChild(tr);
        });
    }
    if (typeof refreshJobUpdatesStats === "function") {
        refreshJobUpdatesStats();
    }
}

async function deleteJobUpdateItem(item) {
    if (!window.confirm(`确定删除「${item.company_name} / ${item.job_title}」吗？`)) {
        return;
    }
    clearMessages();
    const channel = encodeURIComponent(state.hireChannel || "boss");
    try {
        const result = await requestJson(`/api/job-updates/${item.id}?channel=${channel}`, { method: "DELETE" });
        showMessage("success", result.message || "已删除");
        invalidateJobUpdatesCache(state.hireChannel || "boss");
        await loadJobUpdates({ force: true });
    } catch (error) {
        showMessage("error", error.message);
    }
}

function openClearJobUpdatesModal() {
    const modal = byId("clearCompaniesModal");
    const error = byId("clearCompaniesError");
    const title = modal?.querySelector("h2");
    const warning = modal?.querySelector(".clear-confirm-warning");
    const channel = state.hireChannel || "boss";
    state.clearKind = "jobUpdates";
    if (title) title.textContent = `清空渠道「${channel}」岗位采集`;
    if (warning) {
        warning.innerHTML = `
                <p><strong>此操作不可撤销。</strong></p>
                <ul>
                    <li>将删除：当前招聘渠道 <strong>${channel}</strong> 下的<strong>全部岗位采集</strong></li>
                    <li>不会删除：其他渠道采集、投递登记、忽略/黑名单数据</li>
                </ul>
                <p>确认前请完成下方验算。</p>
            `;
    }
    if (error) error.textContent = "";
    prepareClearConfirmChallenge({ focus: true });
    modal.classList.remove("d-none");
    modal.style.display = "flex";
}

function bindJobUpdatesHelpCopy() {
    const panel = document.querySelector(".job-updates-help-panel");
    if (!panel || panel.dataset.copyBound === "1") return;
    panel.dataset.copyBound = "1";
    panel.addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-copy-target], [data-copy-curl]");
        if (!btn) return;
        let text = "";
        if (btn.dataset.copyTarget) {
            text = byId(btn.dataset.copyTarget)?.textContent || "";
        } else if (btn.dataset.copyCurl === "single") {
            text = byId("jobUpdatesHelpSingleCurl")?.textContent || "";
        } else if (btn.dataset.copyCurl === "batch") {
            text = byId("jobUpdatesHelpBatchCurl")?.textContent || "";
        }
        text = text.trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            const old = btn.textContent;
            btn.textContent = "已复制";
            setTimeout(() => { btn.textContent = old; }, 1200);
        } catch (error) {
            showMessage("error", "复制失败，请手动选择代码");
        }
    });
}
