const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../src/accounting.js");
const entry = (id, type, amount, special = [], date = "2026-10-01") => ({
  id,
  type,
  amount,
  date,
  categoryId: type,
  description: id,
  color: "#e7f0e6",
  special,
});
const part = (id, kind, party, amount, targetId) => ({
  id,
  kind,
  party,
  amount,
  ...(targetId ? { targetId } : {}),
});

test("聚餐总付 100：自己 25，A/B/C 垫付各 25；部分收回不增加实际收入", () => {
  const meal = entry("meal", "expense", 100, [
    part("a", "lent", "A", 25),
    part("b", "lent", "B", 25),
    part("c", "lent", "C", 25),
  ]);
  const receipt = entry(
    "receipt",
    "income",
    10,
    [part("r", "recovered", "A", 10, "a")],
    "2026-10-02",
  );
  A.validate([meal, receipt]);
  assert.equal(A.actualAmount(meal), 25);
  assert.equal(A.cashAmount(meal), 100);
  assert.equal(A.components(meal).length, 4);
  assert.equal(A.actualAmount(receipt), 0);
  const debts = A.balances([meal, receipt]).debts;
  assert.equal(debts.find((d) => d.party === "A").remaining, 15);
  assert.equal(debts.find((d) => d.party === "B").remaining, 25);
  assert.equal(
    A.balances([meal, receipt], "2026-10-01").debts.find((d) => d.party === "A")
      .remaining,
    25,
  );
});

test("花呗消费可同时包含垫付和报销；还本金不重复计消费，利息计实际支出", () => {
  const expense = entry("trip", "expense", 100, [
    part("a", "lent", "A", 25),
    part("ticket", "reimbursable", "公司", 50),
  ]);
  expense.credit = { party: "花呗", amount: 80 };
  const repay = entry(
    "repay",
    "expense",
    82,
    [part("p", "repaid", "花呗", 80, "trip:credit")],
    "2026-10-02",
  );
  A.validate([expense, repay]);
  assert.equal(A.actualAmount(expense), 25);
  assert.equal(A.cashAmount(expense), 20);
  assert.equal(A.actualAmount(repay), 2);
  assert.equal(A.cashAmount(repay), 82);
  assert.equal(
    A.balances([expense, repay]).debts.find((d) => d.party === "花呗")
      .remaining,
    0,
  );
});

test("一笔报销可关联多笔原账，支持跨月部分到账和结算明细", () => {
  const first = entry(
    "hotel",
    "expense",
    200,
    [part("hotel-claim", "reimbursable", "公司", 200)],
    "2026-09-02",
  );
  const second = entry(
    "taxi",
    "expense",
    50,
    [part("taxi-claim", "reimbursable", "", 50)],
    "2026-09-03",
  );
  const receipt = entry("payment", "income", 180, [
    part("r1", "reimbursed", "公司", 150, "hotel-claim"),
    part("r2", "reimbursed", "", 30, "taxi-claim"),
  ]);
  A.validate([first, second, receipt]);
  const all = A.claims([first, second, receipt]);
  assert.equal(all.find((c) => c.id === "hotel-claim").remaining, 50);
  assert.equal(all.find((c) => c.id === "taxi-claim").remaining, 20);
  assert.equal(all[0].settlements[0].entryId, "payment");
  assert.equal(A.actualAmount(receipt), 0);
});

test("借款到账与自己借出分别跟踪，同一对方的双向债务不抵销", () => {
  const borrowed = entry("loan", "income", 1000, [
    part("loan-claim", "borrowed", "A", 1000),
  ]);
  const lent = entry("lend", "expense", 50, [
    part("lend-claim", "lent", "A", 50),
  ]);
  const repayment = entry("repay", "expense", 200, [
    part("paid", "repaid", "A", 200, "loan-claim"),
  ]);
  A.validate([borrowed, lent, repayment]);
  assert.equal(A.actualAmount(borrowed), 0);
  assert.equal(A.balances([borrowed, lent, repayment]).debts.length, 2);
  assert.equal(
    A.claims([borrowed, lent, repayment]).find((c) => c.id === "loan-claim")
      .remaining,
    800,
  );
});

