// Dashboard Stats API - Get Dashboard Statistics
const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const { getExchangeRates } = require('./utils/currency-converter');

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
    
    // Calculate start date based on range
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
    console.log('[DASHBOARD] startDate:', startDate.toISOString());
    console.log('[DASHBOARD] endDate:', endDate.toISOString());
    console.log('[DASHBOARD] dayLabel:', dayLabel);
    
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

    // Get real exchange rates from API (with fallback to hardcoded rates)
    let conversionRates = {
      'USD': 1,
      'EUR': 1.10,
      'GBP': 1.27,
      'TRY': 0.032,
      'INR': 0.012,
      'RUB': 0.011,
      'CNY': 0.14,
      'BRL': 0.190476
    };

    try {
      const rates = await getExchangeRates();
      if (rates) {
        // Convert from Open Exchange Rates format (rates TO USD)
        // to our format (rates FROM USD to other currencies)
        conversionRates = {};
        Object.entries(rates).forEach(([currency, rate]) => {
          // Rate is "how many of this currency per 1 USD"
          // We want "how many USD per 1 of this currency"
          conversionRates[currency] = 1 / rate;
        });
        console.log('[DASHBOARD] Using real exchange rates from API');
      }
    } catch (error) {
      console.warn('[DASHBOARD] Failed to get exchange rates, using fallback:', error.message);
    }

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

    // Get revenue by day (based on selected date range)
    const { data: recentRevenue } = await supabaseAdmin
      .from('payments')
      .select('amount, created_at')
      .eq('status', 'completed')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString())
      .limit(10000);

    // Get orders by date (with pagination to handle large datasets)
    let allOrdersByDate = [];
    pageNum = 0;  // Reset pageNum for orders by date loop
    let hasMoreOrders = true;
    
    while (hasMoreOrders) {
      const { data: pageData } = await supabaseAdmin
        .from('orders')
        .select('created_at')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .range(pageNum * pageSize, (pageNum + 1) * pageSize - 1);
      
      if (!pageData || pageData.length === 0) {
        hasMoreOrders = false;
      } else {
        allOrdersByDate = allOrdersByDate.concat(pageData);
        pageNum++;
      }
    }
    
    console.log('[DASHBOARD] recentOrdersByDate count:', allOrdersByDate?.length || 0);
    console.log('[DASHBOARD] recentOrdersByDate sample:', allOrdersByDate?.slice(0, 5));

    let allUsersByDate = [];
    let userPageNum = 0;
    let hasMoreUsers = true;
    
    while (hasMoreUsers) {
      const { data: pageData } = await supabaseAdmin
        .from('users')
        .select('created_at')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .range(userPageNum * pageSize, (userPageNum + 1) * pageSize - 1);
      
      if (!pageData || pageData.length === 0) {
        hasMoreUsers = false;
      } else {
        allUsersByDate = allUsersByDate.concat(pageData);
        userPageNum++;
      }
    }
    
    const recentUsersByDate = allUsersByDate;

    let allTicketsByDate = [];
    let ticketPageNum = 0;
    let hasMoreTickets = true;
    
    while (hasMoreTickets) {
      const { data: pageData } = await supabaseAdmin
        .from('tickets')
        .select('created_at')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .range(ticketPageNum * pageSize, (ticketPageNum + 1) * pageSize - 1);
      
      if (!pageData || pageData.length === 0) {
        hasMoreTickets = false;
      } else {
        allTicketsByDate = allTicketsByDate.concat(pageData);
        ticketPageNum++;
      }
    }
    
    const recentTicketsByDate = allTicketsByDate;

    // Group by day - Initialize all days
    const revenueByDay = {};
    const ordersByDay = {};
    const usersByDay = {};
    const ticketsByDay = {};
    const profitByDay = {};
    
    // Calculate day count for initialization
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
    
    // Initialize day tracking
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
    }

    // Fetch revenue from payments (deposits, not refunds) - DASHBOARD ONLY
    try {
      const { data: paymentsData } = await supabaseAdmin
        .from('payments')
        .select('created_at, amount, method')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .neq('method', 'refund')  // Exclude refunds
        .order('created_at', { ascending: false });
      
      if (paymentsData && paymentsData.length > 0) {
        paymentsData.forEach(payment => {
          try {
            const date = payment.created_at?.split('T')[0];
            if (date && revenueByDay.hasOwnProperty(date)) {
              revenueByDay[date] += parseFloat(payment.amount || 0);
            }
          } catch (err) {
            console.error('[DASHBOARD] Error processing payment:', err);
          }
        });
      }
    } catch (paymentsError) {
      console.error('[DASHBOARD] Error fetching payments for revenue:', paymentsError);
    }

    // Calculate daily profit from orders (with pagination)
    let allOrdersForProfit = [];
    let profitPageNum = 0;
    let hasMoreProfit = true;
    
    while (hasMoreProfit) {
      const { data: pageData } = await supabaseAdmin
        .from('orders')
        .select('created_at, charge, original_charge, provider_cost, provider_currency, status, user_id')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .order('created_at', { ascending: false })
        .range(profitPageNum * pageSize, (profitPageNum + 1) * pageSize - 1);
      
      if (!pageData || pageData.length === 0) {
        hasMoreProfit = false;
      } else {
        allOrdersForProfit = allOrdersForProfit.concat(pageData);
        profitPageNum++;
      }
    }
    
    const ordersForProfit = allOrdersForProfit;
    console.log('[DASHBOARD] ordersForProfit count:', ordersForProfit?.length || 0);

    ordersForProfit?.forEach(order => {
      const date = order.created_at.split('T')[0];
      if (profitByDay[date] !== undefined) {
        const income = parseFloat(order.charge || order.original_charge || 0);
        const outcome = parseFloat(order.provider_cost || 0);
        const outcomeUSD = outcome * getConversionRate(order.provider_currency || 'USD');
        let dailyProfit = income - outcomeUSD;
        
        // Cancelled order ise profiti negatif yap (geri al)
        if (order.status === 'cancelled') {
          dailyProfit = -dailyProfit;
        }
        
        profitByDay[date] += dailyProfit;
      }
    });
    
    console.log('[DASHBOARD] profitByDay after calculation:', profitByDay);

    // Calculate detailed users by day (with spending and profit)
    const usersByDayDetailed = {};
    
    // Initialize dates
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      usersByDayDetailed[dateStr] = {};
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Get user username to user_id mapping from users table
    let userUsernameMap = {};
    try {
      const { data: usersMap, error: usersMapError } = await supabaseAdmin
        .from('users')
        .select('id, username');
      
      if (usersMapError) {
        console.error('[DASHBOARD] Error fetching users map:', usersMapError);
      } else if (usersMap) {
        usersMap.forEach(u => {
          userUsernameMap[u.id] = u.username;
        });
      }
    } catch (err) {
      console.error('[DASHBOARD] Error building user username map:', err);
    }
    
    // Aggregate orders by user and date
    ordersForProfit?.forEach(order => {
      try {
        const date = order.created_at?.split('T')[0];
        if (!date || !usersByDayDetailed[date]) return;
        
        const userId = order.user_id;
        const username = userUsernameMap[userId] || 'Unknown';
        
        if (!usersByDayDetailed[date][username]) {
          usersByDayDetailed[date][username] = { username, total_charge: 0, profit: 0 };
        }
        
        const income = parseFloat(order.charge || order.original_charge || 0);
        const outcome = parseFloat(order.provider_cost || 0);
        const outcomeUSD = outcome * getConversionRate(order.provider_currency || 'USD');
        let dailyProfit = income - outcomeUSD;
        
        // Cancelled order ise profiti negatif yap
        if (order.status === 'cancelled') {
          dailyProfit = -dailyProfit;
        }
        
        usersByDayDetailed[date][username].total_charge += income;
        usersByDayDetailed[date][username].profit += dailyProfit;
      } catch (err) {
        console.error('[DASHBOARD] Error processing order for user stats:', err, order);
      }
    });
    
    // Convert to array format for easier processing in frontend
    const usersByDayArray = {};
    Object.entries(usersByDayDetailed).forEach(([date, usersObj]) => {
      usersByDayArray[date] = Object.values(usersObj);
    });
    
    // Calculate daily order values (total charge per day) - Use ordersForProfit data
    const chargeByDay = {};
    
    // Initialize all dates from ordersForProfit same way as profitByDay
    Object.keys(profitByDay).forEach(date => {
      chargeByDay[date] = 0;
    });
    
    // Accumulate charges from the same ordersForProfit data
    ordersForProfit?.forEach(order => {
      const date = order.created_at.split('T')[0];
      if (chargeByDay.hasOwnProperty(date)) {
        const charge = parseFloat(order.charge || order.original_charge || 0);
        chargeByDay[date] += charge;
      }
    });

    ordersForProfit?.forEach(order => {
      const date = order.created_at.split('T')[0];
      // Also count orders
      if (ordersByDay[date] !== undefined) {
        ordersByDay[date] += 1;
      }
    });

    allUsersByDate?.forEach(user => {
      const date = user.created_at.split('T')[0];
      if (usersByDay[date] !== undefined) {
        usersByDay[date] += 1;
      }
    });

    allTicketsByDate?.forEach(ticket => {
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
