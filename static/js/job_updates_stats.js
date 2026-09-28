/**
 * 更新企业 · 统计：岗位折线 / 薪资区间折线
 */
let jobUpdatesChart = null;

const JOB_UPDATES_CHART_COLORS = [
    "#4ea1ff", "#35d0ba", "#f0b429", "#f07178", "#c792ea",
    "#82aaff", "#c3e88d", "#ffcb6b", "#89ddff", "#f78c6c",
];

/** 薪资区间（按 K 存档：10K = 1万） */
const JOB_UPDATES_SALARY_BUCKETS = [
    { id: "0-10", label: "0-1万", minK: 0, maxK: 10 },
    { id: "10-15", label: "1-1.5万", minK: 10, maxK: 15 },
    { id: "15-20", label: "1.5-2万", minK: 15, maxK: 20 },
    { id: "20-25", label: "2-2.5万", minK: 20, maxK: 25 },
    { id: "25-30", label: "2.5-3万", minK: 25, maxK: 30 },
    { id: "30-35", label: "3-3.5万", minK: 30, maxK: 35 },
    { id: "35+", label: "3.5万-以上", minK: 35, maxK: Infinity },
];

function allSalaryBucketIds() {
    return JOB_UPDATES_SALARY_BUCKETS.map((bucket) => bucket.id);
}

function bindJobUpdatesStatsEvents() {
    byId("jobUpdatesSelectAllTitlesBtn")?.addEventListener("click", () => {
        state.jobUpdatesSelectedTitles = listJobUpdateTitles();
        refreshJobUpdatesStats();
    });
    byId("jobUpdatesClearTitlesBtn")?.addEventListener("click", () => {
        state.jobUpdatesSelectedTitles = [];
        refreshJobUpdatesStats();
    });
    byId("jobUpdatesSelectAllSalaryBtn")?.addEventListener("click", () => {
        state.jobUpdatesSelectedSalaryBuckets = allSalaryBucketIds();
        refreshJobUpdatesStats();
    });
    byId("jobUpdatesClearSalaryBtn")?.addEventListener("click", () => {
        state.jobUpdatesSelectedSalaryBuckets = [];
        refreshJobUpdatesStats();
    });
    document.querySelectorAll(".job-updates-stats-mode-btn").forEach((btn) => {
        btn.addEventListener("click", () => setJobUpdatesStatsMode(btn.dataset.statsMode || "title"));
    });
    ensureJobUpdatesSalaryBucketsSelected();
    syncJobUpdatesStatsModeUI();
}

function refreshJobUpdatesStats() {
    syncJobUpdatesSelectedTitles();
    ensureJobUpdatesSalaryBucketsSelected();
    syncJobUpdatesStatsModeUI();
    renderJobUpdatesTitleChips();
    renderJobUpdatesSalaryChips();
    renderJobUpdatesChart();
}

function ensureJobUpdatesSalaryBucketsSelected() {
    if (state.jobUpdatesSelectedSalaryBuckets == null) {
        state.jobUpdatesSelectedSalaryBuckets = allSalaryBucketIds();
    }
}

function setJobUpdatesStatsMode(mode) {
    state.jobUpdatesStatsMode = mode === "salary" ? "salary" : "title";
    syncJobUpdatesStatsModeUI();
    renderJobUpdatesChart();
}

