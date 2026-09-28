/**
 * 时间区间选择器（对齐 AntiCheatCore DateTimeRangePicker）：
 * 触发按钮 + 双月日历 range + 开始/结束时分秒 + 清除/确定。
 */
(function (global) {
    const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

    function pad(n) {
        return String(n).padStart(2, "0");
    }

    function formatDateTime(d) {
        if (!d) return "";
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function formatDateKey(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function startOfDay(d) {
        const x = new Date(d);
        x.setHours(0, 0, 0, 0);
        return x;
    }

    function endOfDay(d) {
        const x = new Date(d);
        x.setHours(23, 59, 59, 999);
        return x;
    }

    function sameDay(a, b) {
        return a && b && formatDateKey(a) === formatDateKey(b);
    }

    function parseTimeParts(text, fallback) {
        const parts = String(text || fallback).split(":");
        const h = Number(parts[0] || 0);
        const m = Number(parts[1] || 0);
        const s = Number(parts[2] || 0);
        return [
            Number.isFinite(h) ? h : 0,
            Number.isFinite(m) ? m : 0,
            Number.isFinite(s) ? s : 0,
        ];
    }

    function combineDateAndTime(day, timeText, endOf) {
        if (!day) return undefined;
        const [h, m, s] = parseTimeParts(timeText, endOf ? "23:59:59" : "00:00:00");
        const out = new Date(day);
        out.setHours(h, m, s, endOf ? 999 : 0);
        return out;
    }

    class DateTimeRangePicker {
        constructor(root, options = {}) {
            this.root = typeof root === "string" ? document.querySelector(root) : root;
            if (!this.root) throw new Error("DateTimeRangePicker root not found");
            this.options = options;
            this.value = options.value || { from: undefined, to: undefined };
            this.draftRange = {
                from: this.value.from ? startOfDay(this.value.from) : undefined,
                to: this.value.to ? startOfDay(this.value.to) : undefined,
            };
            this.startTime = this.value.from
                ? `${pad(this.value.from.getHours())}:${pad(this.value.from.getMinutes())}:${pad(this.value.from.getSeconds())}`
                : "00:00:00";
            this.endTime = this.value.to
                ? `${pad(this.value.to.getHours())}:${pad(this.value.to.getMinutes())}:${pad(this.value.to.getSeconds())}`
                : "23:59:59";
            this.viewMonth = startOfDay(this.draftRange.from || new Date());
            this.viewMonth.setDate(1);
            this.open = false;
            this._onDocClick = (e) => {
                if (!this.open) return;
                if (!this.root.contains(e.target)) this.setOpen(false);
            };
            this.renderShell();
            document.addEventListener("click", this._onDocClick);
        }

        destroy() {
            document.removeEventListener("click", this._onDocClick);
        }

        getValue() {
            return { from: this.value.from, to: this.value.to };
        }

        setValue(range, { silent = false } = {}) {
            this.value = {
                from: range?.from ? new Date(range.from) : undefined,
                to: range?.to ? new Date(range.to) : undefined,
            };
            this.draftRange = {
                from: this.value.from ? startOfDay(this.value.from) : undefined,
                to: this.value.to ? startOfDay(this.value.to) : undefined,
            };
            this.startTime = this.value.from
                ? `${pad(this.value.from.getHours())}:${pad(this.value.from.getMinutes())}:${pad(this.value.from.getSeconds())}`
                : "00:00:00";
            this.endTime = this.value.to
                ? `${pad(this.value.to.getHours())}:${pad(this.value.to.getMinutes())}:${pad(this.value.to.getSeconds())}`
                : "23:59:59";
            if (this.draftRange.from) {
                this.viewMonth = startOfDay(this.draftRange.from);
                this.viewMonth.setDate(1);
            }
            this.updateTriggerText();
            this.root.classList.toggle("is-active", Boolean(this.value.from || this.value.to));
            if (this.open) this.renderPopoverBody();
            if (!silent && typeof this.options.onChange === "function") {
                this.options.onChange({ ...this.value });
            }
        }

        setOpen(next) {
            this.open = Boolean(next);
            this.popover.hidden = !this.open;
            this.trigger.setAttribute("aria-expanded", this.open ? "true" : "false");
            if (this.open) this.renderPopoverBody();
        }

        renderShell() {
            this.root.classList.add("dtrp");
            this.root.innerHTML = `
                <button type="button" class="dtrp-trigger btn btn-sm btn-outline-secondary" aria-expanded="false">
                    <span class="dtrp-trigger-icon" aria-hidden="true">▣</span>
                    <span class="dtrp-trigger-text"></span>
                </button>
                <div class="dtrp-popover" hidden></div>
            `;
            this.trigger = this.root.querySelector(".dtrp-trigger");
            this.triggerText = this.root.querySelector(".dtrp-trigger-text");
            this.popover = this.root.querySelector(".dtrp-popover");
            this.trigger.addEventListener("click", (e) => {
                e.stopPropagation();
                this.setOpen(!this.open);
            });
            this.popover.addEventListener("click", (e) => e.stopPropagation());
            this.updateTriggerText();
        }

        updateTriggerText() {
            const placeholder = this.options.placeholder || "选择日期和时间范围";
            if (this.value.from && this.value.to) {
                this.triggerText.textContent = `${formatDateTime(this.value.from)} - ${formatDateTime(this.value.to)}`;
            } else if (this.value.from) {
                this.triggerText.textContent = formatDateTime(this.value.from);
            } else {
                this.triggerText.textContent = placeholder;
            }
        }

        renderPopoverBody() {
            const maxDate = this.options.toDate ? startOfDay(this.options.toDate) : null;
            const left = new Date(this.viewMonth);
            const right = new Date(this.viewMonth);
            right.setMonth(right.getMonth() + 1);

            this.popover.innerHTML = `
                <div class="dtrp-calendars">
                    ${this.renderMonth(left, maxDate, "left")}
                    ${this.renderMonth(right, maxDate, "right")}
                </div>
                <div class="dtrp-times">
                    <label class="dtrp-time-field">
                        <span>开始时间</span>
                        <input type="time" step="1" class="form-control form-control-sm" data-role="start-time" value="${this.startTime}" ${this.draftRange.from ? "" : "disabled"}>
                    </label>
                    <label class="dtrp-time-field">
                        <span>结束时间</span>
                        <input type="time" step="1" class="form-control form-control-sm" data-role="end-time" value="${this.endTime}" ${this.draftRange.from ? "" : "disabled"}>
                    </label>
                </div>
                <div class="dtrp-actions">
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-role="clear">清除</button>
                    <button type="button" class="btn btn-sm btn-primary" data-role="apply">确定</button>
                </div>
            `;

            this.popover.querySelector('[data-role="prev"]').addEventListener("click", () => {
                this.viewMonth.setMonth(this.viewMonth.getMonth() - 1);
                this.renderPopoverBody();
            });
            this.popover.querySelector('[data-role="next"]').addEventListener("click", () => {
                this.viewMonth.setMonth(this.viewMonth.getMonth() + 1);
                this.renderPopoverBody();
            });
            this.popover.querySelectorAll("[data-day]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const day = startOfDay(new Date(btn.dataset.day));
                    this.selectDay(day);
                    this.renderPopoverBody();
                });
            });
            const startInput = this.popover.querySelector('[data-role="start-time"]');
            const endInput = this.popover.querySelector('[data-role="end-time"]');
            startInput?.addEventListener("change", () => {
                this.startTime = startInput.value || "00:00:00";
            });
            endInput?.addEventListener("change", () => {
                this.endTime = endInput.value || "23:59:59";
            });
            this.popover.querySelector('[data-role="clear"]').addEventListener("click", () => this.clear());
            this.popover.querySelector('[data-role="apply"]').addEventListener("click", () => this.apply());
        }

        selectDay(day) {
            if (!this.draftRange.from || (this.draftRange.from && this.draftRange.to)) {
                this.draftRange = { from: day, to: undefined };
                return;
            }
            if (day < this.draftRange.from) {
                this.draftRange = { from: day, to: this.draftRange.from };
            } else {
                this.draftRange.to = day;
            }
        }

        clear() {
            this.draftRange = { from: undefined, to: undefined };
            this.startTime = "00:00:00";
            this.endTime = "23:59:59";
            this.setValue({ from: undefined, to: undefined });
            this.setOpen(false);
        }

        apply() {
            if (!this.draftRange.from) {
                this.clear();
                return;
            }
            const from = combineDateAndTime(this.draftRange.from, this.startTime, false);
            const toDay = this.draftRange.to || this.draftRange.from;
            const to = combineDateAndTime(toDay, this.endTime, true);
            this.setValue({ from, to });
            this.setOpen(false);
        }

        renderMonth(monthDate, maxDate, side) {
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const first = new Date(year, month, 1);
            // Monday-first
            let startOffset = (first.getDay() + 6) % 7;
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const today = startOfDay(new Date());
            const cells = [];
            for (let i = 0; i < startOffset; i += 1) {
                cells.push('<span class="dtrp-day is-empty"></span>');
            }
            for (let day = 1; day <= daysInMonth; day += 1) {
                const current = new Date(year, month, day);
                const disabled = maxDate && current > maxDate;
                const inRange =
                    this.draftRange.from
                    && this.draftRange.to
                    && current >= this.draftRange.from
                    && current <= this.draftRange.to;
                const isStart = sameDay(current, this.draftRange.from);
                const isEnd = sameDay(current, this.draftRange.to);
                const classes = ["dtrp-day"];
                if (sameDay(current, today)) classes.push("is-today");
                if (isStart) classes.push("is-range-start");
                if (isEnd) classes.push("is-range-end");
                if (inRange) classes.push("is-in-range");
                if (disabled) classes.push("is-disabled");
                cells.push(
                    `<button type="button" class="${classes.join(" ")}" data-day="${formatDateKey(current)}" ${disabled ? "disabled" : ""}>${day}</button>`
                );
            }
            const navPrev = side === "left"
                ? '<button type="button" class="dtrp-nav-btn" data-role="prev" aria-label="上一月">‹</button>'
                : '<span class="dtrp-nav-spacer"></span>';
            const navNext = side === "right"
                ? '<button type="button" class="dtrp-nav-btn" data-role="next" aria-label="下一月">›</button>'
                : '<span class="dtrp-nav-spacer"></span>';
            return `
                <div class="dtrp-month">
                    <div class="dtrp-month-head">
                        ${navPrev}
                        <strong>${year}年${month + 1}月</strong>
                        ${navNext}
                    </div>
                    <div class="dtrp-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join("")}</div>
                    <div class="dtrp-days">${cells.join("")}</div>
                </div>
            `;
        }
    }

    global.DateTimeRangePicker = DateTimeRangePicker;
    global.DateTimeRangePickerHelpers = {
        formatDateTime,
        startOfDay,
        endOfDay,
        dayRange(offsetDays) {
            const day = startOfDay(new Date());
            day.setDate(day.getDate() + offsetDays);
            return { from: startOfDay(day), to: endOfDay(day) };
        },
    };
})(window);
