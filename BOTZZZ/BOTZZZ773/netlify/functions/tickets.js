// Tickets API - Create, Get, Update, Close Support Tickets
const { supabase, supabaseAdmin } = require('./utils/supabase');
const { insertTicketRecord } = require('./utils/ticket-utils');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

const ALLOWED_ORIGINS = ['https://www.botzzz773.pro', 'https://botzzz773.pro'];
function getCorsOrigin(event) {
  const origin = event?.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

// Rate limiting for tickets API
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 30; // 30 requests per minute

function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  if (now > userLimit.resetAt) {
    userLimit.count = 0;
    userLimit.resetAt = now + RATE_LIMIT_WINDOW;
  }
  
  userLimit.count++;
  rateLimitMap.set(userId, userLimit);
  
  return userLimit.count <= MAX_REQUESTS_PER_WINDOW;
}

function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[Tickets Auth] No valid auth header:', authHeader ? 'exists but no Bearer' : 'missing');
    return null;
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('[Tickets Auth] Token decoded successfully for user:', decoded.userId || decoded.id);
    return decoded;
  } catch (error) {
    console.error('[Tickets Auth] Token verification failed:', error.message);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const user = getUserFromToken(event.headers.authorization || event.headers.Authorization);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ 
        error: 'Unauthorized - You must be signed in to access support tickets. Please sign in or create an account.' 
      })
    };
  }

  console.log('[Tickets Handler] User object:', JSON.stringify(user, null, 2));

  // Verify user has valid userId and email
  if (!user.userId || !user.email) {
    console.log('[Tickets Handler] User missing userId or email. userId:', user.userId, 'email:', user.email);
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ 
        error: 'Access denied - Invalid user credentials. Please sign in again.' 
      })
    };
  }

  // Rate limiting check
  if (!checkRateLimit(user.userId)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Rate limit exceeded. Maximum 30 requests per minute.' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    // Support query params for GET requests
    const queryParams = event.queryStringParameters || {};
    const params = event.httpMethod === 'GET' ? { ...body, ...queryParams } : body;

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetTickets(user, params, headers);
      case 'POST':
        return await handlePostActions(user, body, headers);
      case 'PUT':
        return await handlePutActions(user, body, headers);
      case 'DELETE':
        return await handleDeleteTicket(user, body, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Tickets API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGetTickets(user, data, headers) {
  try {
    const { ticketId, shortId, action } = data;
    console.log('[GET TICKETS] Action:', action, 'User:', user.userId, 'ShortId:', shortId, 'TicketId:', ticketId);

    // Handle getUnreadCount action (user vs admin)
    if (action === 'getUnreadCount') {
      if (user.role === 'admin') {
        console.log(`[GET ADMIN OPEN COUNT] Admin ${user.userId}: Fetching open tickets requiring attention...`);
        const { data: openTickets, error: adminCountError } = await supabaseAdmin
          .from('tickets')
          .select('id')
          .eq('status', 'open');

        if (adminCountError) {
          console.error('[GET ADMIN OPEN COUNT ERROR]', adminCountError);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ unreadCount: 0, error: adminCountError.message })
          };
        }

        const openCount = openTickets ? openTickets.length : 0;
        console.log(`[GET ADMIN OPEN COUNT] Admin ${user.userId}: Found ${openCount} open tickets`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ unreadCount: openCount })
        };
      }

      console.log(`[GET UNREAD COUNT] User ${user.userId}: Fetching unread tickets...`);
      const { data: tickets, error } = await supabaseAdmin
        .from('tickets')
        .select('id')
        .eq('user_id', user.userId)
        .eq('has_unread_replies', true);

      if (error) {
        console.error('[GET UNREAD COUNT ERROR]', error);
        // Return 0 if column doesn't exist yet - graceful fallback
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ unreadCount: 0, error: error.message })
        };
      }

      const count = tickets ? tickets.length : 0;
      console.log(`[GET UNREAD COUNT] User ${user.userId}: Found ${count} unread tickets`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ unreadCount: count })
      };
    }

    if (ticketId || shortId) {
      // Resolve short_id to UUID if needed
      let queryId = ticketId;
      let queryField = 'id';
      
      if (shortId && !ticketId) {
        queryField = 'short_id';
        queryId = shortId;
      }
      
      console.log(`[GET TICKET] Field: ${queryField}, Value: ${queryId}`);
      
      // Get specific ticket with messages
      let query = supabaseAdmin
        .from('tickets')
        .select(`
          *,
          user:users(id, email, username),
          messages:ticket_messages(*)
        `)
        .eq(queryField, queryId)
        .single();

      // Non-admins can only see their own tickets
      if (user.role !== 'admin') {
        query = query.eq('user_id', user.userId);
      }

      const { data: ticket, error } = await query;

      if (error) {
        console.error('Get ticket error:', error);
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Ticket not found' })
        };
      }

      // Mark ticket as read when user views it (not for admins)
      if (user.role !== 'admin' && ticket.has_unread_replies) {
        await supabaseAdmin
          .from('tickets')
          .update({ 
            has_unread_replies: false,
            last_viewed_at: new Date().toISOString()
          })
          // Use the fetched ticket's UUID to ensure update works with shortId requests
          .eq('id', ticket.id);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ticket })
      };
    } else {
      // Get all tickets
      let query = supabaseAdmin
        .from('tickets')
        .select(`
          *,
          user:users(id, email, username)
        `)
        .order('created_at', { ascending: false });

      // Non-admins can only see their own tickets
      if (user.role !== 'admin') {
        query = query.eq('user_id', user.userId);
      }

      const { data: tickets, error } = await query;

      if (error) {
        console.error('Get tickets error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to fetch tickets' })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ tickets })
      };
    }
  } catch (error) {
    console.error('Get tickets error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleCreateTicket(user, data, headers) {
  try {
    const { subject, category, priority, message, orderId, userId: targetUserId } = data;

    // Determine ticket owner: if admin provides a userId, use that (admin creating ticket for user)
    // Otherwise, use the authenticated user's own ID (user creating their own ticket)
    const isAdminCreating = user.role === 'admin' && targetUserId && targetUserId !== user.userId;
    const ticketOwnerId = isAdminCreating ? targetUserId : user.userId;

    console.log('[TICKET CREATE] Request data:', { subject, category, priority, message: message?.substring(0, 50), orderId, ticketOwnerId, createdBy: user.userId, isAdminCreating });

    // Input sanitization
    if (!subject || !category || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Subject, category, and message are required' })
      };
    }

    // Validate subject and message length
    if (subject.length > 200 || message.length > 5000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Subject or message too long' })
      };
    }

    // If admin is creating for a specific user, validate that user exists
    if (isAdminCreating) {
      const { data: targetUser, error: targetUserError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', targetUserId)
        .single();
      
      if (targetUserError || !targetUser) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Selected user not found' })
        };
      }
    }

    // Create ticket with auto-generated ticket number and optional orderId
    let ticket;
    try {
      const ticketData = {
        user_id: ticketOwnerId,
        subject: subject.trim(),
        category,
        priority: priority || 'medium',
        status: 'open'
      };
      
      // Add orderId if provided and is valid UUID format
      if (orderId) {
        // Validate UUID format (reject numeric IDs like "12345")
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(orderId)) {
          ticketData.order_id = orderId;
        } else {
          console.warn(`[TICKET CREATE] Invalid order ID format (not UUID): ${orderId}`);
          // Skip invalid orderId - ticket will be created without order association
        }
      }
      
      ticket = await insertTicketRecord(ticketData);
    } catch (ticketError) {
      console.error('Create ticket error:', ticketError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to create ticket',
          details: ticketError.message || 'Unknown error'
        })
      };
    }

    // Add initial message (same pattern as handleReplyTicket which works)
    const messagePayload = {
      ticket_id: ticket.id,
      message: message.trim(),
      is_admin: isAdminCreating
    };

    // Only add user_id if it's a valid UUID (not for dev-admin or similar)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const senderId = isAdminCreating ? user.userId : ticketOwnerId;
    if (senderId && uuidRegex.test(senderId)) {
      messagePayload.user_id = senderId;
    }

    console.log('[TICKET CREATE] Inserting message:', { 
      ticket_id: messagePayload.ticket_id, 
      user_id: messagePayload.user_id,
      messageLength: messagePayload.message?.length,
      is_admin: messagePayload.is_admin 
    });

    const { error: messageError } = await supabaseAdmin
      .from('ticket_messages')
      .insert(messagePayload);

    if (messageError) {
      console.error('[TICKET CREATE] Message insert FAILED:', JSON.stringify(messageError));
    } else {
      console.log('[TICKET CREATE] Message inserted successfully');
    }

    // If admin created this ticket, mark it as answered with unread flag so user sees it
    if (isAdminCreating) {
      await supabaseAdmin
        .from('tickets')
        .update({
          status: 'answered',
          has_unread_replies: true,
          last_reply_by: 'admin'
        })
        .eq('id', ticket.id);
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        ticket,
        statusMessage: isAdminCreating ? 'Ticket created and sent to user' : 'Ticket created successfully'
      })
    };
  } catch (error) {
    console.error('Create ticket error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message || 'Unknown error'
      })
    };
  }
}

