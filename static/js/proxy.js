async function loadProxySettings() {
    try {
        const data = await requestJson("/api/proxy");
        const proxyUrl = data.proxy_url || "";
        const check = byId("proxyEnableCheck");
        const input = byId("proxyInput");
        const btn = byId("saveProxyBtn");
        const status = byId("proxyStatus");

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
        // 顶部代理条常驻，失败时不隐藏
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
