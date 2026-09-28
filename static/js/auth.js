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
    applyNavMemory();
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
