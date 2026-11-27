(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const accounting = window.LedgerAccounting;
  const cents = accounting.cents;
  const money = (n) => "¥ " + Number(n).toFixed(2);
  const node = (tag, text) => {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  };
  for (const button of document.querySelectorAll(".tool-dialog [data-dismiss]"))
    button.onclick = () => button.closest("dialog").close();

  const picker = $("#claim-picker");
  let context, selected, customTotal, shares;
  const chosen = () => context.claims.filter((c) => selected.has(c.id));
  function visible() {
    const terms = $("#picker-query").value.toLowerCase().trim().split(/\s+/);
    return context.claims.filter((c) => {
      const label = [
        c.party || "未指定单位",
        c.description,
        c.date,
        c.amount.toFixed(2),
        c.remaining.toFixed(2),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => label.includes(t));
    });
  }
  function list() {
    const area = $("#picker-list"),
      groups = new Map();
    area.replaceChildren();
    for (const c of visible()) {
      const party = c.party || "未指定单位";
      if (!groups.has(party)) {
        const section = node("section", "");
        section.append(node("h3", party));
        groups.set(party, section);
        area.append(section);
      }
      const row = node("label", ""),
        input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selected.has(c.id);
      input.dataset.claim = c.id;
      const detail = node("span", c.description);
      detail.append(node("small", c.date));
      row.append(input, detail, node("b", money(c.remaining)));
      groups.get(party).append(row);
    }
    if (!groups.size)
      area.append(
        node(
          "p",
          context.claims.length
            ? "没有符合搜索条件的原账目。"
            : "所选日期没有可关联的待结算账目。",
        ),
      );
  }
  const principal = (rows) => rows.reduce((n, c) => n + cents(c.remaining), 0);
  function validCash(input) {
    return (
      input.value !== "" &&
      input.validity.valid &&
      Number.isFinite(input.valueAsNumber)
    );
  }
  function status() {
    const rows = chosen(),
      cash = $("#picker-cash"),
      close = $("#picker-close").checked;
    const base = principal(rows),
      total = cents(cash.value);
    const leftover = cents(context.available) - total;
    $("#picker-remainder").hidden = !(rows.length && leftover > 0);
    $("#picker-remainder span").textContent =
      "保留原总额，把剩余 " + money(leftover / 100) + " 留在本笔其他用途";
    let error = "";
    if (!rows.length) error = "请先勾选原账目。";
    else if (rows.length > context.limit)
      error = "本笔还可添加 " + context.limit + " 个关联，请减少选择。";
    else if (
      close &&
      rows.some((c) => c.settlements.some((s) => s.date > context.date))
    )
      error = "所选原账还有更晚的结算，请核对结清日期。";
    else if (!validCash(cash) || shares.some((s) => !Number.isFinite(s)))
      error = "请填写有效金额，最多两位小数。";
    else if (shares.reduce((n, s) => n + cents(s), 0) !== total)
      error = "逐笔分配之和须等于本次实收／实付合计。";
    else if (
      !close &&
      shares.some((s, i) => s <= 0 || cents(s) > cents(rows[i].remaining))
    )
      error =
        "按实收付冲减时，每笔金额须大于零且不超过余额。要核销差额，可勾选结清。";
    $("#picker-count").textContent =
      "已选 " + rows.length + " 笔 · 待结算本金 " + money(base / 100);
    const adjustments = { income: 0, expense: 0 };
    if (close && !error)
      rows.forEach((c, i) => {
        const delta = accounting.adjustment({
          kind: context.kind,
          amount: shares[i],
          principal: c.remaining,
        });
        if (delta) adjustments[delta.type] += cents(delta.amount);
      });
    const breakdown = ["income", "expense"]
      .filter((type) => adjustments[type])
      .map(
        (type) =>
          "差额" +
          (type === "income" ? "收入 " : "支出 ") +
          money(adjustments[type] / 100),
      )
      .join(" · ");
    $("#picker-status").textContent =
      error ||
      (close
        ? "所选余额全部结清" + (breakdown ? " · " + breakdown : "")
        : "本次结算后剩余 " + money((base - total) / 100));
    $("#picker-apply").disabled = Boolean(error);
  }
  function allocate(resetTotal = false) {
    const rows = chosen(),
      base = principal(rows) / 100,
      cash = $("#picker-cash");
    if (resetTotal && !customTotal)
      cash.value = (
        context.available == null
          ? base
          : $("#picker-close").checked
            ? context.available
            : Math.min(context.available, base)
      ).toFixed(2);
    shares = validCash(cash)
      ? accounting.distributeCash(cash.valueAsNumber, rows)
      : rows.map(() => NaN);
    const area = $("#picker-shares");
    area.replaceChildren();
    rows.forEach((c, i) => {
      const label = node(
        "label",
        c.description + " · 本金 " + money(c.remaining),
      );
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "1000000000";
      input.step = "0.01";
      input.value = Number.isFinite(shares[i]) ? shares[i].toFixed(2) : "";
      input.oninput = () => {
        shares[i] = validCash(input) ? input.valueAsNumber : NaN;
        status();
      };
      label.append(input);
      area.append(label);
    });
    status();
  }
  window.openClaimPicker = (options) => {
    context = options;
    selected = new Set();
    customTotal = false;
    $("#picker-title").textContent = {
      repaid: "批量还款",
      recovered: "批量收回",
      reimbursed: "批量报销到账",
    }[options.kind];
    $("#picker-keep").checked = true;
    $("#picker-query").value = "";
    $("#picker-details").open = false;
    $("#picker-close").checked = false;
    list();
    allocate(true);
    picker.showModal();
    $("#picker-query").focus();
  };
  $("#picker-list").onchange = (event) => {
    const id = event.target.dataset.claim;
    if (event.target.checked) selected.add(id);
    else selected.delete(id);
    allocate(true);
  };
  $("#picker-query").oninput = list;
  $("#picker-all").onclick = () => {
    visible().forEach((c) => selected.add(c.id));
    list();
    allocate(true);
  };
  $("#picker-none").onclick = () => {
    selected.clear();
    customTotal = false;
    list();
    allocate(true);
  };
  $("#picker-cash").oninput = () => {
    customTotal = true;
    $("#picker-keep").checked = false;
    allocate();
  };
  $("#picker-close").onchange = () => {
    if (!customTotal && context.available != null) allocate(true);
    else status();
  };
  $("#picker-apply").onclick = () => {
    status();
    if ($("#picker-apply").disabled) return;
    const close = $("#picker-close").checked;
    context.apply(
      chosen().map((c, i) => ({
        targetId: c.id,
        party: c.party,
        amount: shares[i],
        ...(close ? { principal: c.remaining } : {}),
      })),
      !$("#picker-remainder").hidden && !$("#picker-keep").checked,
    );
    picker.close();
  };
})();
