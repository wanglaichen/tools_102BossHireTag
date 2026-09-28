function channelQuery(extra = "") {
    const channel = encodeURIComponent(state.hireChannel || "boss");
    const base = `channel=${channel}`;
    return extra ? `${extra}&${base}` : `?${base}`;
}

const NAV_MEMORY_PREFIX = "tools102-boss-hire-tag:nav";
const NAV_FEATURES = ["hire", "blacklist", "blocklist", "jobUpdates"];

function navMemoryStorageKey() {
    const uid = (state.account && state.account.id) || "guest";
    return `${NAV_MEMORY_PREFIX}:${uid}`;
}

function saveNavMemory() {
    try {
        const openGroups = Array.from(document.querySelectorAll(".feature-group.is-open"))
            .map((el) => el.dataset.featureGroup)
            .filter(Boolean);
        localStorage.setItem(
            navMemoryStorageKey(),
            JSON.stringify({
                feature: state.feature || "hire",
                channel: state.hireChannel || "boss",
                openGroups,
            })
        );
    } catch (e) {
        // ignore quota / private mode
    }
}

function loadNavMemory() {
    try {
        const raw = localStorage.getItem(navMemoryStorageKey());
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data === "object" ? data : null;
    } catch (e) {
        return null;
    }
}

function applyNavMemory() {
    const mem = loadNavMemory();
    if (!mem) return;
    if (NAV_FEATURES.includes(mem.feature)) {
        state.feature = mem.feature;
    }
    if (mem.channel) {
        state.hireChannel = String(mem.channel);
    }
    if (Array.isArray(mem.openGroups)) {
        document.querySelectorAll(".feature-group").forEach((group) => {
            const id = group.dataset.featureGroup;
            if (mem.openGroups.includes(id) || id === state.feature) {
                group.classList.add("is-open");
            }
        });
    }
}

function currentChannelLabel() {
    const hit = (state.channels || []).find((item) => item.id === state.hireChannel);
    return hit ? hit.name : (state.hireChannel || "boss");
}

function updateChannelPageTitle() {
    const label = currentChannelLabel();
    const hireTitle = byId("hirePageTitle");
    const blacklistTitle = byId("blacklistPageTitle");
    const jobUpdatesTitle = byId("jobUpdatesPageTitle");
    if (hireTitle) hireTitle.textContent = label;
    if (blacklistTitle) blacklistTitle.textContent = label;
    if (jobUpdatesTitle) jobUpdatesTitle.textContent = label;
}

function rememberHireCache() {
    const channel = state.hireChannel || "boss";
    state.cache.hire[channel] = {
        companies: Array.isArray(state.companies) ? state.companies.slice() : [],
        summary: state.summary || {},
        timeFilter: state.timeFilter || "all",
        dirty: false,
    };
}

function applyHireCache(entry) {
    state.companies = Array.isArray(entry.companies) ? entry.companies.slice() : [];
    if (entry.summary) {
        renderSummary(entry.summary);
    }
    resetCompanyPage();
    renderCompanies();
}

function invalidateHireCache(channel) {
    if (channel) {
        const entry = state.cache.hire[channel];
        if (entry) entry.dirty = true;
        return;
    }
    Object.keys(state.cache.hire).forEach((key) => {
        state.cache.hire[key].dirty = true;
    });
}

function rememberBlacklistCache() {
    const channel = state.hireChannel || "boss";
    const keyword = state.blacklistKeyword || "";
    state.cache.blacklist[channel] = {
        items: Array.isArray(state.blacklist) ? state.blacklist.slice() : [],
        summary: {
            blacklist_count: Number(byId("blacklistCount")?.textContent || state.blacklist.length) || 0,
            ignored_count: Number(byId("blacklistCount")?.textContent || state.blacklist.length) || 0,
            last_updated_at: state.blacklistSummaryUpdatedAt || "",
        },
        keyword,
        dirty: false,
    };
}

function applyBlacklistCache(entry) {
    state.blacklist = Array.isArray(entry.items) ? entry.items.slice() : [];
    state.blacklistKeyword = entry.keyword || "";
    const search = byId("blacklistSearchInput");
    if (search && search.value.trim() !== state.blacklistKeyword) {
        search.value = state.blacklistKeyword;
    }
    renderBlacklistSummary(entry.summary || {});
    renderBlacklist();
}

