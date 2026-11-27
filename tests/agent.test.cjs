const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { ModelService, priceFactor } = require("../desktop/ai-service.cjs");
const { LedgerAgent, query, project } = require("../desktop/ledger-agent.cjs");
const { LedgerStore } = require("../desktop/storage.cjs");
async function directory(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ai-ledger-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
const seed = () => ({
  schemaVersion: 2,
  categories: [
    { id: "meal", name: "食", type: "expense", color: "#99aa88", icon: "食" },
  ],
  entries: [],
  finance: {
    initialCapital: 0,
    initialDate: "2026-01-01",
    projects: [],
    transfers: [],
  },
});
const create = {
  action: "create",
  fields: {
    type: "expense",
    amount: 20,
    date: "2026-11-02",
    description: "晚餐",
    categoryId: "meal",
  },
};
const call = (name, args) => ({
  tool_calls: [
    {
      type: "function",
      id: "f",
      function: { name, arguments: JSON.stringify(args) },
    },
  ],
});
test("智填多轮只读查询后建草稿，按账本及快照确认，写入去重，智问禁止写入", async (t) => {
  const root = await directory(t),
    store = new LedgerStore(path.join(root, "ledger"));
  await store.save(seed());
  const queue = [],
    calls = [];
  const service = {
    config: async () => ({ model: "test" }),
    chat: async (c, m, tools) => {
      calls.push({ messages: structuredClone(m), tools });
      return queue.shift();
    },
  };
  const agent = new LedgerAgent(root, service),
    scope = ["one", "gen"],
    prompt = { mode: "record", text: "记晚餐" };
  queue.push(
    call("query_ledger", { view: "entries", search: "晚餐" }),
    call("propose_entries", { changes: [create], reason: "记录晚餐" }),
  );
  const { proposal } = await agent.turn(scope, await store.load(), prompt);
  assert.equal((await store.load()).entries.length, 0);
  assert.equal(calls[1].messages.at(-1).role, "tool");
  await assert.rejects(agent.apply(["two", "gen"], store, proposal.id), /失效/);
  const saved = await agent.apply(scope, store, proposal.id);
  assert.equal(saved.entries.length, 1);
  await assert.rejects(agent.apply(scope, store, proposal.id), /失效/);
  const change = {
    action: "update",
    id: saved.entries[0].id,
    fields: { amount: 18 },
  };
  queue.push(
    call("propose_entries", { changes: [change], reason: "改为18元" }),
  );
  const p = (await agent.turn(scope, await store.load(), prompt)).proposal;
  const other = await store.load();
  other.entries[0].amount = 17;
  await store.save(other);
  await assert.rejects(agent.apply(scope, store, p.id), /已有变化/);
  queue.push(call("propose_entries", { changes: [create], reason: "写账" }), {
    content: "仅查询",
  });
  const answer = await agent.turn(scope, await store.load(), {
    mode: "ask",
    text: "刚才那笔多少？",
  });
  assert.equal(answer.proposal, null);
  assert.deepEqual(
    calls.at(-1).tools.map((x) => x.function.name),
    ["query_ledger"],
  );
  assert(
    calls
      .at(-1)
      .messages.some((x) => x.content === "已按用户确认写入 1 项变更。"),
  );
  assert.equal(query(await store.load(), { view: "totals" }).expense, 17);
  assert.deepEqual(await agent.history(["two", "gen"]), []);
  assert.throws(() =>
    project(other, [{ ...create, fields: { ...create.fields, amount: -1 } }]),
  );
});
test("服务切换隔离 Token，逐轮按历史价格计费，时间范围与未知费用", async (t) => {
  const root = await directory(t),
    sent = [];
  const secure = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString(),
  };
  const server = async (url, opt) => {
    sent.push(opt);
    return {
      ok: true,
      json: async () =>
        url.endsWith("/models")
          ? { data: [{ id: "m", input_modalities: ["text", "image"] }] }
          : {
              choices: [{ message: { content: "好" } }],
              usage: {
                prompt_tokens: 1000000,
                completion_tokens: 100000,
                prompt_cache_hit_tokens: 100000,
              },
            },
    };
  };
  const service = new ModelService(root, secure, server);
  await service.configure({
    base: "https://first.example",
    model: "m",
    token: "test-secret",
    rates: { input: 2, cached: 1, output: 5 },
  });
  assert((await service.models())[0].image);
  assert.equal(sent[0].headers.Authorization, "Bearer test-secret");
  assert.equal((await service.info()).token, undefined);
  await service.chat(await service.config(), [], [], "ask");
  await service.configure({ base: "https://other.example", model: "m" });
  await service.chat(await service.config(), [], [], "record");
  assert.equal(sent.at(-1).headers.Authorization, undefined);
  const file = path.join(root, "ai-usage.jsonl");
  await fs.appendFile(
    file,
    JSON.stringify({
      time: Date.now() - 2 * 86400000,
      base: "https://first.example",
      model: "m",
      input: 20,
      output: 10,
      cached: 0,
      cost: 0.01,
      known: true,
    }) + "\n",
  );
  const day = await service.usage(1),
    week = await service.usage(7);
  assert.equal(day[0].cost, 2.4);
  assert.equal(day[1].unknown, 1);
  assert.equal(week[0].calls, 2);
  for (const d of [30, 365])
    assert.equal((await service.usage(d))[0].input, 1000020);
  assert.equal(
    priceFactor(
      { basis: "高峰参考价" },
      Date.parse("2026-11-27T09:20:00+08:00"),
    ),
    1,
  );
  assert.equal(
    priceFactor(
      { basis: "高峰参考价" },
      Date.parse("2026-11-28T09:20:00+08:00"),
    ),
    0.5,
  );
  await assert.rejects(
    service.configure({ base: "http://example.com" }),
    /HTTPS/,
  );
});