// ============= BULK CREATE TICKETS (Send to all users) =============
async function handleBulkCreateTickets(user, data, headers) {
  try {
    // Only admins can bulk create
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { subject, category, priority, message } = data;

    if (!subject || !category || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Subject, category, and message are required' })
      };
    }

    if (subject.length > 200 || message.length > 5000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Subject or message too long' })
      };
    }

    // Fetch all active users
    const { data: allUsers, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('status', 'active');

    if (usersError || !allUsers || allUsers.length === 0) {
      console.error('[BULK TICKET] Error fetching users:', usersError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch users' })
      };
    }

    console.log(`[BULK TICKET] Creating tickets for ${allUsers.length} users. Subject: "${subject}"`);

    let successCount = 0;
    let failCount = 0;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Process in batches of 10 to avoid overwhelming the DB
    const batchSize = 10;
    for (let i = 0; i < allUsers.length; i += batchSize) {
      const batch = allUsers.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(batch.map(async (targetUser) => {
        // 1. Create ticket for this user
        const ticketData = {
          user_id: targetUser.id,
          subject: subject.trim(),
          category,
          priority: priority || 'medium',
          status: 'open'
        };

        const ticket = await insertTicketRecord(ticketData);

        // 2. Add admin message
        const messagePayload = {
          ticket_id: ticket.id,
          message: message.trim(),
          is_admin: true
        };

        if (user.userId && uuidRegex.test(user.userId)) {
          messagePayload.user_id = user.userId;
        }

        await supabaseAdmin
          .from('ticket_messages')
          .insert(messagePayload);

        // 3. Mark as answered with unread flag
        await supabaseAdmin
          .from('tickets')
          .update({
            status: 'answered',
            has_unread_replies: true,
            last_reply_by: 'admin'
          })
          .eq('id', ticket.id);

        return ticket.id;
      }));

      for (const result of results) {
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          failCount++;
          console.error('[BULK TICKET] Failed for one user:', result.reason?.message || result.reason);
        }
      }
    }

    console.log(`[BULK TICKET] Completed: ${successCount} success, ${failCount} failed out of ${allUsers.length} users`);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        statusMessage: `Ticket sent to ${successCount}/${allUsers.length} users${failCount > 0 ? ` (${failCount} failed)` : ''}`,
        totalUsers: allUsers.length,
        successCount,
        failCount
      })
    };
  } catch (error) {
    console.error('[BULK TICKET] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to create bulk tickets',
        details: error.message || 'Unknown error'
      })
    };
  }
}

