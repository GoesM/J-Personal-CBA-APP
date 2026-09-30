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
    info: async () => ({ dataPath: "C:\\test\\ledger.json" }),
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
  assert($("#data-path").textContent.includes("ledger.json"));
  dom.window.close();
});
