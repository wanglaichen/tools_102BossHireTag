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

function parseDateValue(value) {
    if (value == null || value === "") {
        return null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const ms = value < 1e12 ? value * 1000 : value;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    if (/^\d{10,13}$/.test(text)) {
        const num = Number(text);
        const ms = text.length <= 10 ? num * 1000 : num;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(n) {
    return String(n).padStart(2, "0");
}

function formatTimeParts(value) {
    const date = parseDateValue(value);
    if (!date) {
        return null;
    }
    const y = date.getFullYear();
    const m = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const mm = pad2(date.getMinutes());
    const ss = pad2(date.getSeconds());
    return {
        date: `${y}-${m}-${d}`,
        time: `${hh}:${mm}:${ss}`,
        text: `${y}-${m}-${d} ${hh}:${mm}:${ss}`,
    };
}

function formatTime(value) {
    const parts = formatTimeParts(value);
    if (!parts) {
        return value ? String(value) : "-";
    }
    return parts.text;
}

function formatTimeHtml(value) {
    const parts = formatTimeParts(value);
    if (!parts) {
        return escapeHtml(value ? String(value) : "-");
    }
    return `<div class="time-stack"><span>${parts.date}</span><span>${parts.time}</span></div>`;
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

function hunterLabel(value) {
    if (value === "yes") {
        return "是猎头";
    }
    if (value === "no") {
        return "不是猎头";
    }
    return "未标记";
}

function outsourcedLabel(value) {
    if (value === "yes") {
        return "是外包";
    }
    if (value === "no") {
        return "不是外包";
    }
    return "未标记";
}

function interviewLabel(value) {
    return value === "yes" ? "已面试" : "未面试";
}

function interviewFlagClass(value) {
    return value === "yes" ? "yes" : "no";
}
