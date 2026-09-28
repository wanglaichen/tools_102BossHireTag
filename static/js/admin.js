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
        row.children[3].textContent = String(user.ignored_count ?? user.blacklist_count ?? 0);
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
        blackGroup.innerHTML = `<div class="admin-action-label">忽略企业</div>`;
        const blackActions = document.createElement("div");
        blackActions.className = "admin-action-btns";
        blackActions.append(
            makeAdminBtn("导出忽略企业", "btn-outline-success", () => exportAccountBlacklist(user)),
            makeAdminBtn("导出忽略CSV", "btn-outline-secondary", () => exportAccountBlacklistCsv(user)),
            makeAdminBtn("导入忽略合并", "btn-outline-primary", () => pickAdminImport(user, "merge", "blacklist")),
            makeAdminBtn("导入忽略覆盖", "btn-outline-warning", () => pickAdminImport(user, "overwrite", "blacklist")),
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
                    if (!window.confirm(`删除账号「${user.username}」？登记与忽略企业残留数据不会自动并入其他账号。`)) {
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
            `/api/auth/users/${user.id}/ignored/export`,
            `ignored-backup_${user.username || "account"}.json`
        );
        showMessage("success", `已导出账号「${user.username}」的忽略企业备份`);
    } catch (error) {
        byId("accountAdminError").textContent = error.message;
    }
}

async function exportAccountBlacklistCsv(user) {
    byId("accountAdminError").textContent = "";
    try {
        await downloadAuthedFile(
            `/api/auth/users/${user.id}/ignored/export.csv`,
            `${user.username || "account"}-ignored.csv`
        );
        showMessage("success", `已导出账号「${user.username}」的忽略企业 CSV`);
    } catch (error) {
        byId("accountAdminError").textContent = error.message;
    }
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
    const kindLabel = kind === "blacklist" ? "忽略企业" : "登记";
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
                ? `/api/auth/users/${user.id}/ignored/import-overwrite`
                : `/api/auth/users/${user.id}/ignored/import`;
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
                    invalidateBlacklistCache();
                    await loadBlacklist({ force: true });
                } else {
                    invalidateHireCache();
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
