const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("空白账本、收支记录、理财资金池与备份入口", async () => {
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
  });
  const { window } = dom;
  const $ = (selector) => window.document.querySelector(selector);
  let saved = null;
  window.scrollTo = () => {};
  window.structuredClone = structuredClone;
  window.ledgerApi = {
    load: async () => null,
    save: async (value) => {
      saved = structuredClone(value);
    },
    info: async () => ({
      dataPath: "C:\\test\\ledger",
      backupPath: "C:\\test\\backups",
    }),
    moveLedger: async () => ({
      state: saved,
      info: {
        dataPath: "D:\\books\\history",
        backupPath: "D:\\books\\backups",
      },
    }),
    switchLedger: async () => ({
      state: {
        ...saved,
        categories: saved.categories.map((item, index) =>
          index === 0 ? { ...item, name: "食" } : item,
        ),
        entries: [],
        finance: { ...saved.finance, projects: [] },
      },
      info: {
        dataPath: "D:\\other\\ledger",
        backupPath: "D:\\other\\backups",
      },
    }),
    onBeforeClose: () => {},
    closeReady: () => {},
    exportBackup: async () => true,
    importBackup: async () => null,
    openDataFolder: async () => true,
  };
  window.eval(script);
  await tick();
  assert.equal(saved.entries.length, 0);
  assert.equal(saved.finance.initialCapital, 0);
  assert.equal($("#record-count").textContent, "0");
  assert.equal(
    new Set(
      [...window.document.querySelectorAll("[id]")].map(
        (element) => element.id,
      ),
    ).size,
    window.document.querySelectorAll("[id]").length,
  );

  $("#top-add").click();
  $("#entry-amount").value = "12.50";
  $("#entry-description").value = "测试午餐";
  $("#entry-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
  assert.equal(saved.entries[0].amount, 12.5);
  assert($("#ledger-list").textContent.includes("测试午餐"));

  $('[data-page="finance"]').click();
  $("#edit-capital").click();
  $("#capital-amount").value = "100";
  $("#capital-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
  assert($("#finance-pool").textContent.includes("100.00"));

  $("#add-project").click();
  $("#project-name").value = "测试定期";
  $("#project-kind").value = "定期";
  $("#project-invested").value = "120";
  $("#project-value").value = "121";
  $("#project-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
  assert.equal(saved.finance.projects.length, 0);
  assert($("#toast").textContent.includes("负数"));

  $("#project-invested").value = "80";
  $("#project-value").value = "81";
  $("#project-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );
  await tick();
  assert.equal(saved.finance.projects.length, 1);
  assert($("#finance-pool").textContent.includes("20.00"));

  $('[data-page="settings"]').click();
  assert($("#page-settings").classList.contains("active"));
  assert($("#data-path").textContent.includes("ledger"));
  $("#move-ledger").click();
  await tick();
  assert.equal($("#data-path").textContent, "D:\\books\\history");
  $("#switch-ledger").click();
  await tick();
  assert.equal($("#data-path").textContent, "D:\\other\\ledger");
  assert.equal($("#record-count").textContent, "0");
  assert($(".category-sections").textContent.includes("食"));
  dom.window.close();
});

test("配置路径失效时提供恢复入口且不保存空账本", async () => {
  const dom = new JSDOM(html, {
    url: "http://localhost/",
    runScripts: "dangerously",
  });
  const { window } = dom;
  const $ = (selector) => window.document.querySelector(selector);
  let savedCount = 0;
  window.scrollTo = () => {};
  window.structuredClone = structuredClone;
  window.ledgerApi = {
    load: async () => {
      throw new Error("已设置的账本文件不存在");
    },
    save: async () => {
      savedCount++;
    },
    switchLedger: async () => ({
      state: {
        schemaVersion: 2,
        categories: [],
        entries: [],
        finance: {
          initialCapital: 0,
          initialDate: "2026-10-01",
          transfers: [],
          projects: [],
        },
      },
      info: {
        dataPath: "D:\\recovered\\ledger",
        backupPath: "D:\\recovered\\backups",
      },
    }),
    onBeforeClose: () => {},
    closeReady: () => {},
  };
  window.eval(script);
  await tick();
  assert($(".recovery-backdrop"));
  assert.equal(savedCount, 0);
  $("#choose-ledger").click();
  await tick();
  assert.equal($(".recovery-backdrop"), null);
  assert.equal($("#data-path").textContent, "D:\\recovered\\ledger");
  assert.equal(savedCount, 0);
  dom.window.close();
});

test("占比图按勾选类别计算，并记住当前账本的选择", async () => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  let saved = {
    schemaVersion: 2,
    categories: [
      { id: "food", name: "食", type: "expense", color: "#e3a681", icon: "食" },
      {
        id: "travel",
        name: "行",
        type: "expense",
        color: "#87ad8f",
        icon: "行",
      },
      {
        id: "salary",
        name: "劳务",
        type: "income",
        color: "#8ba9cf",
        icon: "劳",
      },
    ],
    entries: [
      {
        id: "e1",
        type: "expense",
        date,
        categoryId: "food",
        description: "午餐",
        amount: 10,
        color: "#e7f0e6",
      },
      {
        id: "e2",
        type: "expense",
        date,
        categoryId: "travel",
        description: "车费",
        amount: 30,
        color: "#e7f0e6",
      },
      {
        id: "e3",
        type: "income",
        date,
        categoryId: "salary",
        description: "劳务",
        amount: 100,
        color: "#e7f0e6",
      },
    ],
    finance: {
      initialCapital: 0,
      initialDate: date,
      transfers: [],
      projects: [],
    },
    analysisPreferences: { excludedCategoryIds: [] },
  };
  const open = async () => {
    const dom = new JSDOM(html, {
      url: "http://localhost/",
      runScripts: "dangerously",
    });
    dom.window.scrollTo = () => {};
    dom.window.structuredClone = structuredClone;
    dom.window.ledgerApi = {
      load: async () => structuredClone(saved),
      save: async (state) => {
        saved = structuredClone(state);
      },
      info: async () => ({
        dataPath: "D:\\ledger",
        backupPath: "D:\\ledger\\backups",
      }),
      onBeforeClose: () => {},
      closeReady: () => {},
    };
    dom.window.eval(script);
    await tick();
    dom.window.document.querySelector('[data-page="analysis"]').click();
    return dom;
  };
  const dom = await open();
  const $ = (selector) => dom.window.document.querySelector(selector);
  assert($("#expense-distribution").textContent.includes("40.00"));
  const food = $('[data-distribution-category="food"]');
  food.checked = false;
  food.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  await tick();
  assert.deepEqual(saved.analysisPreferences.excludedCategoryIds, ["food"]);
  assert($("#expense-distribution").textContent.includes("30.00"));
  assert(!$("#expense-distribution").textContent.includes("食"));
  assert($("#analysis-expense").textContent.includes("40.00"));
  $(
    '[data-distribution-action="none"][data-distribution-type="income"]',
  ).click();
  await tick();
  assert($("#income-distribution").textContent.includes("尚未选择"));
  dom.window.close();

  const reopened = await open();
  assert.equal(
    reopened.window.document.querySelector(
      '[data-distribution-category="food"]',
    ).checked,
    false,
  );
  assert.equal(
    reopened.window.document.querySelector(
      '[data-distribution-category="salary"]',
    ).checked,
    false,
  );
  reopened.window.close();
});
