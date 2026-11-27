const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const DEFAULT_BASE = "https://api.deepseek.com";
async function read(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}
async function write(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
function endpoint(input) {
  const u = new URL(input);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === "https:" ||
      (u.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))
    )
  )
    throw Error("服务地址须使用 HTTPS，本机服务可用 HTTP。");
  return u.href.replace(/\/+$/, "");
}
const isDeepSeek = (base) => new URL(base).origin === DEFAULT_BASE;
function defaultRates(base, model) {
  if (!isDeepSeek(base)) return null;
  if (
    [
      "deepseek-flash",
      "deepseek-v4-flash",
      "deepseek-v4-flash-vision-exp",
    ].includes(model)
  )
    return { input: 2, cached: 0.04, output: 8, basis: "高峰参考价" };
  if (model === "deepseek-v4-pro")
    return { input: 9, cached: 0.3, output: 27, basis: "高峰参考价" };
  return null;
}
function priceFactor(rates, time) {
  if (rates?.basis !== "高峰参考价") return 1;
  const t = new Date(time + 8 * 3600000),
    day = t.getUTCDay(),
    h = t.getUTCHours();
  return day >= 1 && day <= 5 && ((h >= 9 && h < 12) || (h >= 14 && h < 18))
    ? 1
    : 0.5;
}
class ModelService {
  constructor(root, secure, transport = fetch) {
    this.root = root;
    this.file = path.join(root, "ai-settings.json");
    this.secure = secure;
    this.fetch = transport;
  }
  async config() {
    return read(this.file, {
      base: DEFAULT_BASE,
      model: "",
      secret: "",
      prices: {},
    });
  }
  async info() {
    const c = await this.config();
    return {
      base: c.base,
      model: c.model,
      hasToken: !!c.secret,
      rates: c.prices?.[c.model] || defaultRates(c.base, c.model),
    };
  }
  async configure({ base, token, model, rates }) {
    const prev = await this.config(),
      url = endpoint(base),
      same = url === prev.base;
    let secret = same ? prev.secret : "";
    if (typeof token === "string" && token.trim()) {
      if (!this.secure.isEncryptionAvailable())
        throw Error("当前系统无法加密保存 Token。");
      secret = this.secure.encryptString(token.trim()).toString("base64");
    }
    const prices = same ? { ...prev.prices } : {};
    if (rates && model) {
      for (const k of ["input", "cached", "output"])
        if (
          typeof rates[k] !== "number" ||
          !Number.isFinite(rates[k]) ||
          rates[k] < 0
        )
          throw Error("单价须为非负数。");
      prices[model] = {
        input: rates.input,
        cached: rates.cached,
        output: rates.output,
        basis: "自定义价格",
      };
    }
    if (rates === null && model) delete prices[model];
    await write(this.file, { base: url, secret, model: model || "", prices });
    return this.info();
  }
  async request(c, route, body) {
    const token = c.secret
      ? this.secure.decryptString(Buffer.from(c.secret, "base64"))
      : "";
    const res = await this.fetch(c.base + route, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: {
        ...(token ? { Authorization: "Bearer " + token } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok)
      throw Error(
        "模型服务返回 HTTP " +
          res.status +
          "。" +
          ({
            400: "请检查模型的图片及工具调用能力。",
            401: "请检查 Token。",
            402: "请检查服务账户余额。",
            403: "请检查模型权限。",
            429: "请稍后重试或检查配额。",
          }[res.status] || "请检查服务地址和模型。"),
      );
    return res.json();
  }
  async models() {
    const c = await this.config();
    const result = await this.request(c, "/models");
    if (!Array.isArray(result.data)) throw Error("模型列表格式不正确。");
    return result.data
      .filter((m) => typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        image: Array.isArray(m.input_modalities)
          ? m.input_modalities.includes("image")
          : null,
      }));
  }
  async chat(c, messages, tools, mode) {
    const time = Date.now(),
      body = {
        model: c.model,
        messages,
        tools,
        max_tokens: 4096,
        ...(isDeepSeek(c.base) ? { thinking: { type: "disabled" } } : {}),
      };
    const result = await this.request(c, "/chat/completions", body);
    const usage = result.usage,
      rates = c.prices?.[c.model] || defaultRates(c.base, c.model);
    const known =
      Number.isFinite(usage?.prompt_tokens) &&
      Number.isFinite(usage?.completion_tokens);
    const input = known ? usage.prompt_tokens : 0,
      output = known ? usage.completion_tokens : 0,
      cached = Math.min(
        input,
        usage?.prompt_cache_hit_tokens ??
          usage?.prompt_tokens_details?.cached_tokens ??
          0,
      );
    const cost =
      known && rates
        ? (((input - cached) * rates.input +
            cached * rates.cached +
            output * rates.output) *
            priceFactor(rates, time)) /
          1e6
        : null;
    await fs.mkdir(this.root, { recursive: true });
    await fs.appendFile(
      path.join(this.root, "ai-usage.jsonl"),
      JSON.stringify({
        time,
        mode,
        model: c.model,
        base: c.base,
        input,
        output,
        cached,
        known,
        cost,
        basis: rates?.basis,
      }) + "\n",
    );
    const message = result.choices?.[0]?.message;
    if (!message) throw Error("服务未返回对话消息。");
    return message;
  }
  async usage(days) {
    if (![1, 7, 30, 365].includes(days)) throw Error("无效时间范围");
    let data = "";
    try {
      data = await fs.readFile(path.join(this.root, "ai-usage.jsonl"), "utf8");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const since = Date.now() - days * 86400000,
      groups = new Map();
    for (const line of data.trim().split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      if (r.time < since) continue;
      const key = r.base + " | " + r.model,
        g = groups.get(key) || {
          model: r.model,
          base: r.base,
          calls: 0,
          input: 0,
          output: 0,
          cached: 0,
          cost: 0,
          unknown: 0,
          unmetered: 0,
        };
      g.calls++;
      g.input += r.input;
      g.output += r.output;
      g.cached += r.cached;
      if (r.cost === null) g.unknown++;
      else g.cost += r.cost;
      if (!r.known) g.unmetered++;
      groups.set(key, g);
    }
    return [...groups.values()];
  }
}
module.exports = { ModelService, read, write, defaultRates, priceFactor };
