/**
 * notifier.js (slackNotifier.js) — Slack webhook + email notifications
 * Called on reply/bounce events from bounceCheckPhase.
 */

const nodemailer = require('nodemailer');
const { decrypt } = require('../utils/crypto');

// ── Slack ─────────────────────────────────────────────────────────────────────

async function notify(webhookUrl, message) {
  if (!webhookUrl) return;
  try {
    const https = require('https');
    const body = JSON.stringify({ text: message });

    await new Promise((resolve, reject) => {
      const url = new URL(webhookUrl);
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        res.resume();
        resolve();
      });

      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Slack webhook timeout')));
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.warn('[Slack] Notification failed:', err.message);
  }
}

// ── Email notification (uses brand's first active SMTP account) ───────────────

async function sendEmailNotification(smtpAccounts, toEmail, subject, htmlBody) {
  if (!toEmail || !smtpAccounts?.length) return;

  const acct = smtpAccounts.find(a => a.isActive) || smtpAccounts[0];
  if (!acct) return;

  try {
    const password = decrypt(acct.passwordEncrypted);

    const transporter = nodemailer.createTransport({
      host: acct.host,
      port: acct.port,
      secure: acct.useSSL,
      requireTLS: acct.useTLS && !acct.useSSL,
      auth: { user: acct.username, pass: password },
      tls: { rejectUnauthorized: false }
    });

    await transporter.sendMail({
      from: `"${acct.fromName || acct.senderName}" <${acct.fromEmail}>`,
      to: toEmail,
      subject,
      html: htmlBody,
      text: htmlBody.replace(/<[^>]+>/g, '')
    });

    console.log(`[Notify] Email sent to ${toEmail}: ${subject}`);
  } catch (err) {
    console.warn('[Notify] Email notification failed:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

async function notifyReply(brand, contact, replySnippet, smtpAccounts = []) {
  // Slack
  if (brand.slack?.enabled && brand.slack?.notifyOnReply && brand.slack?.webhookUrl) {
    const msg = `✉️ *Reply received* — ${brand.name}\n*From:* ${contact.email}\n*Name:* ${contact.firstName || ''} ${contact.lastName || ''} @ ${contact.companyName || ''}\n*Preview:* ${replySnippet?.slice(0, 200) || 'N/A'}`;
    await notify(brand.slack.webhookUrl, msg);
  }

  // Email notification
  const notifyEmail = brand.notifications?.replyNotifyEmail;
  if (notifyEmail) {
    const subject = `[${brand.name}] Reply from ${contact.firstName || ''} ${contact.lastName || ''} @ ${contact.companyName || contact.email}`;
    const html = `
      <div style="font-family:sans-serif;max-width:600px;padding:20px">
        <h2 style="color:#276749">✉️ Reply Received — ${brand.name}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888;width:140px">From</td><td><strong>${contact.email}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#888">Name</td><td>${[contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Company</td><td>${contact.companyName || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Job Title</td><td>${contact.jobTitle || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">A/B Variant</td><td>${contact.abVariant || 'N/A'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Sent From</td><td>${contact.sentFrom || '—'}</td></tr>
        </table>
        ${replySnippet ? `
        <div style="margin-top:16px;padding:14px;background:#f0fff4;border-left:4px solid #68d391;border-radius:6px">
          <div style="font-size:12px;font-weight:600;color:#276749;margin-bottom:6px">REPLY PREVIEW</div>
          <div style="font-size:14px;color:#333;line-height:1.6">${replySnippet}</div>
        </div>` : ''}
        <p style="margin-top:16px;font-size:12px;color:#aaa">Sent by Email Agent — ${brand.name} campaign</p>
      </div>`;
    await sendEmailNotification(smtpAccounts, notifyEmail, subject, html);
  }
}

async function notifyBounce(brand, contact, reason, smtpAccounts = []) {
  // Slack
  if (brand.slack?.enabled && brand.slack?.notifyOnBounce && brand.slack?.webhookUrl) {
    const msg = `⚠️ *Bounce detected* — ${brand.name}\n*Email:* ${contact.email}\n*Reason:* ${reason || 'delivery failure'}`;
    await notify(brand.slack.webhookUrl, msg);
  }

  // Email notification
  const notifyEmail = brand.notifications?.bounceNotifyEmail;
  if (notifyEmail) {
    const subject = `[${brand.name}] Bounce: ${contact.email}`;
    const html = `
      <div style="font-family:sans-serif;max-width:600px;padding:20px">
        <h2 style="color:#c53030">⚠️ Bounce Detected — ${brand.name}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888;width:140px">Email</td><td><strong>${contact.email}</strong></td></tr>
          <tr><td style="padding:6px 0;color:#888">Name</td><td>${[contact.firstName, contact.lastName].filter(Boolean).join(' ') || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Company</td><td>${contact.companyName || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Reason</td><td style="color:#c53030">${reason || 'delivery failure'}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:12px;color:#aaa">Sent by Email Agent — ${brand.name} campaign</p>
      </div>`;
    await sendEmailNotification(smtpAccounts, notifyEmail, subject, html);
  }
}

module.exports = { notify, notifyReply, notifyBounce };