async function handleUpdateTicket(user, data, headers) {
  try {
    const { ticketId, action, message, status, priority } = data;

    if (!ticketId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticket ID is required' })
      };
    }

    // Get ticket
    const { data: ticket, error } = await supabaseAdmin
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (error || !ticket) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Ticket not found' })
      };
    }

    // Check permissions
    if (ticket.user_id !== user.userId && user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden' })
      };
    }

    if (action === 'reply') {
      if (!message) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Message is required' })
        };
      }

      // Add message
      const messageData = {
        ticket_id: ticketId,
        message,
        is_admin: user.role === 'admin'
      };
      
      // Only add user_id if it's a valid UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (user.userId && uuidRegex.test(user.userId)) {
        messageData.user_id = user.userId;
      }

      await supabaseAdmin
        .from('ticket_messages')
        .insert(messageData);

      // Update ticket status if closed
      if (ticket.status === 'closed') {
        await supabaseAdmin
          .from('tickets')
          .update({ status: 'open' })
          .eq('id', ticketId);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Reply added'
        })
      };
    } else if (action === 'update') {
      // Update ticket properties (admin only)
      if (user.role !== 'admin') {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Admin access required' })
        };
      }

      const updateData = {};
      if (status) updateData.status = status;
      if (priority) updateData.priority = priority;

      await supabaseAdmin
        .from('tickets')
        .update(updateData)
        .eq('id', ticketId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Ticket updated'
        })
      };
    } else if (action === 'close') {
      await supabaseAdmin
        .from('tickets')
        .update({ status: 'closed' })
        .eq('id', ticketId);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Ticket closed'
        })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action' })
    };
  } catch (error) {
    console.error('Update ticket error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handlePostActions(user, data, headers) {
  const { action } = data;

  // Explicitly handle each action for clarity
  if (action === 'reply') {
    return await handleReplyTicket(user, data, headers);
  } else if (action === 'close') {
    return await handleCloseTicket(user, data, headers);
  } else if (action === 'bulkReply') {
    return await handleBulkReply(user, data, headers);
  } else if (action === 'bulkClose') {
    return await handleBulkClose(user, data, headers);
  } else if (action === 'bulkDelete') {
    return await handleBulkDelete(user, data, headers);
  } else if (action === 'bulkCreate') {
    return await handleBulkCreateTickets(user, data, headers);
  }

  // Default to create ticket (no action or action === 'create')
  return await handleCreateTicket(user, data, headers);
}

async function handlePutActions(user, data, headers) {
  const { action } = data;

  switch (action) {
    case 'update-status':
      return await handleUpdateStatus(user, data, headers);
    case 'assign':
      return await handleAssignTicket(user, data, headers);
    case 'close':
      return await handleCloseTicket(user, data, headers);
    default:
      return await handleUpdateTicket(user, data, headers);
  }
}

async function handleReplyTicket(user, data, headers) {
  try {
    const { ticketId, shortId, message, isAdmin, autoClose } = data;
    
    let finalTicketId = ticketId;

    console.log('[REPLY TICKET] Input:', { ticketId, shortId, messageLength: message?.length, isAdmin, autoClose });

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is required' })
      };
    }
    
    // If shortId provided, resolve to UUID
    if (shortId && !ticketId) {
      const { data: ticketData, error: resolveError } = await supabaseAdmin
        .from('tickets')
        .select('id')
        .eq('short_id', shortId)
        .single();
      
      if (resolveError || !ticketData) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Ticket not found' })
        };
      }
      
      finalTicketId = ticketData.id;
      console.log('[REPLY TICKET] Resolved shortId', shortId, 'to UUID', finalTicketId);
    }
    
    if (!finalTicketId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticket ID is required' })
      };
    }

    // Validate message length
    if (message.length > 5000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message too long (max 5000 characters)' })
      };
    }

    // Verify ticket exists and user has access
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .select('id, user_id, status')
      .eq('id', finalTicketId)
      .single();

    if (ticketError || !ticket) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Ticket not found' })
      };
    }

    // Check permissions
    if (ticket.user_id !== user.userId && user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden' })
      };
    }

    // UNIFIED LOGIC: Always insert into ticket_messages table
    const messageData = {
      ticket_id: finalTicketId,
      message: message.trim(),
      is_admin: user.role === 'admin' || isAdmin === true
    };
    
    // Only add user_id if it's a valid UUID (not for dev-admin or similar)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (user.userId && uuidRegex.test(user.userId)) {
      messageData.user_id = user.userId;
    }
    
    const { error: messageError } = await supabaseAdmin
      .from('ticket_messages')
      .insert(messageData);

    if (messageError) {
      console.error('Insert message error:', messageError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to send reply' })
      };
    }

    // Update ticket metadata and status transitions
    const updateData = {
      last_reply_by: user.role === 'admin' ? 'admin' : user.email,
      updated_at: new Date().toISOString()
    };

    if (autoClose) {
      updateData.status = 'closed';
      updateData.closed_at = new Date().toISOString();
    } else {
      if (user.role === 'admin') {
        // Admin replying marks ticket as answered and sets unread flag for user
        updateData.status = 'answered';
        updateData.has_unread_replies = true;  // Set unread flag so user sees notification
      } else {
        // User replying moves ticket back to open regardless of previous state
        updateData.status = 'open';
      }
    }

    await supabaseAdmin
      .from('tickets')
      .update(updateData)
      .eq('id', finalTicketId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Reply sent successfully'
      })
    };
  } catch (error) {
    console.error('Reply ticket error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        details: error.message || 'Unknown error'
      })
    };
  }
}