function invalidateBlacklistCache(channel) {
    if (channel) {
        const entry = state.cache.blacklist[channel];
        if (entry) entry.dirty = true;
        return;
    }
    Object.keys(state.cache.blacklist).forEach((key) => {
        state.cache.blacklist[key].dirty = true;
    });
}

async function ensureHireLoaded(options = {}) {
    const channel = state.hireChannel || "boss";
    const entry = state.cache.hire[channel];
    const force = Boolean(options.forceReload);
    if (
        !force
        && entry
        && !entry.dirty
        && entry.timeFilter === (state.timeFilter || "all")
        && Array.isArray(entry.companies)
    ) {
        applyHireCache(entry);
        return;
    }
    await loadSummary();
    await loadCompanies();
}

async function ensureBlacklistLoaded(options = {}) {
    const channel = state.hireChannel || "boss";
    const keyword = (byId("blacklistSearchInput")?.value || "").trim();
    const entry = state.cache.blacklist[channel];
    const force = Boolean(options.forceReload);
    if (
        !force
        && entry
        && !entry.dirty
        && (entry.keyword || "") === keyword
        && Array.isArray(entry.items)
    ) {
        applyBlacklistCache(entry);
        return;
    }
    await loadBlacklist({ force: true });
}

async function ensureBlocklistLoaded(options = {}) {
    const keyword = (byId("blocklistSearchInput")?.value || "").trim();
    const entry = state.cache.blocklist;
    const force = Boolean(options.forceReload);
    if (
        !force
        && entry
        && !entry.dirty
        && (entry.keyword || "") === keyword
        && Array.isArray(entry.items)
    ) {
        applyBlocklistCache(entry);
        return;
    }
    await loadBlocklist({ force: true });
}

async function ensureJobUpdatesLoaded(options = {}) {
    const channel = state.hireChannel || "boss";
    const keyword = (byId("jobUpdatesSearchInput")?.value || "").trim();
    const entry = state.cache.jobUpdates[channel];
    const force = Boolean(options.forceReload);
    if (
        !force
        && entry
        && !entry.dirty
        && (entry.keyword || "") === keyword
        && Array.isArray(entry.items)
    ) {
        applyJobUpdatesCache(entry);
        return;
    }
    await loadJobUpdates({ force: true });
}

function bindFeatureTabs() {
    document.querySelectorAll(".feature-tab").forEach((btn) => {
        btn.addEventListener("click", () => {
            const feature = btn.dataset.feature || "hire";
            const group = btn.closest(".feature-group");
            // 已选中时再点：只手动展开/收起，不联动关掉其他分组
            if (state.feature === feature) {
                group?.classList.toggle("is-open");
                saveNavMemory();
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
    ["hireSubrail", "blacklistSubrail", "jobUpdatesSubrail"].forEach((railId) => {
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
    const allowed = NAV_FEATURES;
    state.feature = allowed.includes(feature) ? feature : "hire";
    document.querySelectorAll(".feature-tab").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.feature === state.feature);
    });
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

    if (state.feature === "blocklist") {
        syncChannelSubtabActive();
        saveNavMemory();
        ensureBlocklistLoaded({ forceReload: false }).catch((error) => showMessage("error", error.message));
        return;
    }

    const firstChannel = (state.channels[0] && state.channels[0].id) || "boss";
    const nextChannel = channel || state.hireChannel || firstChannel;
    switchHireChannel(nextChannel, { reloadHire: state.feature === "hire" });
}

function switchHireChannel(channel, options = {}) {
    const reloadHire = options.reloadHire !== false;
    const ids = (state.channels || []).map((item) => item.id);
    const next = ids.includes(channel) ? channel : (ids[0] || "boss");
    state.hireChannel = next;

    syncChannelSubtabActive();
    updateChannelPageTitle();
    saveNavMemory();

    const workspace = byId("hireChannelWorkspace");
    if (workspace) {
        workspace.dataset.channel = next;
        workspace.hidden = false;
        workspace.classList.add("is-active");
    }

    if (state.feature === "blocklist") {
        ensureBlocklistLoaded(options).catch((error) => showMessage("error", error.message));
        return;
    }

    if (state.feature === "blacklist") {
        ensureBlacklistLoaded(options).catch((error) => showMessage("error", error.message));
        return;
    }

    if (state.feature === "jobUpdates") {
        ensureJobUpdatesLoaded(options).catch((error) => showMessage("error", error.message));
        return;
    }

    if (reloadHire) {
        ensureHireLoaded(options).catch((error) => showMessage("error", error.message));
    }
}
