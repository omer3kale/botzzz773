const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function handleServices() {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, type, category, rate, min_order, max_order, refill, cancel')
      .eq('status', true)
      .order('id', { ascending: true });

    if (error) {
      console.error('Services fetch error:', error);
      return [];
    }

    return data.map(service => ({
      service: service.id,
      name: service.name,
      type: 'service',
      category: service.category,
      rate: String(service.rate),
      min: String(service.min_order),
      max: String(service.max_order),
      refill: service.refill,
      cancel: service.cancel
    }));
  } catch (err) {
    console.error('Services error:', err);
    return [];
  }
}

exports.handler = async (event) => {
  try {
    console.log('API function called');
    const services = await handleServices();
    console.log('Services fetched:', services.length);
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(services)
    };
  } catch (error) {
    console.error('API error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
