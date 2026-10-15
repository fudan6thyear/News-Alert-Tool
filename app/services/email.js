import nodemailer from "nodemailer";
import { getConfig, resolveGroupEmails } from "./config.js";

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(url) {
  if (!url) return "#";
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") return escapeHtml(url);
  } catch {}
  return "#";
}

let _cachedTransporter = null;
let _cachedTransporterKey = "";

function createTransporter() {
  const config = getConfig();
  const { senderEmail, senderPassword, smtpHost, smtpPort } = config.email;

  if (!senderEmail || !senderPassword) {
    throw new Error("邮箱配置不完整，请在设置中填写发件邮箱和授权码");
  }

  const key = `${senderEmail}:${smtpHost}:${smtpPort}`;
  if (_cachedTransporter && _cachedTransporterKey === key) {
    return _cachedTransporter;
  }

  const tlsReject = config.email.tlsRejectUnauthorized;
  _cachedTransporter = nodemailer.createTransport({
    host: smtpHost || "smtp.163.com",
    port: smtpPort || 465,
    secure: true,
    auth: { user: senderEmail, pass: senderPassword },
    tls: { rejectUnauthorized: tlsReject !== false },
  });
  _cachedTransporterKey = key;
  return _cachedTransporter;
}

export function resetTransporter() {
  _cachedTransporter = null;
  _cachedTransporterKey = "";
}

function buildRelatedItemsHtml(items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  const rows = items
    .map((item, index) => {
      const href = safeHref(item.link);
      const meta = [item.source, item.region].filter(Boolean).join(" · ");
      const titleHtml = href !== "#"
        ? `<a href="${href}" style="color:#1a73e8;text-decoration:none;font-weight:600;" target="_blank">${escapeHtml(item.title || "无标题")}</a>`
        : `<strong style="color:#1a73e8;">${escapeHtml(item.title || "无标题")}</strong>`;
      return `<li style="margin:0 0 6px 0;line-height:1.5;">
        ${index + 1}. ${titleHtml}
        ${meta ? `<span style="color:#999;font-size:11px;margin-left:6px;">${escapeHtml(meta)}</span>` : ""}
      </li>`;
    })
    .join("");
  return `
    <div style="margin-top:10px;padding-top:10px;border-top:1px dashed #e5e7eb;">
      <div style="color:#888;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:6px;">相关原文 (${items.length})</div>
      <ol style="padding-left:18px;margin:0;color:#555;font-size:13px;">${rows}</ol>
    </div>`;
}

