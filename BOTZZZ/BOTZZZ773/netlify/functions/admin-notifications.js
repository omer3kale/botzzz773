// Netlify Function - Admin Notifications API
// Handles fetching, marking as read, and deleting notifications

const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('./utils/supabase');

const JWT_SECRET = process.env.JWT_SECRET;

const ALLOWED_ORIGINS = ['https://www.botzzz773.pro', 'https://botzzz773.pro'];
function getCorsOrigin(event) {
    const origin = event?.headers?.origin || '';
    return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function getUserFromToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': getCorsOrigin(event),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const authHeader = event.headers.authorization;
        const user = getUserFromToken(authHeader);

        if (!user) {
            return {
                statusCode: 401,
                headers,
                body: JSON.stringify({ error: 'Unauthorized' })
            };
        }

        if (user.role !== 'admin') {
            return {
                statusCode: 403,
                headers,
                body: JSON.stringify({ error: 'Forbidden' })
            };
        }

        const action = event.queryStringParameters?.action || 'getAll';
        const notificationId = event.queryStringParameters?.id;

        switch (action) {
            case 'getAll':
                return await getAllNotifications(headers);

            case 'getUnreadCount':
                return await getUnreadCount(headers);

            case 'markAsRead':
                return await markAsRead(notificationId, headers);

            case 'markAllAsRead':
                return await markAllAsRead(headers);

            case 'delete':
                return await deleteNotification(notificationId, headers);

            case 'deleteAll':
                return await deleteAllNotifications(headers);

            default:
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ error: 'Invalid action' })
                };
        }
    } catch (error) {
        console.error('[admin-notifications] Error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};

async function getAllNotifications(headers) {
    try {
        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.error('[getAllNotifications] Error:', error);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ notifications: [], error: error.message })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
                notifications: data || [],
                total: data?.length || 0
            })
        };
    } catch (error) {
        console.error('[getAllNotifications] Exception:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ notifications: [] })
        };
    }
}

async function getUnreadCount(headers) {
    try {
        const { count, error } = await supabaseAdmin
            .from('admin_notifications')
            .select('*', { count: 'exact' })
            .eq('read', false);

        if (error) {
            console.error('[getUnreadCount] Error:', error);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ unreadCount: 0 })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ unreadCount: count || 0 })
        };
    } catch (error) {
        console.error('[getUnreadCount] Exception:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ unreadCount: 0 })
        };
    }
}

async function markAsRead(notificationId, headers) {
    try {
        if (!notificationId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing notification ID' })
            };
        }

        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .update({
                read: true,
                read_at: new Date().toISOString()
            })
            .eq('id', notificationId)
            .select();

        if (error) {
            console.error('[markAsRead] Error:', error);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: false, error: error.message })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, data })
        };
    } catch (error) {
        console.error('[markAsRead] Exception:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}

async function markAllAsRead(headers) {
    try {
        const { error } = await supabaseAdmin
            .from('admin_notifications')
            .update({
                read: true,
                read_at: new Date().toISOString()
            })
            .eq('read', false);

        if (error) {
            console.error('[markAllAsRead] Error:', error);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: false, error: error.message })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        };
    } catch (error) {
        console.error('[markAllAsRead] Exception:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}

async function deleteNotification(notificationId, headers) {
    try {
        if (!notificationId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing notification ID' })
            };
        }

        const { error } = await supabaseAdmin
            .from('admin_notifications')
            .delete()
            .eq('id', notificationId);

        if (error) {
            console.error('[deleteNotification] Error:', error);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: false, error: error.message })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        };
    } catch (error) {
        console.error('[deleteNotification] Exception:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}

async function deleteAllNotifications(headers) {
    try {
        const { error } = await supabaseAdmin
            .from('admin_notifications')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (error) {
            console.error('[deleteAllNotifications] Error:', error);
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: false, error: error.message })
            };
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true })
        };
    } catch (error) {
        console.error('[deleteAllNotifications] Exception:', error);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
}
