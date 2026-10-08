/* 拾光账本 Windows 初版：界面逻辑。持久化由受限 Electron 桥接完成。 */
(() => {
  "use strict";
  const Accounting = window.LedgerAccounting;
  const STORAGE_KEY = "shiguang-ledger-local-v2";
  const ENTRY_COLORS = [
    "#e7f0e6",
    "#f8eadd",
    "#e5edf5",
    "#f2e7ef",
    "#f3f0df",
    "#e7eee9",
  ];
  const CATEGORY_COLORS = [
    "#87ad8f",
    "#e3a681",
    "#8ba9cf",
    "#c49ab8",
    "#b8ab78",
    "#8ba9a1",
  ];
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const pad = (value) => String(value).padStart(2, "0");
  const monthOffset = (offset) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  };
  const money = (value) =>
    `¥ ${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const signedMoney = (value) =>
    `${value >= 0 ? "+" : "−"}${money(Math.abs(value))}`;
  const cents = (value) => Math.round(Number(value || 0) * 100);
  const round = (value) =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const uid = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const escapeHTML = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const formatDate = (value) => {
    const [year, month, day] = value.split("-");
    return `${Number(month)}月${Number(day)}日`;
  };
  const numeric = (value, allowZero = false) => {
    const text = String(value).trim();
    const number = Number(text);
    return /^\d+(?:\.\d{1,2})?$/.test(text) &&
      Number.isFinite(number) &&
      (allowZero ? number >= 0 : number > 0)
      ? round(number)
      : null;
  };

  function seedState() {
    const categories = [
      ["food", "餐饮美食", "expense", "#e3a681", "☕"],
      ["daily", "日常生活", "expense", "#87ad8f", "⌂"],
      ["travel", "交通出行", "expense", "#8ba9cf", "➤"],
      ["study", "学习成长", "expense", "#c49ab8", "✎"],
      ["fun", "休闲娱乐", "expense", "#b8ab78", "✦"],
      ["salary", "工资收入", "income", "#87ad8f", "↙"],
      ["side", "副业收入", "income", "#8ba9cf", "✧"],
      ["other-income", "其他收入", "income", "#c49ab8", "◌"],
    ].map(([id, name, type, color, icon]) => ({ id, name, type, color, icon }));
    return {
      schemaVersion: 2,
      categories,
      entries: [],
      finance: {
        initialCapital: 0,
        initialDate: today(),
        transfers: [],
        projects: [],
      },
      analysisPreferences: { excludedCategoryIds: [] },
    };
  }

  async function loadState() {
    if (window.ledgerApi) {
      const loaded = await window.ledgerApi.load();
      if (loaded) return loaded;
      const initial = seedState();
      await window.ledgerApi.save(initial);
      return initial;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed.schemaVersion === 2 &&
          Array.isArray(parsed.categories) &&
          Array.isArray(parsed.entries) &&
          parsed.finance?.projects &&
          parsed.finance?.transfers
        )
          return parsed;
      }
    } catch (error) {
      console.warn("本地数据读取失败。", error);
    }
    return seedState();
  }
  let state = seedState();
  let ledgerMonth = monthOffset(0);
  let analysisMonth = monthOffset(0);
  let analysisYear = new Date().getFullYear();
  let analysisPeriod = "month";
  let page = "ledger";
  let projectFilter = "active";
  let deleteAction = null;
  let toastTimer;
  let saveQueue = Promise.resolve();
  function save() {
    const snapshot = structuredClone(state);
    if (!window.ledgerApi) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      return Promise.resolve();
    }
    saveQueue = saveQueue
      .catch(() => {})
      .then(() => window.ledgerApi.save(snapshot));
    saveQueue.catch((error) => toast(`保存失败：${error.message}`));
    return saveQueue;
  }
  const category = (id) => state.categories.find((item) => item.id === id);
  const excludedCategoryIds = () => {
    if (!Array.isArray(state.analysisPreferences?.excludedCategoryIds))
      state.analysisPreferences = { excludedCategoryIds: [] };
    return state.analysisPreferences.excludedCategoryIds;
  };
  const sum = (array, fn) =>
    round(array.reduce((total, item) => total + fn(item), 0));
  const actualEntries = (entries) =>
    entries
      .map((item) => ({ ...item, amount: Accounting.actualAmount(item) }))
      .filter((item) => item.amount > 0);
  const specialSummary = (entry) =>
    Accounting.components(entry)
      .map(
        (part) =>
          `${part.name}${part.party ? ` · ${part.party}` : ""} ${money(part.amount)}`,
      )
      .join("；");

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 3000);
  }
  function showModal(selector) {
    const modal = $(selector);
    modal.classList.remove("hidden");
    modal.querySelector(".modal")?.scrollTo?.({ top: 0 });
    document.body.style.overflow = "hidden";
    setTimeout(
      () =>
        (
          modal.querySelector('form:not(.hidden) input:not([type="hidden"])') ||
          modal.querySelector("button")
        )?.focus(),
      0,
    );
  }
  function closeModals() {
    $$(".modal-backdrop").forEach((modal) => modal.classList.add("hidden"));
    document.body.style.overflow = "";
    deleteAction = null;
  }
  function render() {
    renderLedger();
    renderAnalysis();
    renderCategories();
    renderFinance();
  }
  function showPage(next) {
    page = next;
    $$(".nav-item").forEach((item) =>
      item.classList.toggle("active", item.dataset.page === next),
    );
    $$(".page").forEach((item) =>
      item.classList.toggle("active", item.id === `page-${next}`),
    );
    $("#breadcrumb-name").textContent = {
      ledger: "账目明细",
      analysis: "收支分析",
      finance: "理财管理",
      categories: "类别管理",
      settings: "数据与备份",
    }[next];
    $("#top-add").style.display = ["finance", "settings"].includes(next)
      ? "none"
      : "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function monthEntries(month) {
    return state.entries.filter((entry) => entry.date.startsWith(month));
  }
  function renderLedger() {
    $("#ledger-month").value = ledgerMonth;
    const current = monthEntries(ledgerMonth);
    const income = sum(
      current.filter((item) => item.type === "income"),
      (item) => Accounting.actualAmount(item),
    );
    const expense = sum(
      current.filter((item) => item.type === "expense"),
      (item) => Accounting.actualAmount(item),
    );
    $("#ledger-net").textContent = money(income - expense);
    $("#ledger-income").textContent = money(income);
    $("#ledger-expense").textContent = money(expense);
    $("#income-count").textContent =
      `${current.filter((item) => item.type === "income").length} 笔收入`;
    $("#expense-count").textContent =
      `${current.filter((item) => item.type === "expense").length} 笔支出`;
    $("#ledger-net-hint").textContent = "实际收支：已排除债务本金、垫付与报销";
    const categorySelect = $("#ledger-category");
    const selected = categorySelect.value;
    categorySelect.innerHTML =
      '<option value="all">全部类别</option>' +
      state.categories
        .map(
          (item) =>
            `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`,
        )
        .join("");
    categorySelect.value = [...categorySelect.options].some(
      (option) => option.value === selected,
    )
      ? selected
      : "all";
    const term = $("#ledger-search").value.trim().toLocaleLowerCase();
    const type = $("#ledger-type").value;
    const filtered = current
      .filter(
        (item) =>
          (type === "all" || item.type === type) &&
          (categorySelect.value === "all" ||
            item.categoryId === categorySelect.value) &&
          (!term ||
            `${item.description} ${category(item.categoryId)?.name || ""} ${specialSummary(item)}`
              .toLocaleLowerCase()
              .includes(term)),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
    $("#record-count").textContent = filtered.length;
    const groups = new Map();
    filtered.forEach((item) => {
      if (!groups.has(item.date)) groups.set(item.date, []);
      groups.get(item.date).push(item);
    });
    $("#ledger-list").innerHTML = filtered.length
      ? [...groups]
          .map(
            ([date, items]) =>
              `<div class="day-group"><div class="day-title">${formatDate(date)} · ${items.length} 笔</div>${items
                .map((item) => {
                  const cat = category(item.categoryId);
                  const special = item.special?.length || item.credit;
                  return `<div class="entry-row"><div class="entry-swatch" style="background:${escapeHTML(item.color)}">${escapeHTML(cat?.icon || "◌")}</div><div class="entry-main"><strong>${escapeHTML(item.description)}</strong><small>${escapeHTML(cat?.name || "未分类")} · ${item.type === "income" ? "收入" : "支出"}</small>${special ? `<div class="entry-breakdown">${escapeHTML(specialSummary(item))}<br>本笔现金${item.type === "income" ? "流入" : "流出"} ${money(Accounting.cashAmount(item))}</div>` : ""}</div><div class="entry-amount ${item.type}">${item.type === "income" ? "+" : "−"}${money(item.amount)}${item.credit ? "<small>含信用付款</small>" : ""}</div><div class="entry-actions"><button data-entry-edit="${escapeHTML(item.id)}" type="button" aria-label="编辑${escapeHTML(item.description)}">编辑</button><button class="delete-action" data-entry-delete="${escapeHTML(item.id)}" type="button" aria-label="删除${escapeHTML(item.description)}">删除</button></div></div>`;
                })
                .join("")}</div>`,
          )
          .join("")
      : `<div class="empty"><div><div class="empty-symbol">◌</div><strong>这里还没有账目</strong>试试切换月份或筛选条件，也可以记下第一笔。</div></div>`;
    const expenseGroups = groupByCategory(
      actualEntries(current).filter((item) => item.type === "expense"),
    );
    const top = expenseGroups[0];
    $("#top-category").innerHTML = top
      ? `<div class="top-category-name"><span class="category-icon" style="background:${escapeHTML(top.color)}33;color:${escapeHTML(top.color)}">${escapeHTML(top.icon)}</span>${escapeHTML(top.name)}</div><div class="top-category-amount">${money(top.amount)}</div><div class="progress-track"><span style="width:${expense ? Math.round((top.amount / expense) * 100) : 0}%"></span></div><small>占本月总支出 ${expense ? Math.round((top.amount / expense) * 100) : 0}%</small>`
      : '<div class="distribution-empty">本月还没有支出记录。</div>';
  }
  function groupByCategory(items) {
    const grouped = new Map();
    items.forEach((item) => {
      const cat = category(item.categoryId);
      const existing = grouped.get(item.categoryId) || {
        id: item.categoryId,
        name: cat?.name || "未分类",
        color: cat?.color || "#aab3a9",
        icon: cat?.icon || "◌",
        amount: 0,
      };
      existing.amount = round(existing.amount + item.amount);
      grouped.set(item.categoryId, existing);
    });
    return [...grouped.values()].sort((a, b) => b.amount - a.amount);
  }

  function analysisCutoff() {
    if (analysisPeriod === "year") return `${analysisYear}-12-31`;
    const [year, month] = analysisMonth.split("-").map(Number);
    return `${analysisMonth}-${pad(new Date(year, month, 0).getDate())}`;
  }
  function renderObligations() {
    const cutoff = analysisCutoff();
    const report = Accounting.balances(state.entries, cutoff);
    $("#obligations-cutoff").textContent =
      `截至 ${cutoff} 的全历史累计余额，包含本期之前未结清的往来。`;
    const total = (claims) => sum(claims, (claim) => claim.remaining);
    $("#obligations-summary").innerHTML = [
      ["我尚未还清", total(report.claims.filter((c) => c.kind === "borrowed"))],
      ["别人尚未归还", total(report.claims.filter((c) => c.kind === "lent"))],
      ["待报销到账", total(report.reimbursements)],
    ]
      .map(
        ([label, amount]) =>
          `<div><span>${label}</span><strong>${money(amount)}</strong></div>`,
      )
      .join("");
    const term = $("#obligations-search").value.trim().toLocaleLowerCase();
    const showSettled = $("#obligations-settled").checked;
    const matches = (claim) =>
      (showSettled || claim.remaining > 0) &&
      `${claim.party} ${claim.description}`.toLocaleLowerCase().includes(term);
    const claimHTML = (claim) => {
      const kind = {
        borrowed: "repaid",
        lent: "recovered",
        reimbursable: "reimbursed",
      }[claim.kind];
      const action = {
        borrowed: "记还款",
        lent: "记收回",
        reimbursable: "记报销",
      }[claim.kind];
      return `<div class="obligation-record"><div><button class="text-link" type="button" data-obligation-edit="${escapeHTML(claim.entryId)}">${escapeHTML(claim.description)}</button><small>${claim.date}${claim.credit ? " · 信用付款" : ""}${claim.party ? ` · ${escapeHTML(claim.party)}` : ""}</small></div><div class="obligation-amounts"><span>原额 <b>${money(claim.amount)}</b></span><span>${claim.kind === "reimbursable" ? "已到账" : "已结算"} <b>${money(claim.settled)}</b></span><span>未结清 <b>${money(claim.remaining)}</b></span></div>${claim.remaining > 0 ? `<button type="button" class="secondary-button" data-settle="${escapeHTML(claim.id)}" data-settle-kind="${kind}">${action}</button>` : '<span class="settled-badge">已结清</span>'}</div>${claim.settlements.length ? `<details class="settlement-history"><summary>${claim.settlements.length} 笔结算记录</summary>${claim.settlements.map((s) => `<div><button class="text-link" type="button" data-obligation-edit="${escapeHTML(s.entryId)}">${s.date} · ${escapeHTML(s.description)}</button><strong>${money(s.amount)}</strong></div>`).join("")}</details>` : ""}`;
    };
    for (const [kind, selector] of [
      ["borrowed", "#payables-list"],
      ["lent", "#receivables-list"],
    ]) {
      $(selector).innerHTML =
        report.debts
          .filter((d) => d.kind === kind && d.claims.some(matches))
          .map(
            (debt) =>
              `<details class="debt-group" open><summary><strong>${escapeHTML(debt.party)}</strong><span>${kind === "borrowed" ? "我还欠" : "还欠我"} ${money(debt.remaining)}</span></summary>${debt.claims.filter(matches).map(claimHTML).join("")}</details>`,
          )
          .join("") || '<p class="distribution-empty">没有符合条件的往来。</p>';
    }
    $("#reimbursements-list").innerHTML =
      report.reimbursements.filter(matches).map(claimHTML).join("") ||
      '<p class="distribution-empty">没有符合条件的可报销账目。</p>';
    const legacy = state.entries.filter(
      (e) => e.date <= cutoff && Accounting.legacyKind(e, state.categories),
    );
    $("#legacy-warning").classList.toggle("hidden", !legacy.length);
    $("#legacy-warning").innerHTML = legacy.length
      ? `<strong>${legacy.length} 笔旧类别账目尚未补充往来信息</strong><p>已有债务 / 报销类别没有对方和关联关系，暂按原金额统计。请逐笔补充特定标签后，才会进入债务与报销余额。</p><div>${legacy.map((e) => `<button type="button" class="text-link" data-obligation-edit="${escapeHTML(e.id)}">${e.date} · ${escapeHTML(e.description)} · ${money(e.amount)}</button>`).join("")}</div>`
      : "";
  }
  function renderAnalysis() {
    $("#analysis-month").value = analysisMonth;
    const years = [
      ...new Set([
        new Date().getFullYear(),
        ...state.entries.map((item) => Number(item.date.slice(0, 4))),
      ]),
    ].sort((a, b) => b - a);
    $("#analysis-year").innerHTML = years
      .map((year) => `<option value="${year}">${year} 年</option>`)
      .join("");
    if (!years.includes(analysisYear)) analysisYear = years[0];
    $("#analysis-year").value = String(analysisYear);
    $("#analysis-month").style.display =
      analysisPeriod === "month" ? "" : "none";
    $("#analysis-year").style.display = analysisPeriod === "year" ? "" : "none";
    $$("[data-period]").forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.period === analysisPeriod,
      ),
    );
    const originalItems = state.entries.filter((entry) =>
      analysisPeriod === "month"
        ? entry.date.startsWith(analysisMonth)
        : entry.date.startsWith(String(analysisYear)),
    );
    const basis = state.analysisPreferences?.basis || "actual";
    $("#analysis-basis").value = basis;
    $("#analysis-basis-hint").textContent =
      basis === "actual"
        ? "只统计自己的消费和收入。垫付、待报销及债务本金单独跟踪；信用消费在消费当天计入。"
        : "统计本期现金流入与流出，包含债务本金和报销到账；信用付款在还款时体现现金流出。";
    const items = originalItems
      .map((entry) => ({
        ...entry,
        amount:
          basis === "actual"
            ? Accounting.actualAmount(entry)
            : Accounting.cashAmount(entry),
      }))
      .filter((entry) => entry.amount > 0);
    const incomes = items.filter((item) => item.type === "income");
    const expenses = items.filter((item) => item.type === "expense");
    const income = sum(incomes, (item) => item.amount);
    const expense = sum(expenses, (item) => item.amount);
    const net = round(income - expense);
    $("#analysis-period-label").textContent =
      analysisPeriod === "month"
        ? `${Number(analysisMonth.slice(5))} 月净结余`
        : `${analysisYear} 年净结余`;
    $("#analysis-net").textContent = money(net);
    $("#analysis-income").textContent = money(income);
    $("#analysis-expense").textContent = money(expense);
    $("#analysis-status").textContent =
      net >= 0 ? "收入高于支出，结余为正" : "支出高于收入，结余为负";
    $("#trend-title").textContent =
      analysisPeriod === "month" ? "每周收支" : "每月收支";
    renderTrend(items);
    renderDistributionControls("expense");
    renderDistributionControls("income");
    renderDistribution("#expense-distribution", expenses, "expense");
    renderDistribution("#income-distribution", incomes, "income");
    const top = groupByCategory(expenses)[0];
    $("#analysis-note").textContent =
      originalItems.length === 0
        ? "这段时间还没有记录。添上几笔账目后，分析会自动出现。"
        : items.length === 0
          ? `本期记录 ${originalItems.length} 笔账目，当前口径金额为零；债务与报销明细可在下方查看。`
          : top
            ? `这段时间共记录 ${items.length} 笔账目。支出最多的是“${top.name}”，占总支出的 ${Math.round((top.amount / expense) * 100)}%。${net >= 0 ? "整体保持了正结余。" : "整体支出超过了收入。"}`
            : `这段时间共记录 ${items.length} 笔账目，暂时没有支出。`;
    renderObligations();
  }
  function renderTrend(items) {
    const keys =
      analysisPeriod === "month"
        ? [1, 2, 3, 4, 5]
        : Array.from({ length: 12 }, (_, i) => i + 1);
    const values = keys.map((key) => {
      const subset = items.filter((item) =>
        analysisPeriod === "month"
          ? Math.ceil(Number(item.date.slice(8, 10)) / 7) === key
          : Number(item.date.slice(5, 7)) === key,
      );
      return {
        label: analysisPeriod === "month" ? `第${key}周` : `${key}月`,
        income: sum(
          subset.filter((item) => item.type === "income"),
          (item) => item.amount,
        ),
        expense: sum(
          subset.filter((item) => item.type === "expense"),
          (item) => item.amount,
        ),
      };
    });
    const max = Math.max(
      1,
      ...values.flatMap((item) => [item.income, item.expense]),
    );
    $("#trend-chart").innerHTML = values
      .map(
        (item) =>
          `<div class="trend-group"><div class="trend-bars"><div class="trend-bar income" style="height:${Math.max(1, (item.income / max) * 100)}%" title="${item.label} 收入 ${money(item.income)}"></div><div class="trend-bar expense" style="height:${Math.max(1, (item.expense / max) * 100)}%" title="${item.label} 支出 ${money(item.expense)}"></div></div><span class="trend-label">${item.label}</span></div>`,
      )
      .join("");
  }
  function renderDistributionControls(type) {
    const items = state.categories.filter((item) => item.type === type);
    const excluded = new Set(excludedCategoryIds());
    const selected = items.filter((item) => !excluded.has(item.id)).length;
    $(`#${type}-category-filter`).innerHTML =
      `<div class="distribution-control-head"><span>已选 ${selected} / ${items.length} 类</span><div class="distribution-control-actions"><button type="button" data-distribution-action="all" data-distribution-type="${type}">全选</button><button type="button" data-distribution-action="none" data-distribution-type="${type}">清空</button></div></div><div class="distribution-options">${items.length ? items.map((item) => `<label class="distribution-option ${excluded.has(item.id) ? "is-excluded" : ""}"><input type="checkbox" data-distribution-category="${escapeHTML(item.id)}" ${excluded.has(item.id) ? "" : "checked"}><span>${escapeHTML(item.name)}</span></label>`).join("") : '<span class="distribution-empty">暂无类别，可先到类别管理添加。</span>'}</div>`;
  }
  function renderDistribution(selector, items, type) {
    const excluded = new Set(excludedCategoryIds());
    const selectedCategories = state.categories.filter(
      (item) => item.type === type && !excluded.has(item.id),
    );
    if (!selectedCategories.length) {
      $(selector).innerHTML =
        '<div class="distribution-empty">尚未选择参与统计的类别。勾选后即可查看占比。</div>';
      return;
    }
    const selectedItems = items.filter(
      (item) => !excluded.has(item.categoryId),
    );
    const groups = groupByCategory(selectedItems),
      total = sum(selectedItems, (item) => item.amount);
    if (!groups.length) {
      $(selector).innerHTML =
        '<div class="distribution-empty">所选类别在这段时间没有记录。</div>';
      return;
    }
    let position = 0;
    const segments = groups.map((item) => {
      const start = position;
      position += (item.amount / total) * 100;
      return `${item.color} ${start}% ${position}%`;
    });
    $(selector).innerHTML =
      `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${segments.join(",")})"><div class="donut-center"><span>所选总计</span><strong>${money(total)}</strong></div></div><div class="distribution-list">${groups.map((item) => `<div class="distribution-row" title="${escapeHTML(item.name)}：${money(item.amount)}"><span><i style="background:${escapeHTML(item.color)}"></i>${escapeHTML(item.name)}</span><strong>${Math.round((item.amount / total) * 100)}%</strong></div>`).join("")}</div></div>`;
  }

  function renderCategories() {
    $("#fixed-tags-list").innerHTML = Object.values(Accounting.TAGS)
      .map(
        (tag) =>
          `<div><strong>${tag.name}</strong><small>${tag.claim ? tag.party : "关联原始账目，支持部分结算"}</small></div>`,
      )
      .join("");
    ["expense", "income"].forEach((type) => {
      const items = state.categories.filter((item) => item.type === type);
      $(`#${type}-category-count`).textContent = items.length;
      $(`#${type}-categories`).innerHTML =
        items
          .map((item) => {
            const count = state.entries.filter(
              (entry) => entry.categoryId === item.id,
            ).length;
            return `<div class="category-row"><span class="category-icon" style="background:${escapeHTML(item.color)}30;color:${escapeHTML(item.color)}">${escapeHTML(item.icon || "◌")}</span><div class="category-row-main"><strong>${escapeHTML(item.name)}</strong><small>${count} 笔账目使用</small></div><div class="category-row-actions"><button data-category-edit="${escapeHTML(item.id)}" type="button">编辑</button><button class="delete-action" data-category-delete="${escapeHTML(item.id)}" type="button">删除</button></div></div>`;
          })
          .join("") ||
        '<div class="distribution-empty">暂无类别，点击右上方新建。</div>';
    });
  }

  function financeEvents(finance = state.finance) {
    const events = finance.transfers.map((item) => ({
      date: item.date,
      kind: item.type,
      title:
        item.note || (item.type === "deposit" ? "转入资金池" : "从资金池转出"),
      amount: item.type === "deposit" ? item.amount : -item.amount,
      priority: item.type === "deposit" ? 0 : 3,
    }));
    finance.projects.forEach((project) => {
      events.push({
        date: project.investedDate,
        kind: "invest",
        title: `投入 · ${project.name}`,
        amount: -project.invested,
        priority: 2,
      });
      if (project.status === "redeemed")
        events.push({
          date: project.redeemedDate,
          kind: "redeem",
          title: `赎回 · ${project.name}`,
          amount: project.redeemedAmount,
          priority: 1,
        });
    });
    return events.sort(
      (a, b) => a.date.localeCompare(b.date) || a.priority - b.priority,
    );
  }
  function validateFinance(finance) {
    const events = financeEvents(finance);
    if (events.some((item) => item.date < finance.initialDate))
      return "资金记录不能早于起始资金日期。";
    let balance = cents(finance.initialCapital);
    let date = "";
    for (const event of events) {
      balance += cents(event.amount);
      date = event.date;
      if (balance < 0)
        return `${formatDate(date)} 的资金池会变为负数，请先转入足够资金。`;
    }
    return null;
  }
  function financeStats() {
    const projects = state.finance.projects,
      active = projects.filter((item) => item.status === "active"),
      redeemed = projects.filter((item) => item.status === "redeemed");
    const pool = round(
      state.finance.initialCapital +
        sum(financeEvents(), (event) => event.amount),
    );
    const principal = sum(active, (item) => item.invested),
      value = sum(active, (item) => item.currentValue);
    const floating = round(value - principal),
      realized = sum(redeemed, (item) => item.redeemedAmount - item.invested);
    return {
      pool,
      principal,
      value,
      floating,
      realized,
      profit: round(floating + realized),
      active,
    };
  }
  function renderFinance() {
    const stats = financeStats(),
      finance = state.finance;
    $("#finance-pool").textContent = money(stats.pool);
    $("#finance-principal").textContent = money(stats.principal);
    $("#finance-value").textContent = money(stats.value);
    $("#finance-profit").textContent = signedMoney(stats.profit);
    $("#finance-profit").className =
      stats.profit >= 0 ? "positive" : "negative";
    $("#finance-active-count").textContent =
      `${stats.active.length} 个在投项目`;
    $("#finance-profit-hint").textContent =
      `已实现 ${signedMoney(stats.realized)} · 浮动 ${signedMoney(stats.floating)}`;
    $$("[data-project-filter]").forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.projectFilter === projectFilter,
      ),
    );
    const shown = finance.projects
      .filter((item) => item.status === projectFilter)
      .sort((a, b) => b.investedDate.localeCompare(a.investedDate));
    $("#project-count").textContent = shown.length;
    $("#project-list").innerHTML = shown.length
      ? shown
          .map((project) => {
            const active = project.status === "active";
            const value = active
              ? project.currentValue
              : project.redeemedAmount;
            const gain = round(value - project.invested);
            const matured =
              active && project.maturityDate && project.maturityDate <= today();
            return `<article class="project-card"><div class="project-card-top"><div class="project-mark">◇</div><div class="project-title"><strong>${escapeHTML(project.name)}</strong><span>${escapeHTML(project.form)}${project.annualRate !== null ? ` · 参考年化 ${escapeHTML(project.annualRate)}%` : ""}</span></div><span class="project-status ${active ? (matured ? "matured" : "") : "redeemed"}">${active ? (matured ? "已到期" : "持有中") : "已赎回"}</span></div><div class="project-numbers"><div><span>投入本金</span><strong>${money(project.invested)}</strong></div><div><span>${active ? "当前价值" : "实际到账"}</span><strong>${money(value)}</strong></div><div><span>${active ? "浮动盈亏" : "已实现盈亏"}</span><strong class="${gain >= 0 ? "positive" : "negative"}">${signedMoney(gain)}</strong></div></div><div class="project-meta"><span>投入 ${formatDate(project.investedDate)} · ${active ? (project.maturityDate ? `预计到期 ${formatDate(project.maturityDate)}` : "无固定到期日") : `赎回 ${formatDate(project.redeemedDate)}`}</span>${active ? `<div class="project-actions"><button type="button" data-project-edit="${escapeHTML(project.id)}">更新 / 编辑</button><button type="button" data-project-redeem="${escapeHTML(project.id)}">赎回</button></div>` : ""}</div></article>`;
          })
          .join("")
      : `<div class="empty"><div><div class="empty-symbol">◇</div><strong>${projectFilter === "active" ? "暂无在投项目" : "暂无赎回记录"}</strong>${projectFilter === "active" ? "先从资金池投入一笔试试。" : "项目赎回后会显示在这里。"}</div></div>`;
    const deposits = sum(
      finance.transfers.filter((item) => item.type === "deposit"),
      (item) => item.amount,
    );
    const withdrawals = sum(
      finance.transfers.filter((item) => item.type === "withdraw"),
      (item) => item.amount,
    );
    const invested = sum(finance.projects, (item) => item.invested);
    const redeemed = sum(
      finance.projects.filter((item) => item.status === "redeemed"),
      (item) => item.redeemedAmount,
    );
    $("#pool-breakdown").innerHTML =
      `<div class="pool-breakdown"><div class="pool-line"><span>起始资金 · ${formatDate(finance.initialDate)}</span><strong>${money(finance.initialCapital)}</strong></div><div class="pool-line"><span>外部转入</span><strong>+ ${money(deposits)}</strong></div><div class="pool-line"><span>外部转出</span><strong>− ${money(withdrawals)}</strong></div><div class="pool-line"><span>项目投入</span><strong>− ${money(invested)}</strong></div><div class="pool-line"><span>项目赎回到账</span><strong>+ ${money(redeemed)}</strong></div><div class="pool-line total"><span>当前可用</span><strong>${money(stats.pool)}</strong></div></div>`;
    const activity = financeEvents()
      .sort((a, b) => b.date.localeCompare(a.date) || b.priority - a.priority)
      .slice(0, 6);
    $("#finance-activity").innerHTML =
      activity
        .map(
          (item) =>
            `<div class="activity-row"><div class="activity-icon ${item.amount < 0 ? "out" : ""}">${item.amount < 0 ? "↗" : "↙"}</div><div class="activity-main"><strong>${escapeHTML(item.title)}</strong><small>${formatDate(item.date)}</small></div><span class="activity-amount ${item.amount < 0 ? "out" : "in"}">${signedMoney(item.amount)}</span></div>`,
        )
        .join("") || '<div class="distribution-empty">暂无资金动态。</div>';
  }

  function renderColors(container, colors, selected, onSelect) {
    $(container).innerHTML = colors
      .map(
        (color) =>
          `<button type="button" class="color-option" style="background:${color}" data-color="${color}" aria-label="选择颜色 ${color}" role="radio" aria-checked="${color === selected}">${color === selected ? "✓" : ""}</button>`,
      )
      .join("");
    $(container).onclick = (event) => {
      const button = event.target.closest("[data-color]");
      if (button) onSelect(button.dataset.color);
    };
  }
  let entryColor = ENTRY_COLORS[0],
    categoryColor = CATEGORY_COLORS[0];
  let draftSpecial = [];
  function draftClaims() {
    return Accounting.claims(
      state.entries.filter((e) => e.id !== $("#entry-id").value),
    );
  }
  function renderSpecialRows() {
    const type = $("#entry-type").value;
    $("#credit-controls").classList.toggle("hidden", type !== "expense");
    $("#entry-credit-fields").classList.toggle(
      "hidden",
      !$("#entry-credit-enabled").checked,
    );
    $("#entry-special-actions").innerHTML = Object.entries(Accounting.TAGS)
      .filter(([, tag]) => tag.type === type)
      .map(
        ([kind, tag]) =>
          `<button type="button" class="secondary-button" data-add-special="${kind}">＋ ${tag.name}</button>`,
      )
      .join("");
    const claims = draftClaims();
    $("#entry-special-rows").innerHTML = draftSpecial
      .map((part, index) => {
        const tag = Accounting.TAGS[part.kind];
        const options = tag.target
          ? claims
              .filter(
                (c) =>
                  c.kind === tag.target &&
                  (c.remaining > 0 || c.id === part.targetId),
              )
              .map(
                (c) =>
                  `<option value="${escapeHTML(c.id)}" ${c.id === part.targetId ? "selected" : ""}>${escapeHTML(c.party || "未指定单位")} · ${c.date} · ${escapeHTML(c.description)} · 待结算 ${money(c.remaining)}</option>`,
              )
              .join("")
          : "";
        return `<div class="special-row" data-special-index="${index}"><div class="special-row-head"><strong>${tag.name}</strong><button type="button" class="delete-action" data-remove-special="${index}" aria-label="移除${tag.name}明细">移除</button></div>${tag.target ? `<div class="field"><label>关联原始账目 <em>*</em><select data-special-field="targetId" aria-label="${tag.name}关联原始账目"><option value="">请选择（可跨月关联）</option>${options}</select></label></div>` : ""}<div class="field-grid"><div class="field"><label>${tag.party}<input data-special-field="party" value="${escapeHTML(part.party)}" maxlength="60" list="party-suggestions" ${tag.target && claims.find((c) => c.id === part.targetId)?.party ? "readonly" : ""} placeholder="${part.kind === "reimbursable" ? "例如：公司差旅" : "名称需与之前保持一致"}" aria-label="${tag.name}对方"></label></div><div class="field"><label>金额 <em>*</em><input data-special-field="amount" type="number" min="0.01" max="1000000000" step="0.01" value="${part.amount || ""}" aria-label="${tag.name}金额"></label></div></div></div>`;
      })
      .join("");
    const parties = new Set(
      state.entries
        .flatMap((e) => [
          ...(e.special || []).map((p) => p.party),
          e.credit?.party,
        ])
        .filter(Boolean),
    );
    $("#party-suggestions").innerHTML = [...parties]
      .sort()
      .map((party) => `<option value="${escapeHTML(party)}"></option>`)
      .join("");
    renderSplitPreview();
  }
  function readEntrySpecial() {
    return draftSpecial.map((part) => ({
      ...part,
      party: part.party.trim(),
      amount: Number(part.amount),
    }));
  }
  function draftCredit() {
    return $("#entry-type").value === "expense" &&
      $("#entry-credit-enabled").checked
      ? {
          party: $("#entry-credit-party").value.trim(),
          amount: Number(
            $("#entry-credit-amount").value || $("#entry-amount").value,
          ),
        }
      : undefined;
  }
  function renderSplitPreview() {
    const amount = numeric($("#entry-amount").value);
    const preview = $("#entry-split-preview");
    if (amount === null) {
      preview.textContent = "填入总金额后，会显示自动拆分结果。";
      return;
    }
    const entry = {
      type: $("#entry-type").value,
      amount,
      special: readEntrySpecial(),
      credit: draftCredit(),
    };
    const error =
      Accounting.actualAmount(entry) < 0 ||
      (entry.credit && entry.credit.amount > amount);
    preview.classList.toggle("is-error", Boolean(error));
    preview.innerHTML = error
      ? "明细合计或信用付款金额超过本笔总金额，请调整。"
      : `<strong>自动拆分 · ${entry.type === "expense" ? "支出" : "收入"} ${money(amount)}</strong><div>${Accounting.components(
          entry,
        )
          .map(
            (part) =>
              `<span>${escapeHTML(part.name)}${part.party ? ` · ${escapeHTML(part.party)}` : ""}<b>${money(part.amount)}</b></span>`,
          )
          .join(
            "",
          )}</div><small>本笔现金${entry.type === "expense" ? "流出" : "流入"} ${money(Accounting.cashAmount(entry))}${entry.credit ? "；信用付款是资金来源，单独增加欠款。" : ""}</small>`;
  }
  function addSpecial(kind, claim = null) {
    if (draftSpecial.length >= 50) return toast("每笔最多添加 50 项明细。");
    const used = sum(draftSpecial, (p) => Number(p.amount) || 0);
    draftSpecial.push({
      id: uid(),
      kind,
      party: claim?.party || "",
      amount:
        claim?.remaining ??
        Math.max(0, round(Number($("#entry-amount").value || 0) - used)),
      ...(Accounting.TAGS[kind].target ? { targetId: claim?.id || "" } : {}),
    });
    renderSpecialRows();
    $("#entry-special-rows")
      .lastElementChild?.querySelector("select, input")
      ?.focus();
  }
  function setEntryType(type) {
    if ($("#entry-type").value !== type) {
      draftSpecial = [];
      $("#entry-credit-enabled").checked = false;
    }
    $("#entry-type").value = type;
    $$("[data-entry-type]").forEach((button) =>
      button.classList.toggle("active", button.dataset.entryType === type),
    );
    const items = state.categories.filter((item) => item.type === type);
    $("#entry-category").innerHTML = items
      .map(
        (item) =>
          `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`,
      )
      .join("");
    renderSpecialRows();
  }
  function openEntry(id = null) {
    const item = state.entries.find((entry) => entry.id === id);
    $("#entry-form").reset();
    draftSpecial = [];
    $("#entry-id").value = item?.id || "";
    $("#entry-modal-title").textContent = item ? "编辑账目" : "记一笔";
    setEntryType(item?.type || "expense");
    $("#entry-amount").value = item?.amount ?? "";
    $("#entry-date").value = item?.date || today();
    $("#entry-category").value =
      item?.categoryId || $("#entry-category").options[0]?.value || "";
    $("#entry-description").value = item?.description || "";
    draftSpecial = structuredClone(item?.special || []);
    $("#entry-credit-enabled").checked = Boolean(item?.credit);
    $("#entry-credit-party").value = item?.credit?.party || "";
    $("#entry-credit-amount").value = item?.credit?.amount ?? "";
    const legacy = item && Accounting.legacyKind(item, state.categories);
    if (legacy)
      draftSpecial.push({
        id: uid(),
        kind: legacy,
        party: "",
        amount: item.amount,
        ...(Accounting.TAGS[legacy].target ? { targetId: "" } : {}),
      });
    renderSpecialRows();
    entryColor = item?.color || ENTRY_COLORS[0];
    renderColors("#entry-colors", ENTRY_COLORS, entryColor, updateEntryColors);
    showModal("#entry-modal");
  }
  function updateEntryColors(value) {
    entryColor = value;
    renderColors("#entry-colors", ENTRY_COLORS, entryColor, updateEntryColors);
  }
  function openCategory(id = null) {
    const item = state.categories.find((candidate) => candidate.id === id);
    $("#category-form").reset();
    $("#category-id").value = item?.id || "";
    $("#category-modal-title").textContent = item ? "编辑类别" : "新建类别";
    $("#category-type").value = item?.type || "expense";
    $("#category-type").disabled = Boolean(
      item && state.entries.some((entry) => entry.categoryId === item.id),
    );
    $("#category-name").value = item?.name || "";
    categoryColor = item?.color || CATEGORY_COLORS[0];
    renderColors(
      "#category-colors",
      CATEGORY_COLORS,
      categoryColor,
      updateCategoryColors,
    );
    showModal("#category-modal");
  }
  function updateCategoryColors(value) {
    categoryColor = value;
    renderColors(
      "#category-colors",
      CATEGORY_COLORS,
      categoryColor,
      updateCategoryColors,
    );
  }
  function confirmDelete(message, action) {
    $("#confirm-copy").textContent = message;
    deleteAction = action;
    showModal("#confirm-modal");
  }

  function openFinance(mode, id = null) {
    $$(".finance-form").forEach((form) => form.classList.add("hidden"));
    $(`#${mode}-form`).classList.remove("hidden");
    $("#finance-modal-title").textContent = {
      project: id ? "编辑理财项目" : "新建理财项目",
      transfer: "资金划转",
      capital: "设置起始资金",
      redeem: "赎回项目",
    }[mode];
    if (mode === "project") {
      const item = state.finance.projects.find((project) => project.id === id);
      $("#project-form").reset();
      $("#project-id").value = item?.id || "";
      $("#project-name").value = item?.name || "";
      $("#project-kind").value = item?.form || "";
      $("#project-invested-date").value = item?.investedDate || today();
      $("#project-invested-date").max = today();
      $("#project-maturity-date").value = item?.maturityDate || "";
      $("#project-invested").value = item?.invested ?? "";
      $("#project-value").value = item?.currentValue ?? "";
      $("#project-rate").value = item?.annualRate ?? "";
    }
    if (mode === "transfer") {
      $("#transfer-form").reset();
      $("#transfer-date").value = today();
      $("#transfer-date").max = today();
      setTransferType("deposit");
    }
    if (mode === "capital") {
      $("#capital-date").value = state.finance.initialDate;
      $("#capital-amount").value = state.finance.initialCapital;
    }
    if (mode === "redeem") {
      const item = state.finance.projects.find((project) => project.id === id);
      $("#redeem-form").reset();
      $("#redeem-project-id").value = id;
      $("#redeem-date").value = today();
      $("#redeem-date").min = item.investedDate;
      $("#redeem-date").max = today();
      $("#redeem-amount").value = item.currentValue;
    }
    showModal("#finance-modal");
  }
  function setTransferType(type) {
    $("#transfer-type").value = type;
    $$("[data-transfer-type]").forEach((button) =>
      button.classList.toggle("active", button.dataset.transferType === type),
    );
  }
  function commitFinance(candidate, success) {
    const error = validateFinance(candidate);
    if (error) {
      toast(error);
      return false;
    }
    state.finance = candidate;
    save();
    renderFinance();
    closeModals();
    toast(success);
    return true;
  }

  $$(".nav-item").forEach((button) =>
    button.addEventListener("click", () => showPage(button.dataset.page)),
  );
  $$(".close-modal").forEach((button) =>
    button.addEventListener("click", closeModals),
  );
  $$(".modal-backdrop").forEach((backdrop) =>
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) closeModals();
    }),
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModals();
  });
  $("#top-add").addEventListener("click", () => openEntry());
  $("#quick-add").addEventListener("click", () => openEntry());
  $("#ledger-month").addEventListener("change", (event) => {
    ledgerMonth = event.target.value || monthOffset(0);
    renderLedger();
  });
  $("#ledger-search").addEventListener("input", renderLedger);
  $("#ledger-type").addEventListener("change", renderLedger);
  $("#ledger-category").addEventListener("change", renderLedger);
  $("#clear-filters").addEventListener("click", () => {
    $("#ledger-search").value = "";
    $("#ledger-type").value = "all";
    $("#ledger-category").value = "all";
    renderLedger();
  });
  $("#ledger-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-entry-edit]"),
      remove = event.target.closest("[data-entry-delete]");
    if (edit) openEntry(edit.dataset.entryEdit);
    if (remove) {
      const item = state.entries.find(
        (entry) => entry.id === remove.dataset.entryDelete,
      );
      confirmDelete(
        `删除“${item.description}”这笔账目？此操作无法撤销。`,
        async () => {
          const candidate = state.entries.filter(
            (entry) => entry.id !== item.id,
          );
          try {
            Accounting.validate(candidate);
          } catch (error) {
            return toast(error.message);
          }
          const previous = state.entries;
          state.entries = candidate;
          try {
            await save();
          } catch (error) {
            state.entries = previous;
            render();
            return;
          }
          render();
          toast("账目已删除");
        },
      );
    }
  });
  $$("[data-entry-type]").forEach((button) =>
    button.addEventListener("click", () =>
      setEntryType(button.dataset.entryType),
    ),
  );
  $("#entry-special-actions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-special]");
    if (button) addSpecial(button.dataset.addSpecial);
  });
  $("#entry-special-rows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-special]");
    if (button) {
      draftSpecial.splice(Number(button.dataset.removeSpecial), 1);
      renderSpecialRows();
    }
  });
  $("#entry-special-rows").addEventListener("input", (event) => {
    const field = event.target.dataset.specialField;
    if (!field || field === "targetId") return;
    const index = Number(
      event.target.closest("[data-special-index]").dataset.specialIndex,
    );
    draftSpecial[index][field] = event.target.value;
    renderSplitPreview();
  });
  $("#entry-special-rows").addEventListener("change", (event) => {
    if (event.target.dataset.specialField !== "targetId") return;
    const index = Number(
      event.target.closest("[data-special-index]").dataset.specialIndex,
    );
    const part = draftSpecial[index];
    part.targetId = event.target.value;
    const claim = draftClaims().find((c) => c.id === part.targetId);
    part.party = claim?.party || "";
    const available =
      Math.max(
        0,
        cents($("#entry-amount").value) -
          draftSpecial.reduce(
            (n, p, i) => n + (i === index ? 0 : cents(p.amount)),
            0,
          ),
      ) / 100;
    part.amount = claim
      ? Math.min(claim.remaining, available || claim.remaining)
      : 0;
    renderSpecialRows();
  });
  $("#entry-credit-enabled").addEventListener("change", renderSpecialRows);
  ["#entry-amount", "#entry-credit-party", "#entry-credit-amount"].forEach(
    (selector) => $(selector).addEventListener("input", renderSplitPreview),
  );
  $("#entry-category").addEventListener("change", () => {
    if (draftSpecial.length) return;
    const kind = Accounting.legacyKind(
      { categoryId: $("#entry-category").value, type: $("#entry-type").value },
      state.categories,
    );
    if (kind) addSpecial(kind);
  });
  $("#entry-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = numeric($("#entry-amount").value);
    if (amount === null) return toast("请输入大于 0 且最多两位小数的金额。");
    const type = $("#entry-type").value,
      categoryId = $("#entry-category").value;
    if (!categoryId || category(categoryId)?.type !== type)
      return toast("请先创建对应类型的类别。");
    const entry = {
      id: $("#entry-id").value || uid(),
      type,
      amount,
      date: $("#entry-date").value,
      categoryId,
      description: $("#entry-description").value.trim(),
      color: entryColor,
    };
    if (draftSpecial.length) entry.special = readEntrySpecial();
    if (draftCredit()) entry.credit = draftCredit();
    if (!entry.description) return toast("请填写事项描述。");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date))
      return toast("请选择有效日期。");
    const index = state.entries.findIndex((item) => item.id === entry.id);
    const candidate = state.entries
      .filter((item) => item.id !== entry.id)
      .concat(entry);
    try {
      Accounting.validate(candidate);
    } catch (error) {
      return toast(error.message);
    }
    const previous = state.entries;
    state.entries = candidate;
    const submit = $("#entry-form button[type=submit]");
    submit.disabled = true;
    try {
      await save();
    } catch (error) {
      state.entries = previous;
      render();
      return;
    } finally {
      submit.disabled = false;
    }
    ledgerMonth = entry.date.slice(0, 7);
    render();
    closeModals();
    toast(index >= 0 ? "账目已更新" : "账目已保存");
  });
  $("#analysis-basis").addEventListener("change", () => {
    excludedCategoryIds();
    state.analysisPreferences.basis = $("#analysis-basis").value;
    save();
    renderAnalysis();
  });
  $("#obligations-search").addEventListener("input", renderObligations);
  $("#obligations-settled").addEventListener("change", renderObligations);
  $(".obligations-panel").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-obligation-edit]");
    if (edit) return openEntry(edit.dataset.obligationEdit);
    const button = event.target.closest("[data-settle]");
    if (!button) return;
    const claim = Accounting.claims(state.entries).find(
      (c) => c.id === button.dataset.settle,
    );
    if (!claim || claim.remaining <= 0) return toast("这笔往来已结清。");
    const kind = button.dataset.settleKind;
    openEntry();
    setEntryType(Accounting.TAGS[kind].type);
    const preferred = state.categories.find(
      (c) =>
        c.name === Accounting.TAGS[kind].name &&
        c.type === Accounting.TAGS[kind].type,
    );
    if (preferred) $("#entry-category").value = preferred.id;
    $("#entry-date").value = claim.date > today() ? claim.date : today();
    $("#entry-amount").value = claim.remaining;
    $("#entry-description").value =
      `${Accounting.TAGS[kind].name} · ${claim.party || claim.description}`.slice(
        0,
        80,
      );
    addSpecial(kind, claim);
  });
  $$("[data-period]").forEach((button) =>
    button.addEventListener("click", () => {
      analysisPeriod = button.dataset.period;
      renderAnalysis();
    }),
  );
  $("#analysis-month").addEventListener("change", (event) => {
    analysisMonth = event.target.value;
    renderAnalysis();
  });
  $("#analysis-year").addEventListener("change", (event) => {
    analysisYear = Number(event.target.value);
    renderAnalysis();
  });
  $("#page-analysis").addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!checkbox.matches("input[data-distribution-category]")) return;
    const id = checkbox.dataset.distributionCategory;
    if (!category(id)) return;
    const excluded = new Set(excludedCategoryIds());
    if (checkbox.checked) excluded.delete(id);
    else excluded.add(id);
    state.analysisPreferences.excludedCategoryIds = [...excluded];
    save();
    renderAnalysis();
  });
  $("#page-analysis").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-distribution-action]");
    if (!button) return;
    const excluded = new Set(excludedCategoryIds());
    state.categories
      .filter((item) => item.type === button.dataset.distributionType)
      .forEach((item) => {
        if (button.dataset.distributionAction === "all")
          excluded.delete(item.id);
        else excluded.add(item.id);
      });
    state.analysisPreferences.excludedCategoryIds = [...excluded];
    save();
    renderAnalysis();
  });
  $("#add-category").addEventListener("click", () => openCategory());
  $("#category-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const id = $("#category-id").value,
      name = $("#category-name").value.trim(),
      type = $("#category-type").value;
    if (!name) return toast("请填写类别名称。");
    if (
      state.categories.some(
        (item) => item.name === name && item.type === type && item.id !== id,
      )
    )
      return toast("同类型中已有这个类别名称。");
    const existing = state.categories.find((item) => item.id === id);
    if (existing) Object.assign(existing, { name, type, color: categoryColor });
    else
      state.categories.push({
        id: uid(),
        name,
        type,
        color: categoryColor,
        icon: "✦",
      });
    save();
    render();
    closeModals();
    toast(existing ? "类别已更新" : "类别已创建");
  });
  $(".category-sections").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-category-edit]"),
      remove = event.target.closest("[data-category-delete]");
    if (edit) openCategory(edit.dataset.categoryEdit);
    if (remove) {
      const item = category(remove.dataset.categoryDelete);
      if (state.entries.some((entry) => entry.categoryId === item.id))
        return toast("这个类别已有账目使用，暂不能删除。");
      confirmDelete(`删除类别“${item.name}”？`, () => {
        const remaining = excludedCategoryIds().filter((id) => id !== item.id);
        state.categories = state.categories.filter((cat) => cat.id !== item.id);
        state.analysisPreferences.excludedCategoryIds = remaining;
        save();
        render();
        toast("类别已删除");
      });
    }
  });
  $("#confirm-delete").addEventListener("click", () => {
    const action = deleteAction;
    closeModals();
    action?.();
  });
  $("#add-transfer").addEventListener("click", () => openFinance("transfer"));
  $("#add-project").addEventListener("click", () => openFinance("project"));
  $("#edit-capital").addEventListener("click", () => openFinance("capital"));
  $$("[data-project-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      projectFilter = button.dataset.projectFilter;
      renderFinance();
    }),
  );
  $("#project-list").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-project-edit]"),
      redeem = event.target.closest("[data-project-redeem]");
    if (edit) openFinance("project", edit.dataset.projectEdit);
    if (redeem) openFinance("redeem", redeem.dataset.projectRedeem);
  });
  $$("[data-transfer-type]").forEach((button) =>
    button.addEventListener("click", () =>
      setTransferType(button.dataset.transferType),
    ),
  );
  $("#project-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const invested = numeric($("#project-invested").value),
      currentValue = numeric($("#project-value").value, true);
    if (invested === null || currentValue === null)
      return toast("金额需大于等于 0、最多两位小数；投入金额必须大于 0。");
    const date = $("#project-invested-date").value,
      maturityDate = $("#project-maturity-date").value;
    if (date > today()) return toast("投入日期不能晚于今天。");
    if (maturityDate && maturityDate < date)
      return toast("预计到期日不能早于投入日期。");
    const id = $("#project-id").value || uid(),
      existing = state.finance.projects.find((item) => item.id === id);
    const rateText = $("#project-rate").value.trim(),
      annualRate = rateText === "" ? null : Number(rateText);
    if (
      annualRate !== null &&
      (!Number.isFinite(annualRate) || annualRate < -100 || annualRate > 1000)
    )
      return toast("请检查参考年化收益率。");
    const item = {
      id,
      name: $("#project-name").value.trim(),
      form: $("#project-kind").value.trim(),
      investedDate: date,
      invested,
      maturityDate,
      annualRate,
      currentValue,
      status: "active",
    };
    if (!item.name || !item.form) return toast("请填写项目名称与理财形式。");
    const candidate = structuredClone(state.finance);
    const index = candidate.projects.findIndex((project) => project.id === id);
    if (index >= 0) candidate.projects[index] = item;
    else candidate.projects.push(item);
    commitFinance(candidate, existing ? "理财项目已更新" : "理财项目已创建");
  });
  $("#transfer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = numeric($("#transfer-amount").value);
    if (amount === null) return toast("请输入大于 0 且最多两位小数的金额。");
    const date = $("#transfer-date").value;
    if (date > today()) return toast("划转日期不能晚于今天。");
    const candidate = structuredClone(state.finance);
    candidate.transfers.push({
      id: uid(),
      type: $("#transfer-type").value,
      amount,
      date,
      note: $("#transfer-note").value.trim(),
    });
    commitFinance(candidate, "资金划转已记录");
  });
  $("#capital-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = numeric($("#capital-amount").value, true);
    if (amount === null) return toast("请输入大于等于 0、最多两位小数的金额。");
    const date = $("#capital-date").value;
    if (date > today()) return toast("起始日期不能晚于今天。");
    const candidate = structuredClone(state.finance);
    candidate.initialCapital = amount;
    candidate.initialDate = date;
    commitFinance(candidate, "起始资金已更新");
  });
  $("#redeem-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = numeric($("#redeem-amount").value, true);
    if (amount === null) return toast("请输入大于等于 0、最多两位小数的金额。");
    const candidate = structuredClone(state.finance);
    const item = candidate.projects.find(
      (project) => project.id === $("#redeem-project-id").value,
    );
    const date = $("#redeem-date").value;
    if (!item || date < item.investedDate || date > today())
      return toast("赎回日期需在投入日期和今天之间。");
    item.status = "redeemed";
    item.redeemedDate = date;
    item.redeemedAmount = amount;
    commitFinance(candidate, "项目已赎回，资金已回到资金池");
  });
  $("#export-backup").addEventListener("click", async () => {
    try {
      await saveQueue;
      const done = await window.ledgerApi.exportBackup();
      if (done) toast("备份已导出");
    } catch (error) {
      toast(`导出失败：${error.message}`);
    }
  });
  $("#import-backup").addEventListener("click", async () => {
    try {
      await saveQueue;
      const restored = await window.ledgerApi.importBackup();
      if (!restored) return;
      state = restored;
      render();
      toast("备份已导入");
    } catch (error) {
      toast(`导入失败：${error.message}`);
    }
  });
  $("#open-data-folder").addEventListener("click", async () => {
    try {
      await window.ledgerApi.openDataFolder();
    } catch (error) {
      toast(`打开失败：${error.message}`);
    }
  });
  function updateStorageInfo(info) {
    $("#data-path").textContent = info.dataPath;
    $("#backup-path").textContent = `自动备份目录：${info.backupPath}`;
  }
  $("#move-ledger").addEventListener("click", async () => {
    try {
      await saveQueue;
      const result = await window.ledgerApi.moveLedger();
      if (!result) return;
      updateStorageInfo(result.info);
      toast("账本已迁移；旧文件夹仍保留在原位置");
    } catch (error) {
      toast(`迁移失败：${error.message}`);
    }
  });
  $("#switch-ledger").addEventListener("click", async () => {
    try {
      await saveQueue;
      const result = await window.ledgerApi.switchLedger();
      if (!result) return;
      state = result.state;
      render();
      updateStorageInfo(result.info);
      toast("已切换到账本文件夹，原账本未被覆盖");
    } catch (error) {
      toast(`切换失败：${error.message}`);
    }
  });
  let closeListenerReady = false;
  function showRecovery(error) {
    document.querySelector(".recovery-backdrop")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "recovery-backdrop";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `<div class="modal small-modal"><div class="eyebrow">DATA RECOVERY</div><h2>账本读取失败</h2><p class="confirm-copy">为保护已有记录，程序没有创建或覆盖账本。请检查存储设备，或选择一份已有的有效账本文件夹。</p><p class="recovery-error">${escapeHTML(error.message)}</p><div class="modal-actions"><button type="button" class="secondary-button" id="retry-load">重新尝试</button><button type="button" class="primary-button" id="choose-ledger">选择已有账本</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#retry-load").addEventListener("click", () => {
      overlay.remove();
      initialize();
    });
    overlay
      .querySelector("#choose-ledger")
      .addEventListener("click", async () => {
        try {
          const result = await window.ledgerApi.switchLedger();
          if (!result) return;
          state = result.state;
          updateStorageInfo(result.info);
          render();
          overlay.remove();
          showPage("settings");
          toast("账本已恢复并切换");
        } catch (nextError) {
          overlay.querySelector(".recovery-error").textContent =
            nextError.message;
        }
      });
  }
  async function initialize() {
    try {
      if (window.ledgerApi && !closeListenerReady) {
        window.ledgerApi.onBeforeClose(async () => {
          try {
            await saveQueue;
          } finally {
            window.ledgerApi.closeReady();
          }
        });
        closeListenerReady = true;
      }
      state = await loadState();
      render();
      const requestedPage = new URLSearchParams(window.location.search).get(
        "page",
      );
      showPage(
        ["ledger", "analysis", "finance", "categories", "settings"].includes(
          requestedPage,
        )
          ? requestedPage
          : "ledger",
      );
      if (window.ledgerApi) {
        updateStorageInfo(await window.ledgerApi.info());
      } else
        $("#data-path").textContent = "浏览器预览模式：数据保存在此浏览器。";
    } catch (error) {
      showRecovery(error);
    }
  }
  initialize();
})();
