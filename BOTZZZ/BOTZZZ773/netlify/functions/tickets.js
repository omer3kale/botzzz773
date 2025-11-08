// Tickets API - Create, Get, Update, Close Support Tickets
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const user = getUserFromToken(event.headers.authorization);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ 
        error: 'Unauthorized - You must be signed in to access support tickets. Please sign in or create an account.' 
      })
    };
  }

  // Verify user has valid userId and email
  if (!user.userId || !user.email) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ 
        error: 'Access denied - Invalid user credentials. Please sign in again.' 
      })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetTickets(user, body, headers);
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
    const { ticketId } = data;

    if (ticketId) {
      // Get specific ticket with messages
      let query = supabaseAdmin
        .from('tickets')
        .select(`
          *,
          user:users(id, email, username),
          messages:ticket_messages(*)
        `)
        .eq('id', ticketId)
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
    const { subject, category, priority, message } = data;

    if (!subject || !category || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Subject, category, and message are required' })
      };
    }

    // Create ticket
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from('tickets')
      .insert({
        user_id: user.userId,
        subject,
        category,
        priority: priority || 'medium',
        status: 'open'
      })
      .select()
      .single();

    if (ticketError) {
      console.error('Create ticket error:', ticketError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create ticket' })
      };
    }

    // Add initial message
    const { error: messageError } = await supabaseAdmin
      .from('ticket_messages')
      .insert({
        ticket_id: ticket.id,
        user_id: user.userId,
        message,
        is_admin: false
      });

    if (messageError) {
      console.error('Create message error:', messageError);
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        ticket
      })
    };
  } catch (error) {
    console.error('Create ticket error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
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
      await supabaseAdmin
        .from('ticket_messages')
        .insert({
          ticket_id: ticketId,
          user_id: user.userId,
          message,
          is_admin: user.role === 'admin'
        });

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

  if (action === 'reply') {
    return await handleReplyTicket(user, data, headers);
  }

  // Default to create ticket
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
    const { ticketId, message, isAdmin, autoClose } = data;

    if (!ticketId || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Ticket ID and message are required' })
      };
    }

    // Add reply to ticket (you may need a ticket_replies table)
    // For now, we'll just update the ticket with a note
    const updateData = {
      last_reply: message,
      last_reply_by: isAdmin ? 'admin' : user.email,
      updated_at: new Date().toISOString()
    };

    if (autoClose) {
      updateData.status = 'closed';
    }

    const { error } = await supabaseAdmin
      .from('tickets')
      .update(updateData)
      .eq('id', ticketId);

    if (error) {
      console.error('Reply ticket error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to send reply' })
      };
    }

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
      body: JSON.stringify({ error: 'Internal server error' })
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