async function handleUpdateStatus(user, data, headers) {
  try {
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { ticketId, status } = data;

    if (!ticketId || !status) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticket ID and status are required' })
      };
    }

    const { error } = await supabaseAdmin
      .from('tickets')
      .update({ status })
      .eq('id', ticketId);

    if (error) {
      console.error('Update status error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to update status' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Ticket status updated to ${status}`
      })
    };
  } catch (error) {
    console.error('Update status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleAssignTicket(user, data, headers) {
  try {
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { ticketId, assignee } = data;

    if (!ticketId || !assignee) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticket ID and assignee are required' })
      };
    }

    const { error } = await supabaseAdmin
      .from('tickets')
      .update({ assigned_to: assignee })
      .eq('id', ticketId);

    if (error) {
      console.error('Assign ticket error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to assign ticket' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Ticket assigned to ${assignee}`
      })
    };
  } catch (error) {
    console.error('Assign ticket error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleCloseTicket(user, data, headers) {
  try {
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { ticketId } = data;

    if (!ticketId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticket ID is required' })
      };
    }

    const { error } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', ticketId);

    if (error) {
      console.error('Close ticket error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to close ticket' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Ticket closed successfully'
      })
    };
  } catch (error) {
    console.error('Close ticket error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleDeleteTicket(user, data, headers) {
  try {
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { ticketId } = data;

    if (!ticketId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticket ID is required' })
      };
    }

    const { error } = await supabaseAdmin
      .from('tickets')
      .delete()
      .eq('id', ticketId);

    if (error) {
      console.error('Delete ticket error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to delete ticket' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Ticket deleted successfully'
      })
    };
  } catch (error) {
    console.error('Delete ticket error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Handle bulk reply to multiple tickets
async function handleBulkReply(user, data, headers) {
  try {
    console.log('[BulkReply] User check - userId:', user?.userId, 'role:', user?.role);
    if (!user || (!user.id && !user.userId)) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    if (!user.is_admin && user.role !== 'admin' && !user.role?.includes('admin')) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only admins can reply to tickets' })
      };
    }

    const { shortIds, message, isAdmin } = data;
    if (!shortIds || !Array.isArray(shortIds) || shortIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid short IDs' })
      };
    }

    if (!message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Message is required' })
      };
    }

    let successCount = 0;
    let failCount = 0;

    console.log('[BulkReply] Processing', shortIds.length, 'tickets');

    for (const shortId of shortIds) {
      try {
        // Get ticket
        const { data: tickets, error: fetchError } = await supabaseAdmin
          .from('tickets')
          .select('*')
          .eq('short_id', shortId)
          .single();

        if (fetchError || !tickets) {
          console.error('[BulkReply] Ticket not found:', shortId, fetchError?.message);
          failCount++;
          continue;
        }

        console.log('[BulkReply] Processing ticket:', shortId, 'id:', tickets.id);

        // Add message (don't send user_id for admin users since they don't have UUID)
        const messageData = {
          ticket_id: tickets.id,
          message: message,
          is_admin: true
        };
        
        // Only add user_id if it's a valid UUID format (not dev-admin or similar)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (user.userId && uuidRegex.test(user.userId)) {
          messageData.user_id = user.userId;
        }

        const { error: msgError } = await supabaseAdmin
          .from('ticket_messages')
          .insert(messageData);

        if (msgError) {
          console.error('[BulkReply] Message insert error:', msgError.message);
          failCount++;
          continue;
        }

        // Update ticket status and mark as having unread replies
        const { error: updateError } = await supabaseAdmin
          .from('tickets')
          .update({
            status: 'answered',
            has_unread_replies: true,
            last_reply_by: 'admin',
            updated_at: new Date().toISOString()
          })
          .eq('id', tickets.id);

        if (updateError) {
          console.error('[BulkReply] Ticket update error:', updateError.message);
          failCount++;
        } else {
          successCount++;
        }
      } catch (error) {
        console.error(`Error replying to ticket ${shortId}:`, error);
        failCount++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: successCount > 0,
        message: `Replied to ${successCount} ticket(s)`,
        successCount,
        failCount
      })
    };
  } catch (error) {
    console.error('Bulk reply error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Handle bulk close tickets
async function handleBulkClose(user, data, headers) {
  try {
    if (!user || (!user.id && !user.userId)) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    if (!user.is_admin && user.role !== 'admin' && !user.role?.includes('admin')) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only admins can close tickets' })
      };
    }

    const { shortIds } = data;
    if (!shortIds || !Array.isArray(shortIds) || shortIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid short IDs' })
      };
    }

    let successCount = 0;
    let failCount = 0;

    for (const shortId of shortIds) {
      try {
        const { error } = await supabaseAdmin
          .from('tickets')
          .update({
            status: 'closed',
            closed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('short_id', shortId);

        if (error) {
          failCount++;
        } else {
          successCount++;
        }
      } catch (error) {
        console.error(`Error closing ticket ${shortId}:`, error);
        failCount++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: successCount > 0,
        message: `Closed ${successCount} ticket(s)`,
        successCount,
        failCount
      })
    };
  } catch (error) {
    console.error('Bulk close error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Handle bulk delete tickets
async function handleBulkDelete(user, data, headers) {
  try {
    if (!user || (!user.id && !user.userId)) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    if (!user.is_admin && user.role !== 'admin' && !user.role?.includes('admin')) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Only admins can delete tickets' })
      };
    }

    const { shortIds } = data;
    if (!shortIds || !Array.isArray(shortIds) || shortIds.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid short IDs' })
      };
    }

    let successCount = 0;
    let failCount = 0;

    for (const shortId of shortIds) {
      try {
        // First, get the ticket ID
        const { data: ticket, error: fetchError } = await supabaseAdmin
          .from('tickets')
          .select('id')
          .eq('short_id', shortId)
          .single();

        if (fetchError || !ticket) {
          failCount++;
          continue;
        }

        // Delete associated messages
        await supabaseAdmin
          .from('ticket_messages')
          .delete()
          .eq('ticket_id', ticket.id);

        // Delete the ticket
        const { error: deleteError } = await supabaseAdmin
          .from('tickets')
          .delete()
          .eq('id', ticket.id);

        if (deleteError) {
          failCount++;
        } else {
          successCount++;
        }
      } catch (error) {
        console.error(`Error deleting ticket ${shortId}:`, error);
        failCount++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: successCount > 0,
        message: `Deleted ${successCount} ticket(s)`,
        successCount,
        failCount
      })
    };
  } catch (error) {
    console.error('Bulk delete error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
