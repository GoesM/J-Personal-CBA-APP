(() => {
  const $ = (s) => document.querySelector(s),
    drawer = $("#assistant-drawer"),
    api = window.ledgerApi;
  const el = (tag, text) => {
    const n = document.createElement(tag);
    n.textContent = text;
    return n;
  };
  const status = (text) => {
    $("#assistant-status").textContent = text;
  };
  let mode = "record",
    busy = false,
    loadingFiles = 0,
    proposal = null,
    scope = null,
    connection = null,
    priceDirty = false;
  let files = [],
    drafts = { record: "", ask: "" };
  const buttons = [...drawer.querySelectorAll("[data-mode]")];
  const priceFields = ["input", "cached", "output"];
  function setBusy(value) {
    busy = value;
    drawer.querySelectorAll("button,input,textarea,select").forEach((n) => {
      if (!n.hasAttribute("data-dismiss")) n.disabled = value;
    });
  }
  drawer.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  drawer.querySelector("[data-dismiss]").addEventListener(
    "click",
    (event) => {
      if (busy) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true,
  );
  async function task(fn) {
    if (busy) return;
    setBusy(true);
    status("");
    try {
      await fn();
    } catch (e) {
      status(
        String(e.message || e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  function show(panel) {
    if (["record", "ask"].includes(mode))
      drafts[mode] = $("#assistant-text").value;
    mode = panel;
    buttons.forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
    );
    $("#ai-chat").hidden = !["record", "ask"].includes(mode);
    $("#ai-config").hidden = mode !== "config";
    $("#ai-usage").hidden = mode !== "usage";
    if (!$("#ai-chat").hidden) {
      $("#assistant-text").value = drafts[mode] || "";
      $("#assistant-label").textContent =
        mode === "ask" ? "问一问你的账本" : "账单说明";
      $("#assistant-text").placeholder =
        mode === "ask"
          ? "这个月实付多少？还有哪些垫付没有收回？"
          : "例如：识别这张月付账单，核对已有订单，再准备还款记录。";
      $("#ai-send").textContent =
        mode === "record" ? "发送给 AI 智填" : "发送给 AI 智问";
    }
  }
  function paintConversation(rows) {
    const area = $("#ai-history");
    area.replaceChildren();
    for (const row of rows) {
      const item = el("article", "");
      item.className = "ai-message " + row.role;
      item.append(
        el("small", row.role === "user" ? "我" : "账本助手"),
        el("p", row.text),
      );
      area.append(item);
    }
    area.scrollTop = area.scrollHeight;
  }
  async function history() {
    const next = await api.aiHistory();
    if (scope !== next.scope) {
      scope = next.scope;
      drafts = { record: "", ask: "" };
      $("#assistant-text").value = "";
      files = [];
      paintFiles();
    }
    paintConversation(next.history);
    proposal = next.proposal;
    paintProposal();
  }
  function details(entry) {
    if (!entry) return "无";
    return [
      entry.date,
      entry.description,
      (entry.type === "income" ? "收入 " : "支出 ") + entry.amount + " 元",
      "类别 " +
        (window.ledgerAgentView?.categoryName(entry.categoryId) ||
          entry.categoryId),
      ...(entry.special || []).map(
        (p) =>
          window.LedgerAccounting.TAGS[p.kind].name +
          " · " +
          p.party +
          " " +
          p.amount +
          " 元" +
          (p.principal != null ? "，核销本金 " + p.principal : "") +
          (p.targetId ? "，关联 " + p.targetId : ""),
      ),
      ...(entry.credit
        ? ["信用付款 " + entry.credit.party + " " + entry.credit.amount + " 元"]
        : []),
    ].join("\n");
  }
  function paintProposal() {
    const area = $("#ai-proposal");
    area.replaceChildren();
    area.hidden = !proposal;
    if (!proposal) return;
    area.append(el("h3", "待确认 · " + proposal.changes.length + " 项变更"));
    for (const c of proposal.changes) {
      const d = el("details", "");
      d.open = true;
      d.append(
        el(
          "summary",
          (c.before ? (c.after ? "修改" : "删除") : "新增") +
            " · " +
            (c.after || c.before).description,
        ),
      );
      if (c.before) d.append(el("pre", "原账目\n" + details(c.before)));
      if (c.after)
        d.append(el("pre", (c.before ? "修改后\n" : "") + details(c.after)));
      area.append(d);
    }
    const ok = el("button", "确认写入账本"),
      cancel = el("button", "取消草稿");
    ok.className = "primary-button";
    cancel.className = "secondary-button";
    ok.onclick = () =>
      task(async () => {
        await window.ledgerAgentView.ready();
        const next = await api.aiApply(proposal.id);
        window.ledgerAgentView.applied(next);
        await history();
        status("已保存到当前账本。");
      });
    cancel.onclick = () =>
      task(async () => {
        await api.aiDiscard(proposal.id);
        await history();
      });
    area.append(ok, cancel);
  }
  function models(items, current) {
    const s = $("#ai-model");
    s.replaceChildren();
    for (const m of items) {
      const o = el(
        "option",
        m.id +
          (m.image === true
            ? " · 支持图片"
            : m.image === false
              ? " · 仅文本"
              : ""),
      );
      o.value = m.id;
      s.append(o);
    }
    if (items.some((m) => m.id === current)) s.value = current;
  }
  function paintRates(c) {
    const r = c?.rates;
    priceDirty = false;
    for (const k of priceFields) $("#ai-" + k).value = r?.[k] ?? "";
    $("#ai-price-hint").textContent = r
      ? r.basis + "。可输入自定义结算单价。"
      : "可填写单价；留空使用已知服务价格。";
  }
  async function info() {
    connection = await api.aiInfo();
    $("#ai-base").value = connection.base;
    $("#ai-token").value = "";
    $("#ai-token").placeholder = connection.hasToken
      ? "已在本机加密保存，留空沿用"
      : "输入服务商 Token";
    $("#ai-connection").textContent = connection.model
      ? new URL(connection.base).host + " · " + connection.model
      : "尚未选择模型";
    models(
      connection.model ? [{ id: connection.model }] : [],
      connection.model,
    );
    paintRates(connection);
  }
  async function usage() {
    const rows = await api.aiUsage(Number($("#ai-period").value)),
      area = $("#ai-usage-result");
    area.replaceChildren();
    const total = (k) => rows.reduce((n, r) => n + r[k], 0);
    area.append(
      el(
        "h3",
        "估算费用 " +
          (total("calls") && total("unknown") === total("calls")
            ? "待定"
            : "¥ " + total("cost").toFixed(5)),
      ),
    );
    area.append(
      el(
        "p",
        total("calls") +
          " 次调用 · 输入 " +
          total("input").toLocaleString() +
          " Token · 输出 " +
          total("output").toLocaleString() +
          " Token",
      ),
    );
    if (total("unknown"))
      area.append(
        el(
          "p",
          total("unknown") +
            " 次调用费用待定，其中 " +
            total("unmetered") +
            " 次未返回 Token 用量。",
        ),
      );
    for (const r of rows) {
      const card = el("article", "");
      card.append(
        el("strong", r.model),
        el("small", new URL(r.base).host + " · " + r.calls + " 次"),
        el(
          "p",
          "输入 " +
            r.input +
            "（缓存命中 " +
            r.cached +
            "） · 输出 " +
            r.output +
            " · " +
            (r.unknown === r.calls ? "费用待定" : "¥ " + r.cost.toFixed(5)),
        ),
      );
      area.append(card);
    }
  }
  function enter(panel) {
    show(panel);
    status("");
    if (panel === "usage") return task(usage);
    if (panel === "config") return task(info);
  }
  buttons.forEach((b) => (b.onclick = () => enter(b.dataset.mode)));
  function open(panel) {
    if (!drawer.open) drawer.showModal();
    show(panel);
    if (!api?.aiInfo) {
      status("请在 Windows 版拾光账本中连接模型服务。");
      return;
    }
    task(async () => {
      await window.ledgerAgentView.ready();
      await info();
      await history();
      if (!connection.model) {
        show("config");
        status("请获取可用模型并保存。");
      }
    });
  }
  $("#assistant-open").onclick = () => open("record");
  $("#assistant-ask").onclick = () => open("ask");
  $("#ai-discover").onclick = () =>
    task(async () => {
      const base = $("#ai-base").value.trim();
      const same = connection?.base === base.replace(/\/+$/, "");
      connection = await api.aiConfigure({
        base,
        token: $("#ai-token").value,
        model: same ? connection.model : "",
      });
      $("#ai-token").value = "";
      const items = await api.aiModels();
      models(items, connection.model);
      paintRates(await api.aiRates($("#ai-model").value));
      status(
        items.length ? "请选择模型，然后保存。" : "服务没有返回可用模型。",
      );
    });
  $("#ai-model").onchange = () =>
    task(async () => paintRates(await api.aiRates($("#ai-model").value)));
  for (const k of priceFields)
    $("#ai-" + k).oninput = () => {
      priceDirty = true;
    };
  $("#ai-save").onclick = () =>
    task(async () => {
      if (!$("#ai-model").value) throw Error("请先获取可用模型。");
      if ($("#ai-base").value.trim().replace(/\/+$/, "") !== connection.base)
        throw Error("请先获取新服务的模型列表。");
      const cfg = {
        base: connection.base,
        model: $("#ai-model").value,
        token: $("#ai-token").value,
      };
      if (priceDirty) {
        const inputs = priceFields.map((k) => $("#ai-" + k).value);
        if (inputs.every((x) => x === "")) cfg.rates = null;
        else if (inputs.some((x) => x === ""))
          throw Error("请填写全部三项单价，或清空使用参考价。");
        else
          cfg.rates = Object.fromEntries(
            priceFields.map((k, i) => [k, Number(inputs[i])]),
          );
      }
      await api.aiConfigure(cfg);
      await info();
      show("record");
      status("模型设置已保存。");
    });
  $("#ai-period").onchange = () => task(usage);
  function paintFiles() {
    const area = $("#assistant-images");
    area.replaceChildren();
    for (const f of files) {
      const tile = el("figure", "");
      if (f.image) {
        const img = document.createElement("img");
        img.src = f.image;
        img.alt = f.name;
        tile.append(img);
      } else tile.append(el("figcaption", f.name));
      const rm = el("button", "×");
      rm.setAttribute("aria-label", "移除 " + f.name);
      rm.onclick = () => {
        files = files.filter((item) => item !== f);
        paintFiles();
      };
      tile.append(rm);
      area.append(tile);
    }
  }
  async function attach(items) {
    if (busy || loadingFiles) return;
    loadingFiles++;
    try {
      for (const f of items) {
        if (files.length >= 6) throw Error("每次最多添加 6 个附件。");
        if (["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
          if (f.size > 6 * 1024 * 1024) throw Error("单张图片上限为 6 MB。");
          const image = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(Error("图片读取失败"));
            r.readAsDataURL(f);
          });
          files.push({ name: f.name, image });
        } else if (/\.(csv|txt)$/i.test(f.name)) {
          if (f.size > 400000) throw Error("文本账单过大，请按月份拆分。");
          const bytes = await f.arrayBuffer();
          let text;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            text = new TextDecoder("gb18030").decode(bytes);
          }
          files.push({ name: f.name, text });
        } else throw Error("支持 PNG、JPEG、WebP、CSV、TXT。");
      }
    } catch (e) {
      status(e.message);
    } finally {
      loadingFiles--;
      paintFiles();
    }
  }
  $("#assistant-upload").onclick = () => $("#assistant-files").click();
  $("#assistant-files").onchange = (e) => {
    attach(Array.from(e.target.files));
    e.target.value = "";
  };
  drawer.ondragover = (e) => e.preventDefault();
  drawer.ondrop = (e) => {
    e.preventDefault();
    attach(e.dataTransfer.files);
  };
  drawer.onpaste = (e) => {
    if (e.clipboardData?.files.length) {
      e.preventDefault();
      attach(e.clipboardData.files);
    }
  };
  $("#ai-send").onclick = () =>
    task(async () => {
      if (loadingFiles) throw Error("正在读取附件。");
      if (!api?.aiTurn) throw Error("请在 Windows 版中使用智能体。");
      const text = $("#assistant-text").value.trim(),
        images = files.filter((f) => f.image).map((f) => f.image),
        bill = files
          .filter((f) => f.text)
          .map((f) => f.name + "\n" + f.text)
          .join("\n");
      if (!text && !files.length) throw Error("请输入文字或添加账单。");
      await window.ledgerAgentView.ready();
      status("正在查账或整理建议…");
      try {
        await api.aiTurn({ mode, text, images, bill });
      } catch (e) {
        await history();
        throw e;
      }
      drafts[mode] = "";
      $("#assistant-text").value = "";
      files = [];
      paintFiles();
      await history();
      status("");
    });
})();
