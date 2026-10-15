import { getConfig } from "./config.js";

function esc(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function formatViewLink(url, mode) {
  const href = esc(url);
  if (!href) return "无链接";
  if (mode === "plain") return `点此查看: ${href}`;
  // Wrap URL with <> to improve markdown compatibility for long/special URLs.
  return `[点此查看](<${href}>)`;
}

function buildTextWithLimit(lines, maxLen = 3500) {
  const output = [];
  let total = 0;
  for (const line of lines) {
    const segment = `${line}\n`;
    if (total + segment.length > maxLen) break;
    output.push(line);
    total += segment.length;
  }
  return output.join("\n").trimEnd();
}

function blockLength(lines, currentLen = 0) {
  if (!Array.isArray(lines) || lines.length === 0) return 0;
  let len = 0;
  for (const line of lines) {
    len += String(line || "").length;
  }
  // Join separators inside block + one leading separator when appending to non-empty text.
  len += Math.max(0, lines.length - 1);
  if (currentLen > 0) len += 1;
  return len;
}

function tryAppendBlock(target, state, block, maxLen = 3500) {
  const need = blockLength(block, state.len);
  if (state.len + need > maxLen) return false;
  for (const line of block) {
    target.push(line);
  }
  state.len += need;
  return true;
}

function buildFeishuText({
  taskName,
  fetchTime,
  complianceDigest = [],
  communityPulse = null,
  linkRenderMode = "markdown",
}) {
  const maxLen = 6000;
  const lines = [];
  const size = { len: 0 };
  const findings = Array.isArray(communityPulse?.findings) ? communityPulse.findings.slice(0, 5) : [];
  const hasCommunityPulse = Boolean(
    communityPulse && (
      communityPulse.conclusion ||
      findings.length > 0 ||
      communityPulse.hasDiscussion === true
    )
  );

  tryAppendBlock(lines, size, [`News Alert 合规AI总结`], maxLen);
  if (taskName) tryAppendBlock(lines, size, [`任务: ${taskName}`], maxLen);
  if (fetchTime) tryAppendBlock(lines, size, [`时间: ${fetchTime}`], maxLen);
  tryAppendBlock(lines, size, [""], maxLen);

  tryAppendBlock(lines, size, ["Bambu Lab 社区舆情:"], maxLen);
  if (hasCommunityPulse) {
    tryAppendBlock(lines, size, ["- 状态: 有社区舆情总结"], maxLen);
    if (communityPulse?.conclusion) tryAppendBlock(lines, size, [`- 结论: ${esc(communityPulse.conclusion)}`], maxLen);
    findings.forEach((f, i) => {
      const src = esc(f?.source || "Unknown");
      const topic = esc(f?.topic || "社区讨论");
      const detail = esc(f?.details || "");
      const block = [`- ${i + 1}) [${src}] ${topic}${detail ? `: ${detail}` : ""}`];
      if (f?.link) block.push(`  ${f.link}`);
      tryAppendBlock(lines, size, block, maxLen);
    });
  } else {
    tryAppendBlock(lines, size, ["- 状态: 暂无社区舆情总结"], maxLen);
  }
  tryAppendBlock(lines, size, [""], maxLen);

  if (Array.isArray(complianceDigest) && complianceDigest.length > 0) {
    tryAppendBlock(lines, size, [`Top ${Math.min(10, complianceDigest.length)}（标题 + 原文链接）:`], maxLen);
    let appendedCount = 0;
    complianceDigest.slice(0, 10).forEach((item, idx) => {
      const title = esc(item?.title || "无标题");
      const link = esc(item?.link || "");
      const block = [
        `${idx + 1}. ${title}`,
        `   原文: ${formatViewLink(link, linkRenderMode)}`,
      ];
      if (tryAppendBlock(lines, size, block, maxLen)) {
        appendedCount += 1;
      }
    });
    if (appendedCount < Math.min(10, complianceDigest.length)) {
      tryAppendBlock(lines, size, [`（因消息长度限制，仅展示前 ${appendedCount} 条完整项）`], maxLen);
    }
    tryAppendBlock(lines, size, [""], maxLen);
  } else {
    tryAppendBlock(lines, size, ["暂无可发送的合规 AI 总结。", ""], maxLen);
  }

  return lines.join("\n").trimEnd();
}

export async function sendComplianceDigestWebhook({
  taskName = "",
  fetchTime = "",
  complianceDigest = [],
  communityPulse = null,
}) {
  const config = getConfig();
  const webhook = config.webhook || {};
  const url = String(webhook.url || "").trim();
  const linkRenderMode = webhook.linkRenderMode === "plain" ? "plain" : "markdown";

  if (!webhook.enabled) {
    return { ok: false, skipped: true, reason: "webhook disabled" };
  }
  if (!url) {
    throw new Error("Webhook 未配置 URL");
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Webhook URL 格式无效");
  }
  const isFeishuBotWebhook =
    /(^|\.)open\.feishu\.cn$/i.test(parsedUrl.hostname) &&
    /\/open-apis\/bot\/v2\/hook\//i.test(parsedUrl.pathname);
  const isFeishuFlowWebhook =
    /(^|\.)feishu\.cn$/i.test(parsedUrl.hostname) &&
    /\/flow\/api\/trigger-webhook\//i.test(parsedUrl.pathname);
  if (!isFeishuBotWebhook && !isFeishuFlowWebhook) {
    throw new Error("当前 URL 不是飞书 webhook（支持 open.feishu.cn 机器人 或 feishu.cn/flow 触发器）");
  }

  const text = buildFeishuText({
    taskName,
    fetchTime,
    complianceDigest,
    communityPulse,
    linkRenderMode,
  });
  const payload = isFeishuFlowWebhook
    ? {
      summary: text,
    }
    : {
      msg_type: "text",
      content: { text },
    };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });

  const raw = await resp.text();
  if (!resp.ok) {
    throw new Error(`Webhook ${resp.status}: ${raw.slice(0, 300)}`);
  }
  if (isFeishuFlowWebhook) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.code !== 0) {
        throw new Error(`Flow webhook返回异常: ${raw.slice(0, 300)}`);
      }
    } catch (err) {
      if (err.message.startsWith("Flow webhook")) throw err;
      // Flow webhook可能返回非JSON，HTTP 2xx视为成功
    }
  }

  return { ok: true, status: resp.status, response: raw.slice(0, 500) };
}

