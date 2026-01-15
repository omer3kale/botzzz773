// Dashboard Stats API - Get Dashboard Statistics
const { supabaseAdmin } = require('./utils/supabase');
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
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const user = getUserFromToken(event.headers.authorization);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    if (user.role === 'admin') {
      return await handleAdminStats(headers);
    } else {
      return await handleUserStats(user, headers);
    }
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleAdminStats(headers) {
  try {
    // Get total revenue
    const { data: revenueData } = await supabaseAdmin
      .from('payments')
      .select('amount')
      .eq('status', 'completed');
    
    const totalRevenue = revenueData?.reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0;

    // Get total provider costs (sum of all orders with pagination to handle >1000 orders)
    let allOrdersData = [];
    let pageNum = 0;
    const pageSize = 1000;
    let hasMore = true;
    
    while (hasMore) {
      const { data: pageData, error: pageError } = await supabaseAdmin
        .from('orders')
        .select('charge, original_charge, provider_cost, provider_currency')
        .in('status', ['completed', 'partial'])
        .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);
      
      if (pageError) {
        console.error('Error fetching orders page', pageNum, ':', pageError);
        break;
      }
      
      if (!pageData || pageData.length === 0) {
        hasMore = false;
      } else {
        allOrdersData = allOrdersData.concat(pageData);
        pageNum++;
        if (pageData.length < pageSize) {
          hasMore = false;
        }
      }
    }
    
    const ordersData = allOrdersData;

    // Currency conversion rates to USD (simple fallback - should be updated from external API)
    const conversionRates = {
      'USD': 1,
      'EUR': 1.10,
      'GBP': 1.27,
      'TRY': 0.032,
      'INR': 0.012,
      'RUB': 0.011,
      'CNY': 0.14
    };

    const getConversionRate = (currency) => {
      return conversionRates[currency?.toUpperCase()] || 1;
    };

    // Calculate profit per order: income (customer charge in USD) - outcome (provider cost converted to provider's currency, then to USD)
    const totalProfits = ordersData?.reduce((sum, o) => {
      const income = parseFloat(o.charge || o.original_charge || 0); // Customer charge (assumed USD)
      const outcome = parseFloat(o.provider_cost || 0);
      
      // Convert provider cost to USD if provider_currency is different
      const outcomeUSD = outcome * getConversionRate(o.provider_currency || 'USD');
      
      return sum + (income - outcomeUSD);
    }, 0) || 0;

    // Get total orders
    const { count: totalOrders } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true });

    // Get total users
    const { count: totalUsers } = await supabaseAdmin
      .from('users')
      .select('*', { count: 'exact', head: true });

    // Get open tickets
    const { count: openTickets } = await supabaseAdmin
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open');

    // Get recent orders
    const { data: recentOrders } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        user:users(id, username, email),
        service:services(name)
      `)
      .order('created_at', { ascending: false })
      .limit(10);

    // Get revenue by day (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: recentRevenue } = await supabaseAdmin
      .from('payments')
      .select('amount, created_at')
      .eq('status', 'completed')
      .gte('created_at', sevenDaysAgo.toISOString());

    const { data: recentOrdersByDate } = await supabaseAdmin
      .from('orders')
      .select('created_at')
      .gte('created_at', sevenDaysAgo.toISOString());

    const { data: recentUsersByDate } = await supabaseAdmin
      .from('users')
      .select('created_at')
      .gte('created_at', sevenDaysAgo.toISOString());

    const { data: recentTicketsByDate } = await supabaseAdmin
      .from('tickets')
      .select('created_at')
      .gte('created_at', sevenDaysAgo.toISOString());

    // Group by day
    const revenueByDay = {};
    const ordersByDay = {};
    const usersByDay = {};
    const ticketsByDay = {};
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      revenueByDay[dateStr] = 0;
      ordersByDay[dateStr] = 0;
      usersByDay[dateStr] = 0;
      ticketsByDay[dateStr] = 0;
    }

    recentRevenue?.forEach(payment => {
      const date = payment.created_at.split('T')[0];
      if (revenueByDay[date] !== undefined) {
        revenueByDay[date] += parseFloat(payment.amount);
      }
    });

    recentOrdersByDate?.forEach(order => {
      const date = order.created_at.split('T')[0];
      if (ordersByDay[date] !== undefined) {
        ordersByDay[date] += 1;
      }
    });

    recentUsersByDate?.forEach(user => {
      const date = user.created_at.split('T')[0];
      if (usersByDay[date] !== undefined) {
        usersByDay[date] += 1;
      }
    });

    recentTicketsByDate?.forEach(ticket => {
      const date = ticket.created_at.split('T')[0];
      if (ticketsByDay[date] !== undefined) {
        ticketsByDay[date] += 1;
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stats: {
          totalRevenue: totalRevenue.toFixed(5),
          totalProfits: totalProfits.toFixed(5),
          totalOrders: totalOrders || 0,
          totalUsers: totalUsers || 0,
          openTickets: openTickets || 0
        },
        recentOrders: recentOrders || [],
        revenueChart: revenueByDay,
        ordersChart: ordersByDay,
        usersChart: usersByDay,
        ticketsChart: ticketsByDay
      })
    };
  } catch (error) {
    console.error('Admin stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleUserStats(user, headers) {
  try {
    // Get user balance
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', user.userId)
      .single();

    // Get user's total spent
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('charge')
      .eq('user_id', user.userId);

    const totalSpent = orders?.reduce((sum, o) => sum + parseFloat(o.charge), 0) || 0;

    // Get user's order count
    const { count: orderCount } = await supabaseAdmin
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.userId);

    // Get user's open tickets
    const { count: openTickets } = await supabaseAdmin
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .eq('status', 'open');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stats: {
          balance: String(parseFloat(userData?.balance || 0).toFixed(5)).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''),
          totalSpent: String(totalSpent.toFixed(5)).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''),
          totalOrders: orderCount || 0,
          openTickets: openTickets || 0
        }
      })
    };
  } catch (error) {
    console.error('User stats error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
