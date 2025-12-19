const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { supabaseAdmin } = require('./utils/supabase');

const JWT_SECRET = process.env.JWT_SECRET;

function getUserFromToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

function normalizeSettingValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                return JSON.parse(trimmed);
            } catch {
                return value;
            }
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
            console.warn('[Notifications] Settings fetch error, using env defaults:', error.message || error);
            return {};
        }

        const map = {};
        (data || []).forEach(row => {
            map[row.key] = normalizeSettingValue(row.value);
        });
        return map;
    } catch (err) {
        console.warn('[Notifications] Settings fetch exception, using env defaults:', err.message || err);
        return {};
    }
}

async function sendTestEmail({ to, subject, html, text }, settingsMap) {
    const notification = settingsMap.notification || {};
    const general = settingsMap.general || {};

    const SMTP_HOST = notification.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com';
    const SMTP_PORT = Number(notification.smtpPort || process.env.SMTP_PORT || 587);
    const SMTP_USER = notification.smtpUsername || process.env.SMTP_USER || '';
    const SMTP_PASS = notification.smtpPassword || process.env.SMTP_PASS || '';
    const SMTP_FROM = notification.smtpFrom || process.env.ALERT_EMAIL_FROM || (SMTP_USER ? `BOTZZZ773 <${SMTP_USER}>` : 'BOTZZZ773 <noreply@botzzz.local>');

    const normalizeEmail = (val) => {
        const s = (val || '').toString().trim();
        return s && s.includes('@') ? s : '';
    };

    let recipient = normalizeEmail(to)
        || normalizeEmail(notification.smtpUsername)
        || normalizeEmail(general.adminEmail)
        || normalizeEmail(general.supportEmail)
        || normalizeEmail(process.env.ADMIN_OTP_EMAIL)
        || normalizeEmail(process.env.ADMIN_EMAIL)
        || normalizeEmail(SMTP_USER);

    if (!recipient) {
        throw new Error('No recipient configured. Enter Test Recipient or set Admin/Support email or SMTP_USER.');
    }

    const isLocalhost = SMTP_HOST === 'localhost' || SMTP_HOST === '127.0.0.1';
    
    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: (!isLocalhost && SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    });

    const info = await transporter.sendMail({
        from: SMTP_FROM,
        to: recipient,
        subject: subject || 'BOTZZZ773 Test Email',
        text: text || 'This is a test email from BOTZZZ773 notifications.',
        html: html || '<p>This is a <b>test email</b> from BOTZZZ773 notifications.</p>'
    });

    return { messageId: info && info.messageId, to: recipient };
}

async function sendTestTelegram({ chatId, text }, settingsMap) {
    const integrations = settingsMap.integrations || {};

    const token = integrations.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
    const chat_id = chatId || integrations.telegramChatId || process.env.TELEGRAM_CHAT_ID;

    if (!token) throw new Error('Telegram bot token not configured');
    if (!chat_id) throw new Error('Telegram chat ID not configured');

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = { chat_id, text: text || 'BOTZZZ773 test message ✅' };

    const { data } = await axios.post(url, payload, { timeout: 10000 });

    if (!data || data.ok !== true) {
        throw new Error('Telegram API error: ' + JSON.stringify(data));
    }

    return { ok: true, chat_id, message_id: data.result && data.result.message_id };
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const user = getUserFromToken(event.headers.authorization);
    if (!user || user.role !== 'admin') {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const action = body.action;
        const settingsMap = await loadSettings();

        if (action === 'send-test-email') {
            const result = await sendTestEmail({ to: body.to, subject: body.subject, html: body.html, text: body.text }, settingsMap);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, result }) };
        }

        if (action === 'send-test-telegram') {
            const result = await sendTestTelegram({ chatId: body.chatId, text: body.text }, settingsMap);
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, result }) };
        }

        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    } catch (error) {
        console.error('[Notifications] Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'Internal error' }) };
    }
};
