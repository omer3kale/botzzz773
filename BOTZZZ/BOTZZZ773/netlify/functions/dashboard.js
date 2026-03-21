// Dashboard Stats API - Get Dashboard Statistics
const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const { getExchangeRates } = require('./utils/currency-converter');

const JWT_SECRET = process.env.JWT_SECRET;

const ALLOWED_ORIGINS = ['https://www.botzzz773.pro', 'https://botzzz773.pro'];
function getCorsOrigin(event) {
  const origin = event?.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

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
    'Access-Control-Allow-Origin': getCorsOrigin(event),
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
      return await handleAdminStats(headers, event);
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

async function handleAdminStats(headers, event) {
  try {
    // Parse date range from query params (default: last 7 days)
    const dateRange = event?.queryStringParameters?.dateRange || '7days';
    console.log('[DASHBOARD] Admin stats for dateRange:', dateRange);

    let startDate = new Date();
    let dayLabel = 'Last 7 days';

    switch(dateRange) {
      case '30days':
        startDate.setDate(startDate.getDate() - 30);
        dayLabel = 'Last 30 days';
        break;
      case '90days':
        startDate.setDate(startDate.getDate() - 90);
        dayLabel = 'Last 90 days';
        break;
      case 'this_month':
        startDate.setDate(1);
        dayLabel = 'This month';
        break;
      case 'last_month':
        startDate = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1);
        dayLabel = 'Last month';
        break;
      case 'ytd':
        startDate = new Date(startDate.getFullYear(), 0, 1);
        dayLabel = 'Year to date';
        break;
      case '7days':
      default:
        startDate.setDate(startDate.getDate() - 7);
        dayLabel = 'Last 7 days';
    }

    const endDate = new Date();
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // Helper for paginated Supabase fetches (handles >1000 row limit)
    async function paginatedFetch(buildQuery) {
      let all = [], page = 0;
      const size = 1000;
      while (true) {
        const { data, error } = await buildQuery().range(page * size, (page + 1) * size - 1);
        if (error) { console.error('[DASHBOARD] Paginated fetch error:', error); break; }
        if (!data || data.length === 0) break;
        all = all.concat(data);
        if (data.length < size) break;
        page++;
      }
      return all;
    }

    // ─── Fetch ALL data in parallel (was 14+ sequential queries) ───
    const [
      revenueData,
      ordersData,
      rates,
      totalOrdersRes,
      totalUsersRes,
      openTicketsRes,
      recentOrdersRes,
      ordersForProfit,
      paymentsInRange,
      usersByDate,
      ticketsByDate,
      usersMapRes,
    ] = await Promise.all([
      // 1. All completed payments → total revenue
      supabaseAdmin.from('payments').select('amount').eq('status', 'completed')
        .then(r => r.data || []),

      // 2. All completed/partial orders → total profit
      paginatedFetch(() => supabaseAdmin.from('orders')
        .select('charge, original_charge, provider_cost, provider_currency')
        .in('status', ['completed', 'partial'])),

      // 3. Exchange rates from API
      getExchangeRates().catch(err => {
        console.warn('[DASHBOARD] Failed to get exchange rates, using fallback:', err.message);
        return null;
      }),

      // 4. Total orders count
      supabaseAdmin.from('orders').select('*', { count: 'exact', head: true }),

      // 5. Total users count
      supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),

      // 6. Open tickets count
      supabaseAdmin.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'open'),

      // 7. Recent 10 orders with joins
      supabaseAdmin.from('orders')
        .select('*, user:users(id, username, email), service:services(name)')
        .order('created_at', { ascending: false }).limit(10),

      // 8. Date-range orders → daily profit, orders chart, user breakdown, charges
      paginatedFetch(() => supabaseAdmin.from('orders')
        .select('created_at, charge, original_charge, provider_cost, provider_currency, status, user_id')
        .gte('created_at', startISO).lte('created_at', endISO)
        .order('created_at', { ascending: false })),

      // 9. Payments in range → revenue chart (exclude refunds)
      supabaseAdmin.from('payments')
        .select('created_at, amount, method')
        .gte('created_at', startISO).lte('created_at', endISO)
        .neq('method', 'refund')
        .order('created_at', { ascending: false })
        .then(r => r.data || []),

      // 10. Users in range → users chart
      paginatedFetch(() => supabaseAdmin.from('users')
        .select('created_at')
        .gte('created_at', startISO).lte('created_at', endISO)
        .order('created_at', { ascending: false })),

      // 11. Tickets in range → tickets chart
      paginatedFetch(() => supabaseAdmin.from('tickets')
        .select('created_at')
        .gte('created_at', startISO).lte('created_at', endISO)
        .order('created_at', { ascending: false })),

      // 12. User id→username map
      supabaseAdmin.from('users').select('id, username'),
    ]);

    // ─── Build exchange rate converter ───
    let conversionRates = {
      'USD': 1, 'EUR': 1.10, 'GBP': 1.27, 'TRY': 0.032,
      'INR': 0.012, 'RUB': 0.011, 'CNY': 0.14, 'BRL': 0.190476
    };
    if (rates) {
      conversionRates = {};
      Object.entries(rates).forEach(([currency, rate]) => {
        conversionRates[currency] = 1 / rate;
      });
      console.log('[DASHBOARD] Using real exchange rates from API');
    }
    const getConversionRate = (currency) => conversionRates[currency?.toUpperCase()] || 1;

    // ─── Calculate global totals ───
    const totalRevenue = revenueData.reduce((sum, p) => sum + parseFloat(p.amount), 0);

    const totalProfits = ordersData.reduce((sum, o) => {
      const income = parseFloat(o.charge || o.original_charge || 0);
      const outcome = parseFloat(o.provider_cost || 0);
      const outcomeUSD = outcome * getConversionRate(o.provider_currency || 'USD');
      return sum + (income - outcomeUSD);
    }, 0);

    const totalOrders = totalOrdersRes.count || 0;
    const totalUsers = totalUsersRes.count || 0;
    const openTickets = openTicketsRes.count || 0;
    const recentOrders = recentOrdersRes.data || [];

    // ─── Initialize day buckets ───
    const revenueByDay = {};
    const ordersByDay = {};
    const usersByDay = {};
    const ticketsByDay = {};
    const profitByDay = {};
    const chargeByDay = {};

    let dayCount = 7;
    if (dateRange === '30days') dayCount = 30;
    else if (dateRange === '90days') dayCount = 90;
    else if (dateRange === 'this_month') dayCount = new Date().getDate();
    else if (dateRange === 'last_month') {
      dayCount = new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate();
    }
    else if (dateRange === 'ytd') {
      dayCount = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 1)) / (1000 * 60 * 60 * 24)) + 1;
    }

    for (let i = dayCount - 1; i >= 0; i--) {
      const date = new Date();
      if (dateRange === 'this_month') {
        date.setDate(i + 1);
      } else if (dateRange === 'last_month') {
        date.setMonth(date.getMonth() - 1);
        date.setDate(i + 1);
      } else if (dateRange === 'ytd') {
        date.setMonth(0);
        date.setDate(i + 1);
      } else {
        date.setDate(date.getDate() - i);
      }
      const dateStr = date.toISOString().split('T')[0];
      revenueByDay[dateStr] = 0;
      ordersByDay[dateStr] = 0;
      usersByDay[dateStr] = 0;
      ticketsByDay[dateStr] = 0;
      profitByDay[dateStr] = 0;
      chargeByDay[dateStr] = 0;
    }

    // ─── Populate revenue by day from payments ───
    paymentsInRange.forEach(payment => {
      try {
        const date = payment.created_at?.split('T')[0];
        if (date && revenueByDay.hasOwnProperty(date)) {
          revenueByDay[date] += parseFloat(payment.amount || 0);
        }
      } catch (err) {
        console.error('[DASHBOARD] Error processing payment:', err);
      }
    });

    // ─── Build user username map ───
    const userUsernameMap = {};
    if (usersMapRes.data) {
      usersMapRes.data.forEach(u => { userUsernameMap[u.id] = u.username; });
    }

    // ─── Initialize user breakdown by day ───
    const usersByDayDetailed = {};
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      usersByDayDetailed[currentDate.toISOString().split('T')[0]] = {};
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // ─── Single pass over ordersForProfit: profit, charges, order count, user breakdown ───
    ordersForProfit.forEach(order => {
      const date = order.created_at.split('T')[0];
      const income = parseFloat(order.charge || order.original_charge || 0);
      const outcome = parseFloat(order.provider_cost || 0);
      const outcomeUSD = outcome * getConversionRate(order.provider_currency || 'USD');
      let dailyProfit = income - outcomeUSD;

      // Cancelled order ise profiti negatif yap (geri al)
      if (order.status === 'cancelled') {
        dailyProfit = -dailyProfit;
      }

      // Profit chart
      if (profitByDay[date] !== undefined) {
        profitByDay[date] += dailyProfit;
      }

      // Charge chart
      if (chargeByDay[date] !== undefined) {
        chargeByDay[date] += income;
      }

      // Orders count chart
      if (ordersByDay[date] !== undefined) {
        ordersByDay[date] += 1;
      }

      // User breakdown by day
      if (usersByDayDetailed[date]) {
        const username = userUsernameMap[order.user_id] || 'Unknown';
        if (!usersByDayDetailed[date][username]) {
          usersByDayDetailed[date][username] = { username, total_charge: 0, profit: 0 };
        }
        usersByDayDetailed[date][username].total_charge += income;
        usersByDayDetailed[date][username].profit += dailyProfit;
      }
    });

    // ─── Count users and tickets by day ───
    usersByDate.forEach(user => {
      const date = user.created_at.split('T')[0];
      if (usersByDay[date] !== undefined) usersByDay[date] += 1;
    });

    ticketsByDate.forEach(ticket => {
      const date = ticket.created_at.split('T')[0];
      if (ticketsByDay[date] !== undefined) ticketsByDay[date] += 1;
    });

    // Convert user breakdown to array format
    const usersByDayArray = {};
    Object.entries(usersByDayDetailed).forEach(([date, usersObj]) => {
      usersByDayArray[date] = Object.values(usersObj);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stats: {
          totalRevenue: totalRevenue.toFixed(5),
          totalProfits: totalProfits.toFixed(5),
          totalOrders: totalOrders,
          totalUsers: totalUsers,
          openTickets: openTickets
        },
        recentOrders: recentOrders,
        revenueChart: revenueByDay,
        ordersChart: ordersByDay,
        chargeByDay: chargeByDay,
        usersChart: usersByDay,
        ticketsChart: ticketsByDay,
        profitChart: profitByDay,
        usersByDay: usersByDayArray
      })
    };
  } catch (error) {
    console.error('[DASHBOARD] Admin stats error:', error.message);
    console.error('[DASHBOARD] Error stack:', error.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
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

    // Get user's total spent (paginate to avoid 1k row limit)
    let totalSpent = 0;
    let pageNum = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: ordersPage, error: ordersError } = await supabaseAdmin
        .from('orders')
        .select('charge')
        .eq('user_id', user.userId)
        .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);

      if (ordersError) {
        console.error('[DASHBOARD] User stats orders page error:', ordersError);
        break;
      }

      if (!ordersPage || ordersPage.length === 0) {
        hasMore = false;
      } else {
        ordersPage.forEach(order => {
          totalSpent += parseFloat(order.charge || 0);
        });
        pageNum++;
        if (ordersPage.length < pageSize) {
          hasMore = false;
        }
      }
    }

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
