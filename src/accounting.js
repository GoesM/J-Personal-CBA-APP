/* Shared accounting rules: renderer, storage validation, and tests use one model. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LedgerAccounting = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TAGS = Object.freeze({
    borrowed: {
      name: "债务（借入）",
      type: "income",
      party: "向谁借入",
      claim: true,
    },
    repaid: {
      name: "债务（还出）",
      type: "expense",
      party: "还给谁",
      target: "borrowed",
    },
    lent: {
      name: "债务（借出）",
      type: "expense",
      party: "为谁垫付 / 借给谁",
      claim: true,
    },
    recovered: {
      name: "债务（收回）",
      type: "income",
      party: "谁归还给你",
      target: "lent",
    },
    reimbursable: {
      name: "可报销",
      type: "expense",
      party: "报销单位 / 项目（选填）",
      claim: true,
    },
    reimbursed: {
      name: "报销",
      type: "income",
      party: "报销来源（选填）",
      target: "reimbursable",
    },
  });
  const cents = (amount) => Math.round(Number(amount || 0) * 100);
  const amountOK = (value) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1e9 &&
    Math.abs(value * 100 - cents(value)) < 1e-6;
  const textOK = (value, max) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim() &&
    value.length <= max;
  const parts = (entry) => entry.special || [];
  const actualAmount = (entry) =>
    (cents(entry.amount) -
      parts(entry).reduce((n, p) => n + cents(p.amount), 0)) /
    100;
  const cashAmount = (entry) =>
    (cents(entry.amount) -
      (entry.type === "expense" ? cents(entry.credit?.amount) : 0)) /
    100;
  function claims(entries, cutoff = "9999-12-31") {
    const result = [];
    for (const entry of entries) {
      if (entry.date > cutoff) continue;
      for (const part of parts(entry)) {
        if (TAGS[part.kind]?.claim)
          result.push({
            ...part,
            entryId: entry.id,
            date: entry.date,
            description: entry.description,
            categoryId: entry.categoryId,
            settled: 0,
            settlements: [],
          });
      }
      if (entry.credit)
        result.push({
          id: `${entry.id}:credit`,
          kind: "borrowed",
          party: entry.credit.party,
          amount: entry.credit.amount,
          entryId: entry.id,
          date: entry.date,
          description: entry.description,
          categoryId: entry.categoryId,
          credit: true,
          settled: 0,
          settlements: [],
        });
    }
    const lookup = new Map(result.map((claim) => [claim.id, claim]));
    for (const entry of entries) {
      if (entry.date > cutoff) continue;
      for (const part of parts(entry)) {
        if (!TAGS[part.kind]?.target) continue;
        const claim = lookup.get(part.targetId);
        if (!claim) continue;
        claim.settled = (cents(claim.settled) + cents(part.amount)) / 100;
        claim.settlements.push({
          entryId: entry.id,
          date: entry.date,
          amount: part.amount,
          description: entry.description,
        });
      }
    }
    return result
      .map((claim) => ({
        ...claim,
        remaining: (cents(claim.amount) - cents(claim.settled)) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  function validate(entries) {
    const ids = new Set(entries.map((e) => `${e.id}:credit`));
    const lookup = new Map();
    for (const entry of entries) {
      if (
        entry.special !== undefined &&
        (!Array.isArray(entry.special) || entry.special.length > 50)
      )
        throw new Error("每笔账目的特定标签明细最多 50 项。");
      let allocated = 0;
      for (const part of parts(entry)) {
        if (!part || !textOK(part.id, 80) || ids.has(part.id))
          throw new Error("特定标签明细 ID 重复或无效。");
        ids.add(part.id);
        const tag = TAGS[part.kind];
        if (!tag || tag.type !== entry.type || !amountOK(part.amount))
          throw new Error("特定标签的类型或金额无效。");
        allocated += cents(part.amount);
        if (["reimbursable", "reimbursed"].includes(part.kind)) {
          if (
            typeof part.party !== "string" ||
            part.party !== part.party.trim() ||
            part.party.length > 60
          )
            throw new Error("报销单位信息无效。");
        } else if (!textOK(part.party, 60))
          throw new Error(`${tag.name}需要填写对方名称。`);
        if (tag.claim)
          lookup.set(part.id, { ...part, date: entry.date, entryId: entry.id });
      }
      if (allocated > cents(entry.amount))
        throw new Error("垫付、报销或债务拆分金额合计不能超过本笔总金额。");
      if (entry.credit !== undefined) {
        if (
          !entry.credit ||
          entry.type !== "expense" ||
          !textOK(entry.credit.party, 60) ||
          !amountOK(entry.credit.amount) ||
          cents(entry.credit.amount) > cents(entry.amount)
        )
          throw new Error("信用付款需填写贷款方，金额不能超过本笔总金额。");
        lookup.set(`${entry.id}:credit`, {
          kind: "borrowed",
          party: entry.credit.party,
          amount: entry.credit.amount,
          date: entry.date,
          entryId: entry.id,
        });
      }
    }
    const settled = new Map();
    for (const entry of entries) {
      for (const part of parts(entry)) {
        const targetKind = TAGS[part.kind].target;
        if (!targetKind) continue;
        const target = lookup.get(part.targetId);
        if (!target || target.kind !== targetKind)
          throw new Error(
            `${TAGS[part.kind].name}必须关联有效的原始账目。请先处理其关联记录。`,
          );
        if (target.entryId === entry.id)
          throw new Error("结算不能关联同一笔账目自身的欠款。");
        if (
          target.party !== part.party &&
          !(target.kind === "reimbursable" && target.party === "")
        )
          throw new Error("还款、收回或报销的对方必须与原始账目一致。");
        if (entry.date < target.date)
          throw new Error("结算日期不能早于原始账目日期。");
        const paid = (settled.get(part.targetId) || 0) + cents(part.amount);
        if (paid > cents(target.amount))
          throw new Error(
            "累计还款、收回或报销金额不能超过原始金额；利息或额外收入请作为普通收支记录。",
          );
        settled.set(part.targetId, paid);
      }
    }
    return entries;
  }
  function components(entry) {
    const result = [];
    const actual = actualAmount(entry);
    if (actual > 0)
      result.push({
        kind: "ordinary",
        name: entry.type === "expense" ? "自己的实际支出" : "实际收入",
        amount: actual,
      });
    for (const part of parts(entry))
      result.push({ ...part, name: TAGS[part.kind].name });
    if (entry.credit)
      result.push({
        kind: "borrowed",
        name: "债务（借入）· 信用付款",
        amount: entry.credit.amount,
        party: entry.credit.party,
        funding: true,
      });
    return result;
  }
  function balances(entries, cutoff) {
    const all = claims(entries, cutoff);
    const grouped = new Map();
    for (const claim of all.filter((c) => c.kind !== "reimbursable")) {
      const key = `${claim.kind}:${claim.party}`;
      if (!grouped.has(key))
        grouped.set(key, {
          kind: claim.kind,
          party: claim.party,
          amount: 0,
          settled: 0,
          remaining: 0,
          claims: [],
        });
      const group = grouped.get(key);
      for (const field of ["amount", "settled", "remaining"])
        group[field] = (cents(group[field]) + cents(claim[field])) / 100;
      group.claims.push(claim);
    }
    return {
      debts: [...grouped.values()].sort(
        (a, b) => b.remaining - a.remaining || a.party.localeCompare(b.party),
      ),
      reimbursements: all.filter((c) => c.kind === "reimbursable"),
      claims: all,
    };
  }
  function planDeletion(entries, entryId) {
    const removed = entries.find((entry) => entry.id === entryId);
    if (!removed) throw new Error("要删除的账目不存在。");
    const remaining = entries
      .filter((entry) => entry.id !== entryId)
      .map((entry) => ({
        ...entry,
        ...(entry.special
          ? { special: entry.special.map((part) => ({ ...part })) }
          : {}),
      }));
    const originalClaims = new Map(
      claims(entries)
        .filter((claim) => claim.entryId === entryId)
        .map((claim) => [claim.id, claim]),
    );
    const transfers = [];
    const blockers = [];
    for (const entry of remaining
      .filter((item) =>
        item.special?.some((part) => originalClaims.has(part.targetId)),
      )
      .sort(
        (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
      )) {
      for (const part of entry.special) {
        const oldClaim = originalClaims.get(part.targetId);
        if (!oldClaim) continue;
        // Repayments to the same lender are fungible. Reimbursements and personal
        // advances identify a specific underlying expense, so require review.
        const replacement =
          part.kind === "repaid" && oldClaim.kind === "borrowed"
            ? claims(remaining).find(
                (claim) =>
                  claim.kind === "borrowed" &&
                  claim.party === part.party &&
                  claim.entryId !== entry.id &&
                  claim.date <= entry.date &&
                  cents(claim.remaining) >= cents(part.amount),
              )
            : null;
        if (!replacement) {
          blockers.push({
            entryId: entry.id,
            description: entry.description,
            kind: part.kind,
          });
          continue;
        }
        part.targetId = replacement.id;
        transfers.push({
          entryId: entry.id,
          description: entry.description,
          amount: part.amount,
          targetEntryId: replacement.entryId,
          targetDescription: replacement.description,
        });
      }
    }
    if (!blockers.length) validate(remaining);
    return { entries: remaining, transfers, blockers };
  }
  function legacyKind(entry, categories) {
    if (parts(entry).length || entry.credit) return null;
    const category = categories.find((c) => c.id === entry.categoryId);
    return (
      Object.keys(TAGS).find(
        (kind) =>
          TAGS[kind].name === category?.name && TAGS[kind].type === entry.type,
      ) || null
    );
  }
  return {
    TAGS,
    cents,
    actualAmount,
    cashAmount,
    claims,
    validate,
    components,
    balances,
    planDeletion,
    legacyKind,
  };
});
