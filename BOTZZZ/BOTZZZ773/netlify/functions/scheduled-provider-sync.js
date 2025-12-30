const axios = require('axios');
const { supabaseAdmin } = require('./utils/supabase');
const { createLogger, serializeError } = require('./utils/logger');
const { performOrderStatusSync } = require('./orders');
const { convertToUSD } = require('./utils/currency-converter');
const { logLowBalanceNotification, logFailedOrderNotification } = require('./notification-logger');

const logger = createLogger('provider-automation');
const DEFAULT_ORDER_SYNC_LIMIT = Number(process.env.PROVIDER_AUTOMATION_ORDER_LIMIT || 75);

function parseLimit(rawValue, fallback) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.trunc(numeric), 500);
}

async function loadAlertSettings() {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .eq('key', 'notification');
    
    if (error) {
      logger.warn('Failed to load notification settings', { error: serializeError(error) });
      return {
        providerLowBalanceAlertEnabled: true,
        providerLowBalanceThreshold: 0.5
      };
    }
    
    if (!data || data.length === 0) {
      return {
        providerLowBalanceAlertEnabled: true,
        providerLowBalanceThreshold: 0.5
      };
    }
    
    const notification = typeof data[0].value === 'string' ? JSON.parse(data[0].value) : data[0].value;
    return {
      providerLowBalanceAlertEnabled: notification?.providerLowBalanceAlertEnabled !== false,
      providerLowBalanceThreshold: Number(notification?.providerLowBalanceThreshold || 0.5)
    };
  } catch (err) {
    logger.warn('Error loading alert settings', { error: serializeError(err) });
    return {
      providerLowBalanceAlertEnabled: true,
      providerLowBalanceThreshold: 0.5
    };
  }
}

// Load Telegram settings
async function loadTelegramSettings() {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('key, value')
      .eq('key', 'integrations');
    
    if (error || !data || !data[0]) {
      logger.warn('[TELEGRAM] Settings not found');
      return null;
    }
    
    const integrations = typeof data[0].value === 'string' ? JSON.parse(data[0].value) : data[0].value;
    const token = integrations?.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = integrations?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    
    if (!token || !chatId) {
      logger.warn('[TELEGRAM] Token or Chat ID not configured');
      return null;
    }
    
    return { token, chatId };
  } catch (err) {
    logger.warn('[TELEGRAM] Error loading settings', { error: serializeError(err) });
    return null;
  }
}

