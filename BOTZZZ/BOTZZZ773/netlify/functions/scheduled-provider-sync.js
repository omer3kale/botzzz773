/**
 * Scheduled Provider Sync - Runs Daily
 * Automatically syncs services from all active providers
 * Handles errors gracefully without breaking the site
 */

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Retry logic with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`[RETRY] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Fetch services from provider API with timeout
async function fetchProviderServices(provider, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(provider.api_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: provider.api_key,
        action: 'services'
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Provider API returned ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('Provider API timeout after 30 seconds');
    }
    throw error;
  }
}

// Sync services for a single provider
async function syncProviderServices(provider) {
  console.log(`[SYNC] Starting sync for ${provider.name}...`);
  
  try {
    // Fetch services with retry
    const servicesData = await retryWithBackoff(() => 
      fetchProviderServices(provider)
    );
    
    if (!Array.isArray(servicesData)) {
      throw new Error('Invalid services data format');
    }
    
    let added = 0;
    let updated = 0;
    let errors = 0;
    
    // Sync each service
    for (const service of servicesData) {
      try {
        const { data, error } = await supabaseAdmin
          .from('services')
          .upsert({
            provider_id: provider.id,
            provider_service_id: service.service,
            name: service.name,
            category: service.category || 'other',
            rate: parseFloat(service.rate) || 0,
            min_quantity: parseInt(service.min) || 10,
            max_quantity: parseInt(service.max) || 1000000,
            description: service.description || '',
            status: 'active',
            currency: provider.currency || 'USD',
            average_time: service.average_time || null,
            refill_supported: Boolean(service.refill),
            cancel_supported: Boolean(service.cancel),
            dripfeed_supported: Boolean(service.dripfeed),
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'provider_id,provider_service_id'
          });
        
        if (error) {
          console.error(`[ERROR] Failed to upsert service ${service.service}:`, error);
          errors++;
        } else {
          if (data?.length > 0) {
            updated++;
          } else {
            added++;
          }
        }
      } catch (serviceError) {
        console.error(`[ERROR] Service sync failed:`, serviceError);
        errors++;
      }
    }
    
    // Update provider last sync time
    await supabaseAdmin
      .from('providers')
      .update({ 
        last_sync: new Date().toISOString(),
        health_status: 'healthy'
      })
      .eq('id', provider.id);
    
    console.log(`[SUCCESS] ${provider.name}: ${added} added, ${updated} updated, ${errors} errors`);
    
    return { success: true, added, updated, errors, total: servicesData.length };
    
  } catch (error) {
    // Mark provider as unhealthy but don't fail
    await supabaseAdmin
      .from('providers')
      .update({ health_status: 'error' })
      .eq('id', provider.id);
    
    console.error(`[ERROR] ${provider.name} sync failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// Main handler
exports.handler = async (event, context) => {
  console.log('[SCHEDULED SYNC] Starting daily provider sync...');
  
  try {
    // Get all active providers
    const { data: providers, error } = await supabaseAdmin
      .from('providers')
      .select('*')
      .eq('status', 'active');
    
    if (error) {
      console.error('[ERROR] Failed to fetch providers:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch providers' })
      };
    }
    
    if (!providers || providers.length === 0) {
      console.log('[INFO] No active providers to sync');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No providers to sync' })
      };
    }
    
    // Sync all providers (in parallel for speed)
    const results = await Promise.allSettled(
      providers.map(provider => syncProviderServices(provider))
    );
    
    // Compile summary
    const summary = {
      total_providers: providers.length,
      successful: 0,
      failed: 0,
      results: []
    };
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        summary.successful++;
        summary.results.push({
          provider: providers[index].name,
          status: 'success',
          ...result.value
        });
      } else {
        summary.failed++;
        summary.results.push({
          provider: providers[index].name,
          status: 'failed',
          error: result.reason?.message || result.value?.error || 'Unknown error'
        });
      }
    });
    
    console.log('[COMPLETE] Sync finished:', summary);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Provider sync completed',
        summary
      })
    };
    
  } catch (error) {
    console.error('[FATAL] Scheduled sync failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        success: false,
        error: 'Scheduled sync failed',
        details: error.message 
      })
    };
  }
};