function buildDigestHtml(digestItems, title, accentColor, fetchTime) {
  const rows = digestItems
    .map((item, i) => {
      const rank = i + 1;
      const rankColor = rank <= 3 ? "#e74c3c" : rank <= 6 ? "#e67e22" : "#3498db";
      return `
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
            <div style="display:flex;gap:12px;align-items:flex-start;">
              <span style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:50%;background:${rankColor};color:#fff;font-weight:700;font-size:13px;flex-shrink:0;">${rank}</span>
              <div style="flex:1;">
                <strong style="color:#1a73e8;font-size:15px;line-height:1.4;">${escapeHtml(item.title || "无标题")}</strong>
                <div style="color:#555;font-size:13px;margin-top:6px;line-height:1.6;">${escapeHtml(item.summary || "")}</div>
                ${(item.sources || item.region) ? `<div style="color:#999;font-size:11px;margin-top:4px;">${item.region ? `地区: ${escapeHtml(item.region)}` : ""}${item.sources ? `${item.region ? " | " : ""}来源: ${escapeHtml(item.sources)}` : ""}</div>` : ""}
                ${buildRelatedItemsHtml(item.relatedItems)}
              </div>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;max-width:680px;margin:0 auto;padding:20px;background:#fff;">
  <div style="text-align:center;padding:20px 0;border-bottom:2px solid ${accentColor};margin-bottom:24px;">
    <h1 style="margin:0;color:${accentColor};font-size:20px;">${title}</h1>
    <p style="margin:6px 0 0;color:#888;font-size:13px;">获取时间: ${fetchTime}</p>
  </div>
  <table style="width:100%;border-collapse:collapse;">${rows}</table>
  <div style="text-align:center;padding:20px 0;border-top:1px solid #eee;margin-top:24px;">
    <p style="color:#aaa;font-size:12px;">由 News Alert 系统自动生成</p>
  </div>
</body></html>`;
}

function buildFullListHtml(newsItems, title, accentColor, fetchTime) {
  const bySource = {};
  for (const item of newsItems) {
    const src = item._source || "unknown";
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(item);
  }

  const sourceBlocks = Object.entries(bySource)
    .map(([source, items]) => {
      const rows = items
        .map((item) => {
          const href = safeHref(item.link);
          const titleHtml = href !== "#"
            ? `<a href="${href}" style="color:#1a73e8;text-decoration:none;font-weight:600;font-size:14px;" target="_blank">${escapeHtml(item.title || "无标题")}</a>`
            : `<strong style="color:#1a73e8;font-size:14px;">${escapeHtml(item.title || "无标题")}</strong>`;
          return `
            <tr><td style="padding:10px 14px;border-bottom:1px solid #eee;">
                ${titleHtml}
                ${(item.summary || item.description) ? `<div style="color:#555;font-size:13px;margin-top:4px;line-height:1.5;">${escapeHtml(item.summary || item.description)}</div>` : ""}
            </td></tr>`;
        })
        .join("");

      const label = source.replace("get_", "").replace("compliance_", "").replace(/_/g, " ").toUpperCase();
      return `<div style="margin-bottom:24px;">
          <h2 style="color:#333;font-size:16px;margin:0 0 8px;padding:8px 14px;background:#f0f4f8;border-radius:6px;">${label}</h2>
          <table style="width:100%;border-collapse:collapse;">${rows}</table>
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;max-width:680px;margin:0 auto;padding:20px;background:#fff;">
  <div style="text-align:center;padding:20px 0;border-bottom:2px solid ${accentColor};margin-bottom:24px;">
    <h1 style="margin:0;color:${accentColor};font-size:20px;">${title}</h1>
    <p style="margin:6px 0 0;color:#888;font-size:13px;">获取时间: ${fetchTime}</p>
  </div>
  ${sourceBlocks}
  <div style="text-align:center;padding:20px 0;border-top:1px solid #eee;margin-top:24px;">
    <p style="color:#aaa;font-size:12px;">由 News Alert 系统自动生成</p>
  </div>
</body></html>`;
}

/**
 * 发送邮件 — 按收件人组分别发送新闻和合规内容
 * @param {object} opts
 * @param {Array}  opts.newsItems
 * @param {Array}  opts.newsDigest
 * @param {Array}  opts.complianceItems
 * @param {Array}  opts.complianceDigest
 * @param {Array}  opts.newsTargetGroups     - group ID 数组
 * @param {Array}  opts.complianceTargetGroups - group ID 数组
 */
export async function sendEmail(opts) {
  const config = getConfig();
  const { senderEmail } = config.email;
  const allGroups = config.recipientGroups || [];

  const {
    newsItems = [],
    newsDigest = [],
    complianceItems = [],
    complianceDigest = [],
    newsTargetGroups,
    complianceTargetGroups,
  } = opts;

  let newsReceivers;
  let complianceReceivers;

  if (newsTargetGroups) {
    newsReceivers = resolveGroupEmails(newsTargetGroups);
  } else {
    newsReceivers = allGroups.length > 0
      ? resolveGroupEmails(allGroups.map((g) => g.id))
      : [];
  }

  if (complianceTargetGroups) {
    complianceReceivers = resolveGroupEmails(complianceTargetGroups);
  } else {
    complianceReceivers = allGroups.length > 0
      ? resolveGroupEmails(allGroups.map((g) => g.id))
      : [];
  }

  const transporter = createTransporter();
  await transporter.verify().catch((err) => {
    throw new Error(`SMTP 连接验证失败: ${err.message}`);
  });

  const fetchTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const results = [];

  if ((newsItems.length > 0 || newsDigest.length > 0) && newsReceivers.length > 0) {
    const hasDigest = newsDigest.length > 0;
    const cappedNews = newsItems.slice(0, 50);
    const html = hasDigest
      ? buildDigestHtml(newsDigest, `News Alert 今日热点 Top ${newsDigest.length}`, "#1a73e8", fetchTime)
      : buildFullListHtml(cappedNews, `News Alert 新闻日报 (${cappedNews.length}/${newsItems.length})`, "#1a73e8", fetchTime);
    const subject = hasDigest
      ? `News Alert 今日热点Top${newsDigest.length} - ${fetchTime}`
      : `News Alert 新闻日报 - ${fetchTime} (${cappedNews.length}条)`;

    const info = await transporter.sendMail({ from: senderEmail, to: newsReceivers.join(", "), subject, html });
    console.log(`[Email] News → ${newsReceivers.join(", ")}: ${info.messageId}`);
    results.push({ type: "news", messageId: info.messageId, to: newsReceivers });
  }

  if ((complianceItems.length > 0 || complianceDigest.length > 0) && complianceReceivers.length > 0) {
    const hasDigest = complianceDigest.length > 0;
    const cappedItems = complianceItems.slice(0, 30);
    const html = hasDigest
      ? buildDigestHtml(complianceDigest, `Privacy & AI Compliance Top ${complianceDigest.length}`, "#7c3aed", fetchTime)
      : buildFullListHtml(cappedItems, `Privacy & AI Compliance Report (${cappedItems.length}/${complianceItems.length})`, "#7c3aed", fetchTime);
    const subject = hasDigest
      ? `Privacy & AI Compliance Top${complianceDigest.length} - ${fetchTime}`
      : `Privacy & AI Compliance - ${fetchTime} (${cappedItems.length}条)`;

    const info = await transporter.sendMail({ from: senderEmail, to: complianceReceivers.join(", "), subject, html });
    console.log(`[Email] Compliance → ${complianceReceivers.join(", ")}: ${info.messageId}`);
    results.push({ type: "compliance", messageId: info.messageId, to: complianceReceivers });
  }

  if (results.length === 0) {
    throw new Error("没有可发送的内容或目标收件人组为空");
  }

  return results;
}