// Send Telegram message
async function sendTelegramAlert(message) {
  const telegramSettings = await loadTelegramSettings();
  if (!telegramSettings) {
    logger.warn('[TELEGRAM] Skipping - settings not configured');
    return false;
  }
  
  try {
    const url = `https://api.telegram.org/bot${telegramSettings.token}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: telegramSettings.chatId,
      text: message,
      parse_mode: 'HTML'
    }, {
      timeout: 10000
    });
    
    if (response.data.ok) {
      logger.info('[TELEGRAM] ✅ Message sent', {
        messageId: response.data.result?.message_id,
        chatId: telegramSettings.chatId
      });
      return true;
    } else {
      logger.warn('[TELEGRAM] ❌ API error', {
        error: response.data.description
      });
      return false;
    }
  } catch (err) {
    logger.error('[TELEGRAM] Exception', {
      error: err.message
    });
    return false;
  }
}

async function sendFailedOrdersAlert(failedOrders) {
  if (!failedOrders || failedOrders.length === 0) {
    return;
  }

  try {
    const nodemailer = require('nodemailer');
    
    // STEP 1: Filter for NEW failures only (alerted_at IS NULL) - Prevent duplicates
    const newFailures = failedOrders.filter(o => !o.alerted_at);
    const newOrderIds = newFailures.map(o => o.id);
    
    if (newOrderIds.length > 0) {
      try {
        const alertTimestamp = new Date().toISOString();
        logger.info('[DEDUP] Marking NEW orders as alerted', {
          count: newOrderIds.length,
          timestamp: alertTimestamp,
          orderIds: newOrderIds.slice(0, 3) // Log first 3 for debugging
        });
        
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('orders')
          .update({ alerted_at: alertTimestamp })
          .in('id', newOrderIds)
          .is('alerted_at', null) // Only update if NOT already alerted (idempotency)
          .select('id, alerted_at');
        
        if (updateError) {
          logger.error('[DEDUP] ❌ FAILED TO MARK ORDERS - UPDATE ERROR', {
            error: updateError.message,
            code: updateError.code,
            status: updateError.status,
            hint: updateError.hint,
            ordersCount: newOrderIds.length
          });
          return; // Don't send email if marking failed
        } else {
          logger.info('[DEDUP] ✅ Successfully marked orders', {
            updated: updateData?.length || 0,
            sample: updateData?.slice(0, 2).map(o => ({ id: o.id, alerted_at: o.alerted_at }))
          });
        }
      } catch (err) {
        logger.error('[DEDUP] Exception while marking orders', {
          error: err.message,
          stack: err.stack?.split('\n')[0],
          ordersCount: newOrderIds.length
        });
        return; // Don't send email if exception occurred
      }
    } else {
      logger.info('[DEDUP] No new failures to alert - all already marked or no failed orders');
      return; // No new failures, don't send email
    }
    
    // STEP 2: Load SMTP settings
    const { data: smtpData, error: smtpError } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'notification')
      .single();
    
    if (smtpError || !smtpData) {
      logger.warn('SMTP settings not found for failed orders alert');
      return;
    }
    
    const notification = typeof smtpData.value === 'string' 
      ? JSON.parse(smtpData.value) 
      : smtpData.value;
    
    const SMTP_HOST = notification?.smtpHost || process.env.SMTP_HOST;
    const SMTP_PORT = Number(notification?.smtpPort || process.env.SMTP_PORT || 587);
    const SMTP_USER = notification?.smtpUser || notification?.smtpUsername || process.env.SMTP_USER;
    const SMTP_PASS = notification?.smtpPass || notification?.smtpPassword || process.env.SMTP_PASS;
    const SMTP_FROM = notification?.smtpFromAddress || notification?.smtpFrom || process.env.SMTP_FROM || 'noreply@botzzz773.com';
    
    if (!SMTP_HOST) {
      logger.warn('SMTP host not configured for failed orders alert');
      return;
    }
    
    const isLocalhost = SMTP_HOST.toLowerCase().includes('localhost') || SMTP_HOST === '127.0.0.1';
    const transportConfig = {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: isLocalhost ? false : (SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined),
      connectionTimeout: 5000,
      socketTimeout: 5000
    };
    
    const transporter = nodemailer.createTransport(transportConfig);
    
    // Get admin email from general settings or fallback
    let adminEmail = process.env.ADMIN_EMAIL || 'admin@botzzz773.com';
    try {
      const { data: generalData } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'general')
        .single();
      
      if (generalData) {
        const general = typeof generalData.value === 'string' 
          ? JSON.parse(generalData.value) 
          : generalData.value;
        if (general?.adminEmail) {
          adminEmail = general.adminEmail;
        }
      }
    } catch (err) {
      logger.warn('Could not load admin email from settings', { error: serializeError(err) });
    }

    // Build HTML table with failed orders
    const ordersLimit = failedOrders.slice(0, 10);
    let ordersTable = `
<table style="border-collapse: collapse; width: 100%; font-size: 12px; background: #000;">
  <tr style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 100%); color: white;">
    <th style="padding: 12px; border: 1px solid #333; text-align: left; font-weight: bold;">Order #</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left; font-weight: bold;">Provider</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left; font-weight: bold;">Username</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left; font-weight: bold;">Service</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: center; font-weight: bold;">Qty</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: right; font-weight: bold;">Charge</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left; font-weight: bold;">Reason</th>
    <th style="padding: 12px; border: 1px solid #333; text-align: left; font-weight: bold;">Status</th>
  </tr>
`;
    
    ordersLimit.forEach((order, idx) => {
      const bgColor = idx % 2 === 0 ? '#1a1a1a' : '#0a0a0a';
      ordersTable += `
  <tr style="background-color: ${bgColor};">
    <td style="padding: 12px; border: 1px solid #333; color: #FF1494;"><strong>#${order.order_number || order.id.substring(0, 8)}</strong></td>
    <td style="padding: 12px; border: 1px solid #333;">
      <strong style="color: #FFFFFF;">${order.providerName || 'N/A'}</strong><br>
      <small style="color: #B0B0B0;">ID: ${order.provider_order_id || 'N/A'}</small>
    </td>
    <td style="padding: 12px; border: 1px solid #333; color: #E0E0E0;">${order.username || 'N/A'}</td>
    <td style="padding: 12px; border: 1px solid #333;">
      <strong style="color: #FFFFFF;">${order.serviceName || 'N/A'}</strong><br>
      <small style="color: #B0B0B0;">${order.servicePublicId || 'N/A'}</small>
    </td>
    <td style="padding: 12px; border: 1px solid #333; text-align: center; color: #FF69B4;"><strong>${order.quantity || '0'}</strong></td>
    <td style="padding: 12px; border: 1px solid #333; text-align: right; color: #FF1494;"><strong>\$${order.charge ? order.charge.toFixed(2) : '0.00'}</strong></td>
    <td style="padding: 12px; border: 1px solid #333; font-size: 11px; color: #B0B0B0; max-width: 200px; word-wrap: break-word;">
      ${order.failureReason ? order.failureReason.substring(0, 60) : 'No reason provided'}
    </td>
    <td style="padding: 12px; border: 1px solid #333;"><span style="background-color: #FF1494; color: #000; padding: 4px 8px; border-radius: 4px; font-weight: bold;">${order.status.toUpperCase()}</span></td>
  </tr>
`;
    });
    
    ordersTable += '</table>';

    const emailSubject = `❌ ${ordersLimit.length} Failed Order${ordersLimit.length > 1 ? 's' : ''} Alert - Immediate Action Required`;
    const emailBody = `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 900px; margin: 0 auto; padding: 0; background-color: #0a0a0a;">
  <!-- Header -->
  <div style="background: linear-gradient(135deg, #FF1494 0%, #FF69B4 100%); color: white; padding: 30px 20px; text-align: center; border-radius: 0;">
    <h1 style="margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 2px;">BOTZZZ773</h1>
    <p style="margin: 10px 0 0 0; font-size: 12px; opacity: 0.9; letter-spacing: 1px;">SMM PANEL MANAGEMENT</p>
  </div>
  
  <!-- Alert Badge -->
  <div style="background-color: #121212; padding: 20px; text-align: center; border-bottom: 2px solid #FF1494;">
    <div style="display: inline-block; background-color: #FF1494; color: white; padding: 12px 20px; border-radius: 6px; font-size: 18px; font-weight: bold;">
      ❌ ${ordersLimit.length} FAILED ORDER${ordersLimit.length > 1 ? 'S' : ''}
    </div>
  </div>
  
  <!-- Content -->
  <div style="background-color: #0a0a0a; padding: 30px 20px; color: #E0E0E0;">
    <p style="margin: 0 0 20px 0; font-size: 16px; color: #FFFFFF;">
      Dear Admin,
    </p>
    
    <div style="background-color: #1a1a1a; border-left: 4px solid #FF1494; padding: 20px; border-radius: 6px; margin: 0 0 25px 0;">
      <p style="margin: 0; color: #FF1494; font-size: 18px; font-weight: bold;">
        🚨 URGENT: ${ordersLimit.length} order${ordersLimit.length > 1 ? 's have' : ' has'} failed and require immediate attention!
      </p>
    </div>
    
    <h3 style="color: #FF1494; margin: 20px 0 15px 0; border-bottom: 2px solid #FF1494; padding-bottom: 10px; font-size: 18px; font-weight: 700;">
      Failed Orders Details
    </h3>
    
    ${ordersTable}
    
    <!-- Action Steps -->
    <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, rgba(255, 20, 148, 0.1) 0%, rgba(255, 105, 180, 0.05) 100%); border: 1px solid #FF1494; border-radius: 6px;">
      <h4 style="margin: 0 0 12px 0; color: #FF1494; font-size: 14px; font-weight: 700;">RECOMMENDED ACTIONS:</h4>
      <ol style="margin: 0; padding-left: 20px; color: #B0B0B0; font-size: 13px; line-height: 1.8;">
        <li style="margin-bottom: 8px;">Review failed orders in your admin dashboard immediately</li>
        <li style="margin-bottom: 8px;">Contact affected providers for root cause analysis</li>
        <li style="margin-bottom: 8px;">Issue refunds to customers if order cannot be fulfilled</li>
        <li style="margin-bottom: 0;">Update order status once resolved</li>
      </ol>
    </div>
    
    <!-- Footer -->
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333; text-align: center; font-size: 11px; color: #666;">
      <p style="margin: 0 0 8px 0;">
        <strong style="color: #FF1494;">BOTZZZ773</strong> | Automated Alert System
      </p>
      <p style="margin: 0;">
        Generated: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
      </p>
      <p style="margin: 8px 0 0 0; font-size: 10px; color: #555;">
        This is an automated alert from BOTZZZ773 Provider Management System
      </p>
    </div>
  </div>
  
  <!-- Bottom Accent -->
  <div style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 50%, #FF1494 100%); height: 3px;"></div>
