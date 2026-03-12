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
<table style="border-collapse: collapse; width: 100%; font-size: 12px; background: #000;">
  <tr style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 100%); color: white;">
    <th style="padding: 12px; border: 1px solid #333; text-align: left;">Order #</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left;">Provider</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left;">Username</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left;">Service</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: center;">Qty</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: right;">Charge</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left;">Reason</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left;">Status</th>
  </tr>`;

    ordersLimit.forEach((order, idx) => {
      const bgColor = idx % 2 === 0 ? '#1a1a1a' : '#0a0a0a';
      ordersTable += `
  <tr style="background-color: ${bgColor};">
    <td style="padding: 12px; border: 1px solid #333; color: #FF1494;"><strong>#${order.order_number || order.id.substring(0, 8)}</strong></td>
    <td style="padding: 12px; border: 1px solid #333;"><strong style="color: #FFF;">${order.providerName || 'N/A'}</strong><br><small style="color: #B0B0B0;">ID: ${order.provider_order_id || 'N/A'}</small></td>
    <td style="padding: 12px; border: 1px solid #333; color: #E0E0E0;">${order.username || 'N/A'}</td>
    <td style="padding: 12px; border: 1px solid #333;"><strong style="color: #FFF;">${order.serviceName || 'N/A'}</strong><br><small style="color: #B0B0B0;">${order.servicePublicId || 'N/A'}</small></td>
    <td style="padding: 12px; border: 1px solid #333; text-align: center; color: #FF69B4;"><strong>${order.quantity || '0'}</strong></td>
    <td style="padding: 12px; border: 1px solid #333; text-align: right; color: #FF1494;"><strong>$${order.charge ? order.charge.toFixed(2) : '0.00'}</strong></td>
    <td style="padding: 12px; border: 1px solid #333; font-size: 11px; color: #B0B0B0; max-width: 200px;">${order.failureReason ? order.failureReason.substring(0, 60) : 'No reason provided'}</td>
    <td style="padding: 12px; border: 1px solid #333;"><span style="background-color: #FF1494; color: #000; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${order.status.toUpperCase()}</span></td>
  </tr>`;
    });
    ordersTable += '</table>';

    const emailSubject = `❌ ${ordersLimit.length} Failed Order${ordersLimit.length > 1 ? 's' : ''} Alert - Immediate Action Required`;
    const emailBody = `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 900px; margin: 0 auto; background-color: #0a0a0a;">
  <div style="background: linear-gradient(135deg, #FF1494 0%, #FF69B4 100%); color: white; padding: 30px 20px; text-align: center;">
    <h1 style="margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 2px;">BOTZZZ773</h1>
    <p style="margin: 10px 0 0 0; font-size: 12px; opacity: 0.9;">SMM PANEL MANAGEMENT</p>
  </div>
  <div style="background-color: #121212; padding: 20px; text-align: center; border-bottom: 2px solid #FF1494;">
    <div style="display: inline-block; background-color: #FF1494; color: white; padding: 12px 20px; border-radius: 6px; font-size: 18px; font-weight: bold;">
      ❌ ${ordersLimit.length} FAILED ORDER${ordersLimit.length > 1 ? 'S' : ''}
    </div>
  </div>
  <div style="background-color: #0a0a0a; padding: 30px 20px; color: #E0E0E0;">
    <p style="margin: 0 0 20px 0; font-size: 16px; color: #FFF;">Dear Admin,</p>
    <div style="background-color: #1a1a1a; border-left: 4px solid #FF1494; padding: 20px; border-radius: 6px; margin: 0 0 25px 0;">
      <p style="margin: 0; color: #FF1494; font-size: 18px; font-weight: bold;">
        🚨 URGENT: ${ordersLimit.length} order${ordersLimit.length > 1 ? 's have' : ' has'} failed and require immediate attention!
      </p>
    </div>
    <h3 style="color: #FF1494; margin: 20px 0 15px 0; border-bottom: 2px solid #FF1494; padding-bottom: 10px;">Failed Orders Details</h3>
    ${ordersTable}
    <div style="margin-top: 25px; padding: 20px; background: rgba(255,20,148,0.1); border: 1px solid #FF1494; border-radius: 6px;">
      <h4 style="margin: 0 0 12px 0; color: #FF1494;">RECOMMENDED ACTIONS:</h4>
      <ol style="margin: 0; padding-left: 20px; color: #B0B0B0; font-size: 13px; line-height: 1.8;">
        <li>Review failed orders in your admin dashboard immediately</li>
        <li>Contact affected providers for root cause analysis</li>
        <li>Issue refunds to customers if order cannot be fulfilled</li>
        <li>Update order status once resolved</li>
      </ol>
    </div>
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333; text-align: center; font-size: 11px; color: #666;">
      <p style="margin: 0 0 8px 0;"><strong style="color: #FF1494;">BOTZZZ773</strong> | Automated Alert System</p>
      <p style="margin: 0;">Generated: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC</p>
    </div>
  </div>
  <div style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 50%, #FF1494 100%); height: 3px;"></div>
</div>`.trim();

    const result = await transporter.sendMail({
      from: SMTP_FROM,
      to: adminEmail,
      subject: emailSubject,
      html: emailBody
    });

    logger.info('Failed orders alert email sent', { ordersCount: ordersLimit.length, messageId: result.messageId });

    // Send Telegram alert
    const telegramMessage = ordersLimit
      .map(order => `<b>#${order.order_number}</b> - ${order.providerName} (${order.username}) - $${order.charge?.toFixed(2) || '0.00'}`)
      .join('\n');
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
