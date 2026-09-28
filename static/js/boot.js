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

async function openWorkspace() {
    if (!workspaceReady) {
        workspaceReady = true;
        byId("companyForm").addEventListener("submit", submitCompany);
        byId("cancelEditButton").addEventListener("click", resetForm);
        byId("importDataBtn").addEventListener("click", () => { setImportMode("merge"); byId("importFileInput").click(); });
        byId("importOverwriteBtn").addEventListener("click", () => { setImportMode("overwrite"); byId("importFileInput").click(); });
        byId("importFileInput").addEventListener("change", handleImportFile);
        byId("backupBtn").addEventListener("click", createBackup);
        byId("clearCompaniesBtn").addEventListener("click", openClearCompaniesModal);
        byId("cancelClearCompaniesBtn").addEventListener("click", closeClearCompaniesModal);
        byId("confirmClearCompaniesBtn").addEventListener("click", confirmClearCompanies);
        byId("clearConfirmInput").addEventListener("input", syncClearConfirmButton);
        byId("clearConfirmInput").addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                if (!byId("confirmClearCompaniesBtn")?.disabled) {
                    confirmClearCompanies();
                }
            }
        });
        byId("refreshClearConfirmBtn")?.addEventListener("click", () => {
            prepareClearConfirmChallenge({ focus: true });
        });
        byId("exportCsvBtn").addEventListener("click", () => {
            const channel = state.hireChannel || "boss";
            exportCurrentAccount(
                `/api/companies/export.csv?channel=${encodeURIComponent(channel)}`,
                "csv",
                channel
            );
        });
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
        bindWorkspaceTabs();
        bindBlacklistEvents();
        bindBlocklistEvents();
        bindJobUpdatesEvents();
    }
    state.companies = [];
    try {
        await loadVersion();
        await loadChannels();
        await loadProxySettings();
        // 恢复上次大页签 + 渠道小页签，并加载对应数据
        switchFeature(state.feature || "hire", state.hireChannel || "boss");
    } catch (error) {
        showMessage("error", error.message);
    }
}

document.addEventListener("DOMContentLoaded", boot);
