const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");
const A = require("../src/accounting.js");
const { validateState } = require("../desktop/storage.cjs");
const source = (name) =>
  fs.readFileSync(path.join(__dirname, "../src", name), "utf8");
const date = "2026-11-01";
const categories = ["expense", "income"].map((type) => ({
  id: type,
  type,
  name: type,
  icon: "元",
  color: "#99aabb",
}));
function entry(id, type, amount, special) {
  return {
    id,
    type,
    amount,
    special,
    date,
    categoryId: type,
    description: id,
    color: "#99aabb",
  };
}
function ledger(entries) {
  return {
    schemaVersion: 2,
    categories,
    entries,
    finance: {
      initialCapital: 0,
      initialDate: date,
      transfers: [],
      projects: [],
    },
  };
}
test("部分结算与显式结清独立计算本金、实际收付、差额；旧结算可混用", () => {
  for (const [kind, sourceKind] of [
    ["repaid", "borrowed"],
    ["recovered", "lent"],
    ["reimbursed", "reimbursable"],
  ]) {
    const original = entry("原账", A.TAGS[sourceKind].type, 300, [
      { id: "原额", kind: sourceKind, party: "甲", amount: 300 },
    ]);
    const settle = (amount, principal) =>
      entry("结算", A.TAGS[kind].type, amount, [
        {
          id: "还",
          kind,
          party: "甲",
          targetId: "原额",
          amount,
          ...(principal === undefined ? {} : { principal }),
        },
      ]);
    const partial = settle(290);
    assert.equal(A.claims([original, partial])[0].remaining, 10);
    assert.deepEqual(A.ordinaryEntries(partial), []);
    for (const amount of [0, 290, 300, 310]) {
      const paid = settle(amount, 300);
      validateState(ledger([original, paid]));
      assert.equal(A.cashAmount(paid), amount);
      assert.equal(A.claims([original, paid])[0].remaining, 0);
      assert.equal(A.flowTotals([paid]).totals[kind], 300);
      const [difference] = A.ordinaryEntries(paid);
      if (amount !== 300) {
        assert.equal(difference.amount, Math.abs(300 - amount));
        assert.equal(
          difference.type,
          (kind === "repaid") === amount < 300 ? "income" : "expense",
        );
      } else assert.equal(difference, undefined);
      assert.equal(
        A.claims(A.planDeletion([original, paid], "结算").entries)[0].remaining,
        300,
      );
    }
    assert.throws(
      () => validateState(ledger([original, settle(290, 301)])),
      /超过/,
    );
  }
  assert.deepEqual(
    A.distributeCash(
      0.04,
      [1, 1, 1].map((remaining) => ({ remaining })),
    ),
    [0.02, 0.01, 0.01],
  );
});
test("多选搜索保留选择，实付分摊至分，保存重开可编辑；账本助手入口支持多附件", async () => {
  const originals = Array.from({ length: 20 }, (_, i) => ({
    ...entry("订单" + i, "expense", 15, []),
    credit: { amount: 15, party: i < 10 ? "月付A" : "月付B" },
  }));
  let data = ledger(originals),
    writes = 0;
  const dom = new JSDOM(source("index.html"), {
    url: "http://localhost",
    runScripts: "dangerously",
  });
  const w = dom.window,
    $ = (s) => w.document.querySelector(s);
  const tick = () => new Promise((r) => setTimeout(r, 12));
  w.scrollTo = () => {};
  w.structuredClone = structuredClone;
  w.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  w.ledgerApi = {
    load: async () => structuredClone(data),
    save: async (s) => {
      validateState(s);
      data = structuredClone(s);
      writes++;
    },
    info: async () => ({ dataPath: "test", backupPath: "test" }),
    onBeforeClose: () => {},
  };
  for (const file of [
    "accounting.js",
    "ledger-tools.js",
    "assistant.js",
    "app.js",
  ])
    w.eval(source(file));
  try {
    await tick();
    function input(sel, value) {
      const el = $(sel);
      el.value = value;
      el.dispatchEvent(new w.Event("input", { bubbles: true }));
    }
    $("#top-add").click();
    $("#entry-date").value = date;
    $("#entry-description").value = "月付还款";
    input("#entry-amount", "290");
    $('[data-pick-claims="repaid"]').click();
    input("#picker-query", "月付A");
    $("#picker-all").click();
    input("#picker-query", "月付B");
    $("#picker-all").click();
    assert.match($("#picker-count").textContent, /20 笔.*300.00/);
    assert.match($("#picker-status").textContent, /剩余.*10.00/);
    $("#picker-close").click();
    assert.match($("#picker-status").textContent, /差额收入.*10.00/);
    const split = w.document.querySelectorAll("#picker-shares input");
    split[0].value = "14.49";
    split[0].dispatchEvent(new w.Event("input"));
    assert($("#picker-apply").disabled);
    split[1].value = "14.51";
    split[1].dispatchEvent(new w.Event("input"));
    assert(!$("#picker-apply").disabled);
    $("#picker-apply").click();
    assert.equal(
      w.document.querySelectorAll("[data-close-balance]:checked").length,
      20,
    );
    $("#entry-form").dispatchEvent(
      new w.Event("submit", { cancelable: true, bubbles: true }),
    );
    await tick();
    const saved = data.entries.find((e) => e.description === "月付还款");
    assert.equal(saved.amount, 290);
    assert.equal(saved.special.length, 20);
    assert.equal(
      A.ordinaryEntries(saved).reduce((n, e) => n + A.cents(e.amount), 0),
      1000,
    );
    assert.equal(A.claims(data.entries).filter((c) => c.remaining).length, 0);
    assert.match($("#ledger-income").textContent, /10.00/);
    $('[data-entry-edit="' + saved.id + '"]').click();
    assert.equal(
      w.document.querySelectorAll("[data-close-balance]:checked").length,
      20,
    );
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
    const count = writes;
    $("#assistant-open").click();
    input("#assistant-text", "账单说明");
    $('[data-mode="ask"]').click();
    assert.match($("#assistant-label").textContent, /问/);
    const file = new w.File(["image"], "账单.png", { type: "image/png" });
    const drop = new w.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { files: [file, file] },
    });
    $("#assistant-drawer").dispatchEvent(drop);
    await tick();
    assert.equal(
      w.document.querySelectorAll("#assistant-images figure").length,
      2,
    );
    $("#assistant-images button").click();
    assert.equal(
      w.document.querySelectorAll("#assistant-images figure").length,
      1,
    );
    $('[data-mode="record"]').click();
    assert.equal($("#assistant-text").value, "账单说明");
    assert.equal(writes, count);
  } finally {
    dom.window.close();
  }
});
