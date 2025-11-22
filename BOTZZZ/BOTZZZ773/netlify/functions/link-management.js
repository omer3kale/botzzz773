const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const method = event.httpMethod;
    const path = event.path;
    const body = event.body ? JSON.parse(event.body) : null;
    const pathParts = path.split('/').filter(part => part);
    
    console.log('Link Management API:', method, path, body);

    // GET /api/link-management - Get all links with statistics
    if (method === 'GET' && pathParts.length === 2) {
      try {
        // Get all link management data
        const { data: links, error: linksError } = await supabase
          .from('link_management_dashboard')
          .select('*')
          .order('updated_at', { ascending: false });

        if (linksError) {
          console.error('Error fetching links:', linksError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch links data' })
          };
        }

        // Get statistics
        const { data: stats, error: statsError } = await supabase
          .rpc('get_link_management_stats');

        if (statsError) {
          console.error('Error fetching stats:', statsError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch statistics' })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            links: links || [],
            statistics: stats || {},
            total: links ? links.length : 0
          })
        };
      } catch (error) {
        console.error('Error in GET /api/link-management:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Internal server error' })
        };
      }
    }

    // PUT /api/link-management/:id - Update a link
    else if (method === 'PUT' && pathParts.length === 3) {
      const linkId = pathParts[2];
      
      if (!body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Request body is required' })
        };
      }

      const { url, service_name, status, conflict_reason } = body;

      try {
        const { data, error } = await supabase
          .from('link_management')
          .update({
            url,
            service_name,
            status,
            conflict_reason,
            updated_at: new Date().toISOString()
          })
          .eq('id', linkId)
          .select();

        if (error) {
          console.error('Error updating link:', error);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to update link' })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, data })
        };
      } catch (error) {
        console.error('Error in PUT /api/link-management:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Internal server error' })
        };
      }
    }

    // DELETE /api/link-management/:id - Delete a link
    else if (method === 'DELETE' && pathParts.length === 3) {
      const linkId = pathParts[2];

      try {
        // First, unlink all orders from this link
        const { error: unlinkError } = await supabase
          .from('orders')
          .update({ link_id: null })
          .eq('link_id', linkId);

        if (unlinkError) {
          console.error('Error unlinking orders:', unlinkError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to unlink orders' })
          };
        }

        // Then delete the link
        const { error: deleteError } = await supabase
          .from('link_management')
          .delete()
          .eq('id', linkId);

        if (deleteError) {
          console.error('Error deleting link:', deleteError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to delete link' })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true })
        };
      } catch (error) {
        console.error('Error in DELETE /api/link-management:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Internal server error' })
        };
      }
    }

    // POST /api/link-management/merge - Merge conflicted links
    else if (method === 'POST' && pathParts.length === 3 && pathParts[2] === 'merge') {
      if (!body || !body.sourceId || !body.targetId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'sourceId and targetId are required' })
        };
      }

      try {
        const { data, error } = await supabase
          .rpc('merge_link_orders', { target_link_id: body.targetId });

        if (error) {
          console.error('Error merging links:', error);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to merge links' })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, result: data })
        };
      } catch (error) {
        console.error('Error in POST /api/link-management/merge:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Internal server error' })
        };
      }
    }

    // POST /api/link-management/auto-resolve - Auto-resolve all conflicts
    else if (method === 'POST' && pathParts.length === 3 && pathParts[2] === 'auto-resolve') {
      try {
        // Get all conflicted links grouped by URL hash
        const { data: conflictedLinks, error: conflictError } = await supabase
          .from('link_management')
          .select('*')
          .eq('status', 'conflicted');

        if (conflictError) {
          console.error('Error fetching conflicted links:', conflictError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch conflicted links' })
          };
        }

        let resolvedCount = 0;

        // Group by URL hash and resolve conflicts
        const urlGroups = {};
        conflictedLinks.forEach(link => {
          if (!urlGroups[link.url_hash]) {
            urlGroups[link.url_hash] = [];
          }
          urlGroups[link.url_hash].push(link);
        });

        // For each URL group, merge into the oldest link
        for (const urlHash in urlGroups) {
          const links = urlGroups[urlHash];
          if (links.length > 1) {
            // Sort by creation date to find the oldest
            links.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            const targetLink = links[0];

            // Merge all other links into the target
            const { data, error } = await supabase
              .rpc('merge_link_orders', { target_link_id: targetLink.id });

            if (!error) {
              resolvedCount += links.length - 1;
            }
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, resolved: resolvedCount })
        };
      } catch (error) {
        console.error('Error in POST /api/link-management/auto-resolve:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Internal server error' })
        };
      }
    }

    // Unsupported endpoint
    else {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Endpoint not found' })
      };
    }

  } catch (error) {
    console.error('Unexpected error in link-management function:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};