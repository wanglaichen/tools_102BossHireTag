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

async function exportCurrentAccount(path, ext, channel) {
    clearMessages();
    try {
        await downloadAccountExport(path, ext, channel);
        if (ext === "csv") {
            const scope = channel ? `渠道「${channel}」` : "当前账号全部渠道";
            showMessage("success", `已导出${scope}公司记录（CSV）`);
        } else {
            showMessage("success", "已导出公司记录");
        }
    } catch (error) {
        showMessage("error", error.message);
    }
}

async function downloadAccountExport(path, ext, channel) {
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
    const ch = channel ? `-${channel}` : "";
    link.download = `${username}${ch}-companies.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