function syncJobUpdatesStatsModeUI() {
    const mode = state.jobUpdatesStatsMode === "salary" ? "salary" : "title";
    document.querySelectorAll(".job-updates-stats-mode-btn").forEach((btn) => {
        const active = (btn.dataset.statsMode || "title") === mode;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    const showTitle = mode === "title";
    const titleTools = byId("jobUpdatesStatsTitleTools");
    const salaryTools = byId("jobUpdatesStatsSalaryTools");
    const titleChips = byId("jobUpdatesTitleChips");
    const salaryChips = byId("jobUpdatesSalaryChips");
    if (titleTools) titleTools.hidden = !showTitle;
    if (salaryTools) salaryTools.hidden = showTitle;
    if (titleChips) titleChips.hidden = !showTitle;
    if (salaryChips) salaryChips.hidden = showTitle;
}

function listJobUpdateTitles() {
    const titles = new Set();
    (state.jobUpdates || []).forEach((item) => {
        const title = String(item.job_title || "").trim();
        if (title) titles.add(title);
    });
    return Array.from(titles).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function syncJobUpdatesSelectedTitles() {
    const available = listJobUpdateTitles();
    const prev = Array.isArray(state.jobUpdatesSelectedTitles) ? state.jobUpdatesSelectedTitles : [];
    if (!prev.length) {
        state.jobUpdatesSelectedTitles = available.slice();
        return;
    }
    const availableSet = new Set(available);
    const kept = prev.filter((title) => availableSet.has(title));
    const added = available.filter((title) => !prev.includes(title));
    state.jobUpdatesSelectedTitles = kept.concat(added);
}

function renderFilterChips(hostId, items, selectedIds, onToggle, emptyText) {
    const host = byId(hostId);
    if (!host) return;
    host.replaceChildren();
    if (!items.length) {
        host.innerHTML = `<span class="chip-empty">${escapeHtml(emptyText)}</span>`;
        return;
    }
    const selected = new Set(selectedIds || []);
    items.forEach((item) => {
        const id = item.id;
        const label = item.label;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `chip job-title-chip${selected.has(id) ? " is-active" : ""}`;
        btn.textContent = label;
        btn.title = label;
        btn.addEventListener("click", () => onToggle(id));
        host.appendChild(btn);
    });
}

function renderJobUpdatesTitleChips() {
    const titles = listJobUpdateTitles().map((title) => ({ id: title, label: title }));
    renderFilterChips(
        "jobUpdatesTitleChips",
        titles,
        state.jobUpdatesSelectedTitles,
        (title) => {
            const current = new Set(state.jobUpdatesSelectedTitles || []);
            if (current.has(title)) current.delete(title);
            else current.add(title);
            state.jobUpdatesSelectedTitles = Array.from(current);
            refreshJobUpdatesStats();
        },
        "暂无岗位可筛选",
    );
}

function renderJobUpdatesSalaryChips() {
    renderFilterChips(
        "jobUpdatesSalaryChips",
        JOB_UPDATES_SALARY_BUCKETS.map((bucket) => ({ id: bucket.id, label: bucket.label })),
        state.jobUpdatesSelectedSalaryBuckets,
        (bucketId) => {
            const current = new Set(state.jobUpdatesSelectedSalaryBuckets || []);
            if (current.has(bucketId)) current.delete(bucketId);
            else current.add(bucketId);
            state.jobUpdatesSelectedSalaryBuckets = Array.from(current);
            refreshJobUpdatesStats();
        },
        "暂无薪资区间",
    );
}

function jobSalaryMidK(item) {
    const minRaw = item?.salary_min;
    const maxRaw = item?.salary_max;
    const hasMin = minRaw !== null && minRaw !== undefined && minRaw !== "";
    const hasMax = maxRaw !== null && maxRaw !== undefined && maxRaw !== "";
    if (!hasMin && !hasMax) return null;
    const min = Number(hasMin ? minRaw : maxRaw);
    const max = Number(hasMax ? maxRaw : minRaw);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return (min + max) / 2;
}

function matchSalaryBucket(midK) {
    if (!Number.isFinite(midK)) return null;
    return JOB_UPDATES_SALARY_BUCKETS.find((bucket) => {
        if (bucket.maxK === Infinity) return midK >= bucket.minK;
        return midK >= bucket.minK && midK < bucket.maxK;
    }) || null;
}

function makeLineDataset(label, data, index) {
    const color = JOB_UPDATES_CHART_COLORS[index % JOB_UPDATES_CHART_COLORS.length];
    return {
        label,
        data,
        borderColor: color,
        backgroundColor: color,
        tension: 0.25,
        fill: false,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
    };
}

function accumulateByDate(items, getKey) {
    const dateSet = new Set();
    const seriesMap = new Map();
    items.forEach((item) => {
        const key = getKey(item);
        if (!key) return;
        const parts = formatTimeParts(item.updated_at);
        if (!parts?.date) return;
        dateSet.add(parts.date);
        if (!seriesMap.has(key)) seriesMap.set(key, new Map());
        const byDate = seriesMap.get(key);
        byDate.set(parts.date, (byDate.get(parts.date) || 0) + 1);
    });
    return {
        labels: Array.from(dateSet).sort(),
        seriesMap,
    };
}

function buildJobUpdatesTitleChartSeries() {
    const selected = new Set(state.jobUpdatesSelectedTitles || []);
    const { labels, seriesMap } = accumulateByDate(state.jobUpdates || [], (item) => {
        const title = String(item.job_title || "").trim();
        return title && selected.has(title) ? title : null;
    });
    const datasets = Array.from(seriesMap.keys())
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .map((title, index) => makeLineDataset(
            title,
            labels.map((date) => seriesMap.get(title).get(date) || 0),
            index,
        ));
    return { labels, datasets };
}

function buildJobUpdatesSalaryChartSeries() {
    const selected = new Set(state.jobUpdatesSelectedSalaryBuckets || []);
    const { labels, seriesMap } = accumulateByDate(state.jobUpdates || [], (item) => {
        const bucket = matchSalaryBucket(jobSalaryMidK(item));
        return bucket && selected.has(bucket.id) ? bucket.id : null;
    });
    const datasets = JOB_UPDATES_SALARY_BUCKETS
        .filter((bucket) => selected.has(bucket.id) && seriesMap.has(bucket.id))
        .map((bucket, index) => makeLineDataset(
            bucket.label,
            labels.map((date) => seriesMap.get(bucket.id).get(date) || 0),
            index,
        ));
    return { labels, datasets };
}

function buildJobUpdatesChartSeries() {
    return state.jobUpdatesStatsMode === "salary"
        ? buildJobUpdatesSalaryChartSeries()
        : buildJobUpdatesTitleChartSeries();
}

function renderJobUpdatesChart() {
    const canvas = byId("jobUpdatesChart");
    const empty = byId("jobUpdatesChartEmpty");
    if (!canvas || typeof window.Chart !== "function") return;

    const { labels, datasets } = buildJobUpdatesChartSeries();
    const hasData = labels.length > 0 && datasets.length > 0;
    if (empty) {
        empty.classList.toggle("d-none", hasData);
        empty.textContent = state.jobUpdatesStatsMode === "salary"
            ? "请选择至少一个薪资区间，或先采集带薪资的数据"
            : "请选择至少一个岗位，或先采集数据";
    }
    canvas.classList.toggle("d-none", !hasData);

    if (jobUpdatesChart) {
        jobUpdatesChart.destroy();
        jobUpdatesChart = null;
    }
    if (!hasData) return;

    const textColor = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#9aa4b2";
    const gridColor = "rgba(255, 255, 255, 0.08)";
    jobUpdatesChart = new window.Chart(canvas.getContext("2d"), {
        type: "line",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { color: textColor, boxWidth: 12, padding: 14 },
                },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            return `${ctx.dataset.label}: ${ctx.parsed?.y ?? 0}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    title: { display: true, text: "日期", color: textColor },
                    ticks: { color: textColor, maxRotation: 45, minRotation: 0 },
                    grid: { color: gridColor },
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: "采集条数", color: textColor },
                    ticks: { color: textColor, precision: 0, stepSize: 1 },
                    grid: { color: gridColor },
                },
            },
        },
    });
}
