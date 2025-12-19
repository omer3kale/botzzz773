const nodemailer = require('nodemailer');
const { supabaseAdmin } = require('./supabase');

function getEnvFlag(name, def = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return def;
  const s = String(raw).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(s);
}

function normalizeSettingValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { return value; }
    }
  }
  return value;
}

async function loadSettings(keys = ['general', 'notification', 'integrations']) {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .in('key', keys);
    if (error) {
      console.warn('[alert-email] Settings fetch error, using env:', error && (error.message || error));
      return {};
    }
    const map = {};
    (data || []).forEach(row => { map[row.key] = normalizeSettingValue(row.value); });
    return map;
  } catch (err) {
    console.warn('[alert-email] Settings fetch exception, using env:', err && err.message ? err.message : err);
    return {};
  }
}

async function resolveEmailConfig() {
  const settingsMap = await loadSettings();
  const notification = settingsMap.notification || {};
  const general = settingsMap.general || {};

  const SMTP_HOST = process.env.SMTP_HOST || notification.smtpHost || 'smtp.gmail.com';
  const SMTP_PORT = Number(process.env.SMTP_PORT || notification.smtpPort || 587);
  const SMTP_USER = process.env.SMTP_USER || notification.smtpUsername || '';
  const SMTP_PASS = process.env.SMTP_PASS || notification.smtpPassword || '';
  const SMTP_FROM = process.env.ALERT_EMAIL_FROM
    || notification.smtpFrom
    || (SMTP_USER ? `BOTZZZ773 Alerts <${SMTP_USER}>` : 'BOTZZZ773 Alerts <alerts@botzzz.local>');

  const recipientsRaw = process.env.ALERT_EMAIL_RECIPIENTS || notification.alertRecipients || '';
  const recipients = recipientsRaw
    .toString()
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const fallbackRecipients = [
    notification.smtpUsername,
    general.adminEmail,
    general.supportEmail,
    process.env.ADMIN_EMAIL,
    process.env.ADMIN_OTP_EMAIL,
    process.env.SMTP_USER
  ].filter(v => v && String(v).includes('@'));

  return {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    recipients: recipients.length ? recipients : fallbackRecipients
  };
}

async function sendAlertEmail({ subject, html, text }) {
  const enabled = getEnvFlag('ALERT_EMAIL_ENABLED', false);
  if (!enabled) {
    console.warn('[alert-email] alerts disabled (ALERT_EMAIL_ENABLED=false)');
    return { sent: false, reason: 'alerts disabled' };
  }

  const cfg = await resolveEmailConfig();
  const recipients = cfg.recipients || [];
  if (!recipients.length) {
    console.warn('[alert-email] no recipients resolved (check ALERT_EMAIL_RECIPIENTS or notification settings)');
    return { sent: false, reason: 'no recipients' };
  }

  console.log('[alert-email] sending', {
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    from: cfg.SMTP_FROM,
    recipientsCount: recipients.length
  });

  const transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_PORT === 465,
    auth: cfg.SMTP_USER && cfg.SMTP_PASS ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined
  });

  try {
    const info = await transporter.sendMail({
      from: cfg.SMTP_FROM,
      to: recipients,
      subject: subject || 'BOTZZZ773 Alert',
      html: html || (text ? `<pre>${String(text)}</pre>` : '<p>Alert</p>'),
      text: text || (html ? String(html).replace(/<[^>]+>/g, ' ') : 'Alert')
    });
    return { sent: true, id: info && info.messageId, to: recipients };
  } catch (e) {
    console.error('[alert-email] Send failed:', e && e.message ? e.message : String(e));
    return { sent: false, error: e && e.message ? e.message : String(e) };
  }
}

module.exports = {
  sendAlertEmail
};