</div>
    `.trim();
    
    const result = await transporter.sendMail({
      from: SMTP_FROM,
      to: adminEmail,
      subject: emailSubject,
      html: emailBody
    });
    
    logger.info('✅ Failed orders alert email sent', {
      ordersCount: ordersLimit.length,
      messageId: result.messageId,
      adminEmail: adminEmail,
      timestamp: new Date().toISOString()
    });
    
    // SEND TELEGRAM ALERT
    const telegramMessage = ordersLimit
      .map(order => `<b>#${order.order_number}</b> - ${order.providerName} (${order.username}) - $${order.charge?.toFixed(2) || '0.00'}`)
      .join('\n');
    
    const telegramText = `❌ <b>FAILED ORDER ALERT</b> (${ordersLimit.length})
      
${telegramMessage}

<i>Check admin dashboard immediately</i>`;
    
    await sendTelegramAlert(telegramText);

    
    // Log notifications for each failed order
    for (const order of failedOrders) {
      try {
        await logFailedOrderNotification(
          order,
          order.provider_name || 'Unknown Provider',
          order.service_name || 'Unknown Service',
          order.failure_reason || 'Unknown error'
        );
      } catch (err) {
        logger.warn('Could not log failed order notification', {
          orderId: order.id,
          error: serializeError(err)
        });
      }
    }
    
  } catch (err) {
    logger.warn('Failed to send failed orders alert (non-critical)', {
      error: serializeError(err),
      ordersCount: failedOrders?.length || 0
    });
    // Don't rethrow - this is a non-critical alert
  }
}

