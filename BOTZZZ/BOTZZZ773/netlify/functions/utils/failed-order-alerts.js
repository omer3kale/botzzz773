const axios = require('axios');
const { supabaseAdmin } = require('./supabase');
const { createLogger, serializeError } = require('./logger');
const { logFailedOrderNotification } = require('../notification-logger');

const logger = createLogger('failed-order-alerts');

async function loadTelegramSettings() {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .eq('key', 'notification');

    if (error || !data || data.length === 0) return null;

    const row = data[0];
    const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const token = parsed?.telegramBotToken || parsed?.telegram_bot_token;
    const chatId = parsed?.telegramChatId || parsed?.telegram_chat_id;

    if (!token || !chatId) return null;
    return { token, chatId };
  } catch (err) {
    logger.warn('[TELEGRAM] Error loading settings', { error: serializeError(err) });
    return null;
  }
}

async function sendTelegramAlert(message) {
  const telegramSettings = await loadTelegramSettings();
  if (!telegramSettings) return false;

  try {
    const url = `https://api.telegram.org/bot${telegramSettings.token}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: telegramSettings.chatId,
      text: message,
      parse_mode: 'HTML'
    }, { timeout: 10000 });

    if (response.data.ok) {
      logger.info('[TELEGRAM] Message sent', { messageId: response.data.result?.message_id });
      return true;
    }
    return false;
  } catch (err) {
    logger.error('[TELEGRAM] Exception', { error: err.message });
    return false;
  }
}

async function sendFailedOrdersAlert(failedOrders) {
  if (!failedOrders || failedOrders.length === 0) return;

  try {
    const nodemailer = require('nodemailer');

    // STEP 1: Filter for NEW failures only (alerted_at IS NULL)
    const newFailures = failedOrders.filter(o => !o.alerted_at);
    const newOrderIds = newFailures.map(o => o.id);

    if (newOrderIds.length > 0) {
      try {
        const alertTimestamp = new Date().toISOString();
        logger.info('[DEDUP] Marking orders as alerted', { count: newOrderIds.length, timestamp: alertTimestamp });

        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('orders')
          .update({ alerted_at: alertTimestamp })
          .in('id', newOrderIds)
          .is('alerted_at', null)
          .select('id, alerted_at');

        if (updateError) {
          logger.error('[DEDUP] Failed to mark orders', { error: updateError.message });
          return;
        }
        logger.info('[DEDUP] Marked orders', { updated: updateData?.length || 0 });
      } catch (err) {
        logger.error('[DEDUP] Exception marking orders', { error: err.message });
        return;
      }
    } else {
      logger.info('[DEDUP] No new failures to alert');
      return;
    }

    // STEP 2: Load SMTP settings
    const { data: smtpData, error: smtpError } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'notification')
      .single();

    if (smtpError || !smtpData) {
      logger.warn('SMTP settings not found');
      return;
    }

    const notification = typeof smtpData.value === 'string' ? JSON.parse(smtpData.value) : smtpData.value;
    const SMTP_HOST = notification?.smtpHost || process.env.SMTP_HOST;
    const SMTP_PORT = Number(notification?.smtpPort || process.env.SMTP_PORT || 587);
    const SMTP_USER = notification?.smtpUser || notification?.smtpUsername || process.env.SMTP_USER;
    const SMTP_PASS = notification?.smtpPass || notification?.smtpPassword || process.env.SMTP_PASS;
    const SMTP_FROM = notification?.smtpFromAddress || notification?.smtpFrom || process.env.SMTP_FROM || 'noreply@botzzz773.com';

    if (!SMTP_HOST) {
      logger.warn('SMTP host not configured');
      return;
    }

    const isLocalhost = SMTP_HOST.toLowerCase().includes('localhost') || SMTP_HOST === '127.0.0.1';
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: isLocalhost ? false : (SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined),
      connectionTimeout: 5000,
      socketTimeout: 5000
    });

    let adminEmail = process.env.ADMIN_EMAIL || 'admin@botzzz773.com';
    try {
      const { data: generalData } = await supabaseAdmin.from('settings').select('value').eq('key', 'general').single();
      if (generalData) {
        const general = typeof generalData.value === 'string' ? JSON.parse(generalData.value) : generalData.value;
        if (general?.adminEmail) adminEmail = general.adminEmail;
      }
    } catch (err) { /* use default */ }

    const ordersLimit = failedOrders.slice(0, 10);
    let ordersTable = `
<table style="border-collapse: collapse; width: 100%; font-size: 13px;">
  <tr style="background: #1e2030;">
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: left; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Order</th>
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: left; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">User</th>
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: left; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Service</th>
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: center; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Qty</th>
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: right; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">IN</th>
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: right; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">OUT</th>
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: left; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Provider</th>
    <th style="padding: 10px 14px; border-bottom: 2px solid #2a2d3e; text-align: left; color: #8b8fa3; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Reason</th>
  </tr>`;

    ordersLimit.forEach((order, idx) => {
      const bgColor = idx % 2 === 0 ? '#161822' : '#1a1c2e';
      const orderNum = order.order_number || order.id?.substring(0, 8) || 'N/A';
      const userName = order.username || order.user_name || 'N/A';
      const serviceLabel = order.servicePublicId && order.servicePublicId !== 'N/A'
        ? `<span style="color: #e2e4ed;">${order.servicePublicId}</span><br><span style="color: #6b6f85; font-size: 11px;">${order.serviceName || 'Unknown'}</span>`
        : `<span style="color: #e2e4ed;">${order.serviceName || 'N/A'}</span>`;
      const inAmount = order.charge ? `$${order.charge.toFixed(2)}` : 'N/A';
      const outAmount = order.provider_cost ? `$${order.provider_cost.toFixed(2)}` : 'N/A';
      const providerLabel = order.providerName
        ? `<span style="color: #e2e4ed;">${order.providerName}</span><br><span style="color: #6b6f85; font-size: 11px;">${order.provider_order_id || ''}</span>`
        : 'N/A';
      ordersTable += `
  <tr style="background-color: ${bgColor};">
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030; color: #818cf8; font-weight: 600;">${orderNum}</td>
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030; color: #c4c7d6;">${userName}</td>
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030;">${serviceLabel}</td>
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030; text-align: center; color: #c4c7d6;">${order.quantity || '0'}</td>
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030; text-align: right; color: #34d399; font-weight: 600;">${inAmount}</td>
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030; text-align: right; color: #f87171; font-weight: 600;">${outAmount}</td>
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030;">${providerLabel}</td>
    <td style="padding: 10px 14px; border-bottom: 1px solid #1e2030; font-size: 12px; color: #8b8fa3; max-width: 200px;">${order.failureReason ? order.failureReason.substring(0, 80) : 'No reason provided'}</td>
  </tr>`;
    });
    ordersTable += '</table>';

    const emailSubject = `❌ ${ordersLimit.length} Failed Order${ordersLimit.length > 1 ? 's' : ''} - Action Required`;
    const emailBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 900px; margin: 0 auto; background-color: #0f1117; border-radius: 12px; overflow: hidden;">
  <div style="background: #0f1117; padding: 32px 32px 24px; text-align: center; border-bottom: 1px solid #1e2030;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.05em; color: #818cf8;">BOTZZZ<span style="color: #e2e4ed;">773</span></h1>
  </div>
  <div style="padding: 24px 32px 16px; text-align: center;">
    <div style="display: inline-block; background: rgba(239, 68, 68, 0.12); color: #f87171; padding: 10px 24px; border-radius: 20px; font-size: 14px; font-weight: 600; border: 1px solid rgba(239, 68, 68, 0.2);">
      ❌ ${ordersLimit.length} Failed Order${ordersLimit.length > 1 ? 's' : ''}
    </div>
  </div>
  <div style="padding: 16px 32px 32px; color: #c4c7d6;">
    <div style="background: #161822; border-left: 3px solid #ef4444; padding: 16px 20px; border-radius: 0 8px 8px 0; margin: 0 0 24px 0;">
      <p style="margin: 0; color: #f87171; font-size: 14px; font-weight: 600;">
        ${ordersLimit.length} order${ordersLimit.length > 1 ? 's have' : ' has'} failed and require attention.
      </p>
    </div>
    <div style="background: #161822; border-radius: 8px; overflow: hidden; margin-bottom: 24px;">
      ${ordersTable}
    </div>
    <div style="padding: 16px 20px; background: #161822; border: 1px solid #1e2030; border-radius: 8px;">
      <p style="margin: 0 0 10px 0; color: #818cf8; font-size: 13px; font-weight: 600;">Recommended Actions</p>
      <ol style="margin: 0; padding-left: 18px; color: #8b8fa3; font-size: 13px; line-height: 1.8;">
        <li>Review failed orders in admin dashboard</li>
        <li>Contact affected providers if needed</li>
        <li>Issue refunds or retry orders</li>
      </ol>
    </div>
    <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #1e2030; text-align: center; font-size: 11px; color: #4a4e63;">
      <p style="margin: 0 0 4px 0;"><span style="color: #818cf8;">BOTZZZ773</span> · Automated Alert</p>
      <p style="margin: 0;">${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC</p>
    </div>
  </div>
</div>`.trim();

    const result = await transporter.sendMail({
      from: SMTP_FROM,
      to: adminEmail,
      subject: emailSubject,
      html: emailBody
    });

    logger.info('Failed orders alert email sent', { ordersCount: ordersLimit.length, messageId: result.messageId });

    // Send Telegram alert
    const telegramLines = ordersLimit.map(order => {
      const orderNum = order.order_number || order.id?.substring(0, 8) || '?';
      const providerName = order.providerName || 'N/A';
      const userName = order.username || order.user_name || 'N/A';
      const serviceLabel = order.servicePublicId && order.servicePublicId !== 'N/A'
        ? `${order.servicePublicId} · ${order.serviceName || 'Unknown'}`
        : (order.serviceName || 'Unknown');
      const inAmount = order.charge ? `$${order.charge.toFixed(2)}` : 'N/A';
      const outAmount = order.provider_cost ? `$${order.provider_cost.toFixed(2)}` : 'N/A';
      const reason = order.failureReason ? order.failureReason.substring(0, 60) : 'No reason';
      return `<b>${orderNum}</b> · ${userName}\n${serviceLabel}\nIN: ${inAmount} | OUT: ${outAmount}\n${providerName}: ${reason}`;
    });
    const telegramMessage = telegramLines.join('\n\n');
    await sendTelegramAlert(`❌ <b>FAILED ORDER ALERT</b> (${ordersLimit.length})\n\n${telegramMessage}\n\n<i>Check admin dashboard immediately</i>`);

    // Log notifications
    for (const order of failedOrders) {
      try {
        await logFailedOrderNotification(order, order.providerName || 'Unknown', order.serviceName || 'Unknown', order.failureReason || 'Unknown error');
      } catch (err) { /* non-critical */ }
    }

  } catch (err) {
    logger.warn('Failed to send failed orders alert', { error: serializeError(err), ordersCount: failedOrders?.length || 0 });
  }
}

module.exports = { sendFailedOrdersAlert, sendTelegramAlert };
