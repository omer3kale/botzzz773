// Contact Form API - Handle Contact Form Submissions
const { supabaseAdmin } = require('./utils/supabase');
const { insertTicketRecord } = require('./utils/ticket-utils');
const { withRateLimit } = require('./utils/rate-limit');
const { createLogger, serializeError } = require('./utils/logger');

const logger = createLogger('contact');

const baseHandler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { name, email, subject, message } = JSON.parse(event.body || '{}');

    // Validate input
    if (!name || !email || !subject || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'All fields are required' })
      };
    }

    if (message.length < 10) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message must be at least 10 characters' })
      };
    }

    // Create ticket from contact form
    let ticket;
    try {
      ticket = await insertTicketRecord({
        subject,
        category: 'other',
        priority: 'medium',
        status: 'open',
        user_id: null
      });
    } catch (error) {
      logger.error('Create ticket error', { error: serializeError(error) });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to submit contact form' })
      };
    }

    // Add initial message with contact details
    await supabaseAdmin
      .from('ticket_messages')
      .insert({
        ticket_id: ticket.id,
        user_id: null,
        message: `Contact Form Submission\n\nName: ${name}\nEmail: ${email}\n\n${message}`,
        is_admin: false
      });

    // TODO: Send email notification to admin
    // await sendEmail(process.env.ADMIN_EMAIL, 'New Contact Form Submission', ...);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Your message has been sent. We will respond within 2-4 hours.',
        ticketId: ticket.id
      })
    };
  } catch (error) {
    logger.error('Contact form error', { error: serializeError(error) });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

const CONTACT_RATE_LIMIT = {
  route: 'contact',
  limit: 10,
  windowSeconds: 60
};

exports.handler = withRateLimit(CONTACT_RATE_LIMIT, baseHandler);