async function refreshProviderBalances(providers) {
  let refreshed = 0;
  let attempted = 0;

  for (const provider of providers) {
    if (!provider.api_url || !provider.api_key) {
      continue;
    }

    attempted++;

    try {
      // Call provider API to get current balance
      const response = await axios.post(
        `${provider.api_url}/balance`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${provider.api_key}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      if (response.data && typeof response.data.balance !== 'undefined') {
        const newBalance = Number(response.data.balance);
        
        // Update provider balance in database
        const { error: updateError } = await supabaseAdmin
          .from('providers')
          .update({ balance: newBalance })
          .eq('id', provider.id);

        if (!updateError) {
          logger.info('Provider balance refreshed', {
            providerId: provider.id,
            balance: newBalance,
            currency: provider.currency
          });
          refreshed++;
        }
      }
    } catch (err) {
      // Silently skip if API doesn't support balance endpoint
      // Balance will be used from manual updates or webhook sync
    }
  }

  if (refreshed > 0) {
    logger.info('Provider balance refresh completed', { refreshed, attempted });
  }
}

async function sendBulkLowBalanceAlert(lowBalanceProviders, threshold) {
  if (!lowBalanceProviders || lowBalanceProviders.length === 0) {
    return;
  }

  try {
    const nodemailer = require('nodemailer');
    
    // Load SMTP settings
    const { data: smtpData, error: smtpError } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', 'notification')
      .single();
    
    if (smtpError || !smtpData) {
      logger.warn('SMTP settings not found for bulk low balance alert');
      return;
    }
    
    const notification = typeof smtpData.value === 'string' 
      ? JSON.parse(smtpData.value) 
      : smtpData.value;
    
    const SMTP_HOST = notification?.smtpHost || process.env.SMTP_HOST;
    const SMTP_PORT = Number(notification?.smtpPort || process.env.SMTP_PORT || 587);
    const SMTP_USER = notification?.smtpUser || notification?.smtpUsername || process.env.SMTP_USER;
    const SMTP_PASS = notification?.smtpPass || notification?.smtpPassword || process.env.SMTP_PASS;
    const SMTP_FROM = notification?.smtpFromAddress || notification?.smtpFrom || process.env.SMTP_FROM || 'noreply@botzzz773.com';
    
    // Get admin email from general settings or fallback
    let adminEmail = process.env.ADMIN_EMAIL || 'admin@botzzz773.com';
    
    try {
      const { data: generalData } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'general')
        .single();
      
      if (generalData) {
        const general = typeof generalData.value === 'string' 
          ? JSON.parse(generalData.value) 
          : generalData.value;
        if (general?.adminEmail) {
          adminEmail = general.adminEmail;
        }
      }
    } catch (err) {
      logger.warn('Could not load admin email from general settings', { error: serializeError(err) });
    }
    
    if (!SMTP_HOST || !SMTP_PORT || !SMTP_FROM || !adminEmail) {
      logger.warn('Incomplete SMTP configuration for bulk low balance alert');
      return;
    }
    
    const isLocalhost = SMTP_HOST.toLowerCase().includes('localhost') || SMTP_HOST === '127.0.0.1';
    
    const transportConfig = {
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: isLocalhost ? false : (SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined),
      connectionTimeout: 5000,
      socketTimeout: 5000
    };
    
    const transporter = nodemailer.createTransport(transportConfig);
    
    // Build table rows for all low balance providers
    const tableRows = lowBalanceProviders
      .map(provider => `
        <tr style="background: #1a1a1a; border-bottom: 1px solid #2a2a2a;">
          <td style="padding: 12px 15px; color: #E0E0E0; font-size: 13px; border-right: 1px solid #2a2a2a;">${provider.name}</td>
          <td style="padding: 12px 15px; color: #FF69B4; font-size: 13px; border-right: 1px solid #2a2a2a; font-weight: 600;">$${provider.balanceUSD.toFixed(2)}</td>
          <td style="padding: 12px 15px; color: #FF1494; font-size: 13px; border-right: 1px solid #2a2a2a; font-weight: 700;">$${threshold.toFixed(2)}</td>
          <td style="padding: 12px 15px; color: #FF6B6B; font-size: 13px;">Insufficient</td>
        </tr>
      `)
      .join('');
    
    const emailSubject = `🔔 Provider Low Balance Alert - ${lowBalanceProviders.length} Provider(s)`;
    
    const emailBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #0a0a0a; padding: 0; margin: 0;">
  <!-- Top Accent -->
  <div style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 50%, #FF1494 100%); height: 3px;"></div>
  
  <div style="background: #0a0a0a; padding: 30px 20px; color: #E0E0E0; max-width: 700px; margin: 0 auto;">
    
    <!-- Header with Gradient -->
    <div style="background: linear-gradient(135deg, #FF1494 0%, #FF69B4 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
      <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 800;">⚠️ PROVIDER LOW BALANCE</h1>
      <p style="margin: 8px 0 0 0; color: #F0F0F0; font-size: 14px; font-weight: 500;">Bulk Alert - ${lowBalanceProviders.length} Provider(s) Below Threshold</p>
    </div>
    
    <!-- Summary -->
    <div style="background: #1a1a1a; padding: 20px; border-bottom: 1px solid #333;">
      <p style="margin: 0 0 8px 0; color: #FF1494; font-size: 13px; font-weight: 700;">⚡ ALERT SUMMARY</p>
      <p style="margin: 0; color: #B0B0B0; font-size: 13px; line-height: 1.6;">
        <strong style="color: #E0E0E0;">${lowBalanceProviders.length}</strong> provider(s) have balances below the threshold of <strong style="color: #FF1494;">$${threshold.toFixed(2)}</strong>. Immediate action required to prevent service interruptions.
      </p>
    </div>
    
    <!-- Providers Table -->
    <table style="width: 100%; border-collapse: collapse; background: #0a0a0a; margin: 20px 0;">
      <thead>
        <tr style="background: #FF1494; color: #FFFFFF;">
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">PROVIDER NAME</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">CURRENT BALANCE</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">THRESHOLD</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700;">STATUS</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    
    <!-- Action Steps -->
    <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, rgba(255, 20, 148, 0.1) 0%, rgba(255, 105, 180, 0.05) 100%); border: 1px solid #FF1494; border-radius: 6px;">
      <h4 style="margin: 0 0 12px 0; color: #FF1494; font-size: 14px; font-weight: 700;">REQUIRED ACTIONS:</h4>
      <ol style="margin: 0; padding-left: 20px; color: #B0B0B0; font-size: 13px; line-height: 1.8;">
        <li style="margin-bottom: 8px;">Review all providers listed above immediately</li>
        <li style="margin-bottom: 8px;">Add funds to each provider account with insufficient balance</li>
        <li style="margin-bottom: 8px;">Verify payment status in your dashboard</li>
        <li style="margin-bottom: 0;">Monitor provider status for service continuity</li>
      </ol>
    </div>
    
    <!-- Footer -->
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333; text-align: center; font-size: 11px; color: #666;">
      <p style="margin: 0 0 8px 0;">
        <strong style="color: #FF1494;">BOTZZZ773</strong> | Automated Alert System
      </p>
      <p style="margin: 0;">
        Generated: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC
      </p>
    </div>
  </div>
  
  <!-- Bottom Accent -->
  <div style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 50%, #FF1494 100%); height: 3px;"></div>
</div>
    `.trim();
    
    const result = await transporter.sendMail({
      from: SMTP_FROM,
      to: adminEmail,
      subject: emailSubject,
      html: emailBody
    });
    
    logger.info('Bulk low balance alert email sent', {
      providerCount: lowBalanceProviders.length,
      messageId: result.messageId
    });
    
    // SEND TELEGRAM ALERT
    const telegramMessage = lowBalanceProviders
      .map(p => `<b>${p.name}</b> - $${p.balanceUSD.toFixed(2)} (threshold: $${threshold.toFixed(2)})`)
      .join('\n');
    
    const telegramText = `⚠️ <b>LOW BALANCE ALERT</b> (${lowBalanceProviders.length})
      
${telegramMessage}

<i>Add funds immediately to prevent service interruptions</i>`;
    
    await sendTelegramAlert(telegramText);
    
    // Log notifications for each provider
    for (const provider of lowBalanceProviders) {
      try {
        await logLowBalanceNotification(provider.name, provider.balanceUSD, threshold);
      } catch (err) {
        logger.warn('Could not log low balance notification', {
          provider: provider.name,
          error: serializeError(err)
        });
      }
    }
    
    return true;
  } catch (err) {
    logger.error('Failed to send bulk low balance alert', {
      error: serializeError(err)
    });
    return false;
  }
}

async function checkProviderBalances(providers, alertSettings) {
  if (!alertSettings.providerLowBalanceAlertEnabled) {
    logger.info('Provider balance alerts disabled');
    return;
  }
  const threshold = alertSettings.providerLowBalanceThreshold;
  
  // STEP 1: Find ALL current low balance providers
  const lowBalanceProviders = [];
  const lowBalanceProviderIds = new Set();
  
  for (const provider of providers) {
    try {
      // Convert provider balance to USD if needed
      let balanceUSD = Number(provider.balance || 0);
      
      if (provider.currency && provider.currency.toUpperCase() !== 'USD') {
        try {
          balanceUSD = await convertToUSD(balanceUSD, provider.currency);
        } catch (err) {
          logger.warn('Currency conversion failed, using original balance', {
            providerId: provider.id,
            currency: provider.currency
          });
        }
      }
      
      if (balanceUSD < threshold) {
        lowBalanceProviders.push({ ...provider, balanceUSD });
        lowBalanceProviderIds.add(provider.id);
      }
    } catch (err) {
      logger.warn('Error checking provider balance', {
        providerId: provider.id,
        error: serializeError(err)
      });
    }
  }
  
  // STEP 2: Find which providers are NEWLY low balance (not in alerts table)
  let newlyLowProviders = [];
  if (lowBalanceProviders.length > 0) {
    try {
      const { data: recentAlerts } = await supabaseAdmin
        .from('provider_balance_alerts')
        .select('provider_id')
        .in('provider_id', Array.from(lowBalanceProviderIds));
      
      const alertedProviderIds = new Set(recentAlerts?.map(a => a.provider_id) || []);
      
      newlyLowProviders = lowBalanceProviders.filter(p => !alertedProviderIds.has(p.id));
      
      logger.info('[LOW-BALANCE] Status check', {
        totalLowBalance: lowBalanceProviders.length,
        newlyLow: newlyLowProviders.length,
        alreadyAlerted: alertedProviderIds.size
      });
    } catch (err) {
      logger.warn('[LOW-BALANCE] Could not check recent alerts', { error: serializeError(err) });
      newlyLowProviders = lowBalanceProviders; // Default: treat all as new
    }
  }
  
  // STEP 3: Mark NEWLY low balance providers
  if (newlyLowProviders.length > 0) {
    try {
      const alertRecords = newlyLowProviders.map(provider => ({
        provider_id: provider.id,
        balance_usd: provider.balanceUSD,
        threshold_usd: threshold,
        alert_type: 'low_balance',
        created_at: new Date().toISOString()
      }));
      
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('provider_balance_alerts')
        .upsert(alertRecords, { onConflict: 'provider_id' })
        .select('provider_id, balance_usd');
      
      if (insertError) {
        logger.error('[LOW-BALANCE] ❌ Failed to mark new low balance alerts', {
          error: insertError.message,
          code: insertError.code,
          count: newlyLowProviders.length
        });
      } else {
        logger.info('[LOW-BALANCE] ✅ Marked/Updated low balance providers (deduplicated)', {
          count: inserted?.length || 0,
          providers: inserted?.map(r => ({ id: r.provider_id, balance: r.balance_usd }))
        });
      }
    } catch (err) {
      logger.error('[LOW-BALANCE] Exception marking new alerts', {
        error: err.message,
        count: newlyLowProviders.length
      });
    }
  }
  
  // STEP 4: Clear alerts for providers that recovered (balance >= threshold)
  try {
    const recoveredProviderIds = Array.from(providers)
      .filter(p => {
        let balanceUSD = Number(p.balance || 0);
        if (p.currency && p.currency.toUpperCase() !== 'USD') {
          // Simple estimate if we can't convert
          balanceUSD = balanceUSD; // Keep as is
        }
        return balanceUSD >= threshold;
      })
      .map(p => p.id);
    
    if (recoveredProviderIds.length > 0) {
      const { data: deleted, error: deleteError } = await supabaseAdmin
        .from('provider_balance_alerts')
        .delete()
        .in('provider_id', recoveredProviderIds)
        .select('provider_id');
      
      if (!deleteError && deleted && deleted.length > 0) {
        logger.info('[LOW-BALANCE] ✅ Cleared alerts for recovered providers', {
          count: deleted.length,
          providers: deleted.map(r => r.provider_id)
        });
      }
    }
  } catch (err) {
    logger.warn('[LOW-BALANCE] Could not clear recovered provider alerts', {
      error: err.message
    });
  }
  
  // STEP 5: Send email with ALL currently low balance providers
  if (lowBalanceProviders.length > 0) {
    const sent = await sendBulkLowBalanceAlert(lowBalanceProviders, threshold);
    
    if (!sent) {
      logger.warn('[LOW-BALANCE] Email not sent', {
        providerCount: lowBalanceProviders.length
      });
    }
  }
}

exports.handler = async (event = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const runAt = event.headers?.['x-netlify-schedule-run-at'] || new Date().toISOString();
  const query = event.queryStringParameters || {};
  const targetProviderId = query.providerId || query.provider_id || null;
  const orderSyncLimit = parseLimit(query.orderLimit || query.order_limit, DEFAULT_ORDER_SYNC_LIMIT);

  logger.info('Provider automation invoked', { runAt, targetProviderId, orderSyncLimit });

  try {
    let providerQuery = supabaseAdmin
      .from('providers')
      .select('id, name, status, api_url, api_key, health_status, services_count, markup, currency, balance, low_balance_alerts_enabled')
      .eq('status', 'active');

    if (targetProviderId) {
      providerQuery = providerQuery.eq('id', targetProviderId);
    }

    const { data: providers, error } = await providerQuery;

    if (error) {
      logger.error('Failed to load providers', { error: serializeError(error) });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to load providers' })
      };
    }

    if (!providers || providers.length === 0) {
      logger.info('No providers eligible for automation');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, runAt, summary: [] })
      };
    }

    // Load alert settings
    const alertSettings = await loadAlertSettings();
    
    // Refresh provider balances from their APIs (critical, run in parallel)
    const balanceRefreshPromise = refreshProviderBalances(providers)
      .catch(err => logger.warn('Provider balance refresh error', { error: serializeError(err) }));
    
    // Check provider balances and send alerts if needed (only for enabled providers)
    let balanceAlertInfo = { enabled: false, checked: 0, lowBalance: [], alertSent: false };
    
    const balanceCheckPromise = (async () => {
      // Wait for balance refresh to complete first
      await balanceRefreshPromise;
      
      if (alertSettings.providerLowBalanceAlertEnabled) {
        const enabledProviders = providers.filter(p => p.low_balance_alerts_enabled !== false);
        balanceAlertInfo.enabled = true;
        balanceAlertInfo.checked = enabledProviders.length;
        
        if (enabledProviders.length > 0) {
          await checkProviderBalances(enabledProviders, alertSettings);
          
          // Check if alert was sent (by looking at DB for recent alerts)
          try {
            const now = new Date();
            const twoMinutesAgo = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
            const { data: recentAlerts } = await supabaseAdmin
              .from('provider_balance_alerts')
              .select('provider_id, balance_usd, threshold_usd')
              .gt('created_at', twoMinutesAgo)
              .limit(10);
            
            if (recentAlerts && recentAlerts.length > 0) {
              balanceAlertInfo.lowBalance = recentAlerts;
              balanceAlertInfo.alertSent = true;
            }
          } catch (err) {
            logger.warn('Could not fetch balance alert info for response', { error: serializeError(err) });
          }
        }
      }
    })();

    const summary = [];
    const syncPromises = [];
    
    // Queue all provider syncs (non-blocking)
    for (const provider of providers) {
      const entry = {
        providerId: provider.id,
        providerName: provider.name,
        orderSync: null
      };

      try {
        logger.info('Queueing provider order sync', { providerId: provider.id, limit: orderSyncLimit });
        
        const syncPromise = performOrderStatusSync({ providerId: provider.id, limit: orderSyncLimit })
          .then(orderResult => {
            entry.orderSync = orderResult;
            if (!orderResult.success) {
              logger.warn('Order sync returned errors', { providerId: provider.id, error: orderResult.error });
            }
            return entry;
          })
          .catch(providerError => {
            entry.orderSync = { success: false, error: providerError.message };
            logger.error('Provider automation failed', {
              providerId: provider.id,
              error: serializeError(providerError)
            });
            return entry;
          });
        
        syncPromises.push(syncPromise);
      } catch (providerError) {
        entry.orderSync = { success: false, error: providerError.message };
        logger.error('Provider automation setup error', {
          providerId: provider.id,
          error: serializeError(providerError)
        });
        syncPromises.push(Promise.resolve(entry));
      }
    }

    // Run failed order and balance alerts in parallel with syncs (don't block on sync completion)
    // This way alerts can execute while syncs are still running
    
    // Calculate 24 hours ago for filtering failed orders
    const now = new Date();
    const last24hours = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    
    const alertsPromise = (async () => {
      try {
      
      // GET ONLY NEW FAILED ORDERS (alerted_at IS NULL) - No duplicates!
      const { data: allFailedOrders, error: failedError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, provider_order_id, user_id, service_id, status, charge, quantity, provider_notes, provider_response, created_at, updated_at, alerted_at')
        .in('status', ['failed', 'error'])
        .gt('updated_at', last24hours)  // When status changed to failed (not when order created)
        .is('alerted_at', null)  // ONLY NEW FAILURES - prevents duplicate alerts!
        .order('updated_at', { ascending: false })
        .limit(500);  // Limit to prevent huge queries

      if (failedError) {
        logger.error('[DEDUP] ❌ QUERY ERROR - Failed to fetch failed orders', {
          error: failedError.message,
          code: failedError.code,
          status: failedError.status,
          hint: failedError.hint
        });
      } else if (!allFailedOrders || allFailedOrders.length === 0) {
        logger.info('[DEDUP] ✅ No new failed orders to alert (all already alerted or none in last 24h)');
      } else {
        // These are ALL NEW failures (alerted_at IS NULL from query above)
        logger.info('[DEDUP] Found NEW failed orders to alert', {
          count: allFailedOrders.length,
          orderIds: allFailedOrders.slice(0, 3).map(o => o.id)
        });
        
        // STEP 1: Mark ALL retrieved failures (they're all new)
        try {
          const allOrderIds = allFailedOrders.map(o => o.id);
          const alertTimestamp = new Date().toISOString();
          
          logger.info('[DEDUP] Marking NEW failed orders', {
            count: allOrderIds.length,
            timestamp: alertTimestamp,
            orderIds: allOrderIds.slice(0, 3)
          });
          
          const { data: updateData, error: updateError } = await supabaseAdmin
            .from('orders')
            .update({ alerted_at: alertTimestamp })
            .in('id', allOrderIds)
            .select('id, alerted_at');
          
          if (updateError) {
            logger.error('[DEDUP] ❌ FAILED TO MARK NEW ORDERS', {
              error: updateError.message,
              code: updateError.code,
              ordersCount: allOrderIds.length
            });
          } else {
            logger.info('[DEDUP] ✅ Marked NEW failed orders', {
              updated: updateData?.length || 0,
              sample: updateData?.slice(0, 2).map(o => ({ id: o.id, alerted_at: o.alerted_at }))
            });
          }
        } catch (err) {
          logger.error('[DEDUP] Exception marking new orders', {
            error: err.message,
            ordersCount: allFailedOrders.length
          });
        }
        
        // STEP 2: Send email + Telegram
        logger.info('[EMAIL] Preparing to send alert with failed orders', {
          totalFailedOrders: allFailedOrders.length
        });
        
        // Enrich with user, service, and provider details
        const userIds = [...new Set(allFailedOrders.map(o => o.user_id).filter(Boolean))];
        const serviceIds = [...new Set(allFailedOrders.map(o => o.service_id).filter(Boolean))];
        
        let usersMap = new Map();
        let servicesMap = new Map();
        let providersMap = new Map();
        
        if (userIds.length > 0) {
          const { data: users } = await supabaseAdmin
            .from('users')
            .select('id, username, email')
            .in('id', userIds);
          (users || []).forEach(u => usersMap.set(u.id, u));
        }
        
        if (serviceIds.length > 0) {
          const { data: services } = await supabaseAdmin
            .from('services')
            .select('id, name, public_id, provider_id')
            .in('id', serviceIds);
          (services || []).forEach(s => {
            servicesMap.set(s.id, s);
            if (s.provider_id) providersMap.set(s.provider_id, null); // Mark for fetching
          });
        }
        
        const providerIds = [...providersMap.keys()];
        if (providerIds.length > 0) {
          const { data: providers } = await supabaseAdmin
            .from('providers')
            .select('id, name')
            .in('id', providerIds);
          (providers || []).forEach(p => providersMap.set(p.id, p));
        }
        
        // Enrich orders with user/service/provider info
        const enrichedOrders = allFailedOrders.map(order => {
          const user = usersMap.get(order.user_id);
          const service = servicesMap.get(order.service_id);
          const provider = service ? providersMap.get(service.provider_id) : null;
          
          // Extract failure reason from provider_response or provider_notes
          let failureReason = order.provider_notes || 'No reason provided';
          if (!failureReason || failureReason === 'No reason provided') {
            try {
              const response = typeof order.provider_response === 'string' 
                ? JSON.parse(order.provider_response) 
                : order.provider_response;
              
              if (response && (response.error || response.message || response.reason)) {
                failureReason = response.error || response.message || response.reason;
              }
            } catch (e) {
              // Silently continue, keep original reason
            }
          }
          
          return {
            ...order,
            username: user?.username || 'N/A',
            serviceName: service?.name || 'N/A',
            servicePublicId: service?.public_id || 'N/A',
            providerName: provider?.name || 'N/A',
            failureReason: failureReason
          };
        });
        
        // Send alert in background (don't await)
        sendFailedOrdersAlert(enrichedOrders).catch(err => {
          logger.warn('Failed orders alert error', { error: serializeError(err) });
        });
      }
      } catch (failedErr) {
        logger.warn('Failed to fetch/send failed orders alert', { error: serializeError(failedErr) });
      }
    })(); // End of alertsPromise async function - invoke it

    // Wait for syncs, failed order alerts, and balance checks to complete in parallel
    const [syncResults] = await Promise.all([
      Promise.all(syncPromises).then(results => {
        summary.length = 0;
        summary.push(...results);
        return results;
      }),
      alertsPromise,  // Failed order alerts run in parallel
      balanceCheckPromise  // Balance checks run in parallel
    ]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        runAt,
        providersProcessed: summary.length,
        balanceAlerts: balanceAlertInfo,
        summary
      })
    };
  } catch (error) {
    logger.error('Provider automation fatal error', { error: serializeError(error) });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Provider automation failed',
        details: error.message
      })
    };
  }
};