test("拒绝重叠拆分、错误关联、过度结算和破坏已有结算的编辑删除", () => {
  const original = entry("meal", "expense", 100, [
    part("claim", "lent", "A", 50),
  ]);
  const paid = entry(
    "paid",
    "income",
    30,
    [part("p", "recovered", "A", 30, "claim")],
    "2026-10-02",
  );
  assert.throws(
    () =>
      A.validate([entry("bad", "expense", 10, [part("x", "lent", "A", 11)])]),
    /不能超过本笔/,
  );
  assert.throws(
    () =>
      A.validate([entry("bad", "expense", 10, [part("x", "lent", "", 10)])]),
    /对方/,
  );
  assert.throws(
    () =>
      A.validate([
        original,
        entry("bad", "income", 51, [part("p", "recovered", "A", 51, "claim")]),
      ]),
    /累计/,
  );
  assert.throws(
    () =>
      A.validate([
        original,
        entry("bad", "income", 10, [part("p", "recovered", "B", 10, "claim")]),
      ]),
    /对方必须/,
  );
  assert.throws(
    () =>
      A.validate([
        original,
        entry("bad", "expense", 10, [part("p", "repaid", "A", 10, "claim")]),
      ]),
    /有效的原始/,
  );
  assert.throws(
    () =>
      A.validate([
        original,
        entry(
          "bad",
          "income",
          10,
          [part("p", "recovered", "A", 10, "claim")],
          "2026-09-30",
        ),
      ]),
    /日期不能早于/,
  );
  assert.throws(() => A.validate([paid]), /关联记录/);
  assert.throws(
    () =>
      A.validate([
        { ...original, special: [part("claim", "lent", "A", 20)] },
        paid,
      ]),
    /累计/,
  );
  assert.throws(
    () => A.validate([{ ...original, credit: { party: "花呗", amount: 101 } }]),
    /信用付款/,
  );
});

test("分计算保留小数精度，旧账目不推断债务", () => {
  const small = entry("small", "expense", 0.3, [
    part("a", "lent", "A", 0.1),
    part("b", "lent", "B", 0.2),
  ]);
  A.validate([small]);
  assert.equal(A.actualAmount(small), 0);
  const old = { ...entry("old", "expense", 100), categoryId: "debt" };
  delete old.special;
  A.validate([old]);
  assert.equal(A.claims([old]).length, 0);
  assert.equal(
    A.legacyKind(old, [{ id: "debt", name: "债务（借出）", type: "expense" }]),
    "lent",
  );
});

test("删除重复的借入账目时，将同一贷款方的还款转到已有信用消费", () => {
  const credit = entry("purchase", "expense", 1200, [], "2026-09-15");
  credit.credit = { party: "花呗", amount: 1200 };
  const duplicate = entry(
    "duplicate",
    "income",
    1000,
    [part("loan", "borrowed", "花呗", 1000)],
    "2026-09-30",
  );
  const repayment = entry(
    "repayment",
    "expense",
    200,
    [part("settled", "repaid", "花呗", 200, "loan")],
    "2026-10-01",
  );
  const original = [credit, duplicate, repayment];
  A.validate(original);
  const plan = A.planDeletion(original, "duplicate");
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.transfers.length, 1);
  assert.equal(plan.entries.length, 2);
  assert.equal(plan.entries[1].special[0].targetId, "purchase:credit");
  assert.equal(repayment.special[0].targetId, "loan");
  A.validate(plan.entries);
  assert.equal(
    A.balances(plan.entries).debts.find((d) => d.party === "花呗").remaining,
    1000,
  );
});

test("无可用同方欠款或属于指定垫付时，删除计划给出关联账目并保持原账不变", () => {
  const loan = entry("loan", "income", 100, [
    part("borrow", "borrowed", "A", 100),
  ]);
  const repayment = entry("repay", "expense", 50, [
    part("paid", "repaid", "A", 50, "borrow"),
  ]);
  const blocked = A.planDeletion([loan, repayment], "loan");
  assert.deepEqual(
    blocked.blockers.map((item) => item.description),
    ["repay"],
  );
  assert.equal(repayment.special[0].targetId, "borrow");
  const advanced = entry("meal", "expense", 100, [
    part("advance", "lent", "B", 50),
  ]);
  const returned = entry("returned", "income", 50, [
    part("received", "recovered", "B", 50, "advance"),
  ]);
  assert.equal(
    A.planDeletion([advanced, returned], "meal").blockers[0].description,
    "returned",
  );
});
