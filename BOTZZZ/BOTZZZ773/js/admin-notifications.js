// Admin Notifications Management
// Fetch, display, and manage notifications in the dropdown menu

let notificationsCache = [];
let notificationsRefreshInterval;

/**
 * Toggle notification dropdown menu
 */
function toggleNotificationMenu(event) {
    console.log('[Notification] Toggle called', event);
    event?.stopPropagation?.();
    const dropdown = document.getElementById('notificationDropdown');
    console.log('[Notification] Dropdown element:', dropdown);
    if (dropdown) {
        dropdown.classList.toggle('show');
        console.log('[Notification] Show class:', dropdown.classList.contains('show'));
        if (dropdown.classList.contains('show')) {
            loadAndDisplayNotifications();
        }
    }
}

/**
 * Close notification menu
 */
function closeNotificationMenu() {
    const dropdown = document.getElementById('notificationDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
}

/**
 * Load notifications from server
 */
async function loadAndDisplayNotifications() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            console.warn('[Notifications] No auth token');
            return;
        }

        const url = new URL('/.netlify/functions/admin-notifications', window.location.origin);
        const response = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            console.error('[Notifications] Fetch failed:', response.status);
            return;
        }

        const data = await response.json();
        notificationsCache = data.notifications || [];
        
        displayNotifications(notificationsCache);
        updateNotificationBadge();
    } catch (error) {
        console.error('[Notifications] Load error:', error);
    }
}

/**
 * Display notifications in dropdown
 */
function displayNotifications(notifications) {
    const content = document.getElementById('notificationContent');
    if (!content) return;

    if (!notifications || notifications.length === 0) {
        content.innerHTML = `
            <div class="notification-empty">
                <i class="fas fa-inbox"></i>
                <p>No notifications</p>
            </div>
        `;
        return;
    }

    content.innerHTML = notifications.map(notif => renderNotificationItem(notif)).join('');
}

/**
 * Render a single notification item
 */
function renderNotificationItem(notification) {
    const { id, notification_type, title, message, read, created_at, data } = notification;
    
    const icon = getNotificationIcon(notification_type);
    const timeStr = formatTimeAgo(created_at);
    const unreadClass = !read ? 'unread' : '';
    
    return `
        <div class="notification-item ${unreadClass}" data-id="${id}" onclick="markNotificationAsRead('${id}')">
            <div class="notification-item-icon ${notification_type}">
                ${icon}
            </div>
            <div class="notification-item-content">
                <div class="notification-item-title">${escapeHtml(title)}</div>
                <div class="notification-item-message">${escapeHtml(message)}</div>
                <div class="notification-item-time">${timeStr}</div>
            </div>
            <div class="notification-item-actions">
                <button class="notification-item-btn delete" onclick="deleteNotification(event, '${id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

/**
 * Get icon for notification type
 */
function getNotificationIcon(type) {
    switch (type) {
        case 'low_balance':
            return '<i class="fas fa-exclamation-circle"></i>';
        case 'failed_order':
            return '<i class="fas fa-times-circle"></i>';
        case 'payment':
            return '<i class="fas fa-check-circle"></i>';
        case 'new_user':
            return '<i class="fas fa-user-plus"></i>';
        default:
            return '<i class="fas fa-bell"></i>';
    }
}

/**
 * Format time ago string
 */
function formatTimeAgo(dateStr) {
    if (!dateStr) return 'Unknown';
    
    const date = new Date(dateStr);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
    
    return date.toLocaleDateString();
}

/**
 * Update notification badge count
 */
async function updateNotificationBadge() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const url = new URL('/.netlify/functions/admin-notifications', window.location.origin);
        url.searchParams.append('action', 'getUnreadCount');
        
        const response = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return;

        const data = await response.json();
        const count = Number(data.unreadCount || 0);
        const badge = document.getElementById('notificationBadge');
        
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    } catch (error) {
        console.error('[Badge] Update error:', error);
    }
}

/**
 * Mark single notification as read
 */
async function markNotificationAsRead(notificationId) {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const url = new URL('/.netlify/functions/admin-notifications', window.location.origin);
        url.searchParams.append('action', 'markAsRead');
        url.searchParams.append('id', notificationId);
        
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            // Reload notifications
            await loadAndDisplayNotifications();
        }
    } catch (error) {
        console.error('[MarkAsRead] Error:', error);
    }
}

/**
 * Mark all notifications as read
 */
async function markAllNotificationsAsRead() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const url = new URL('/.netlify/functions/admin-notifications', window.location.origin);
        url.searchParams.append('action', 'markAllAsRead');
        
        const response = await fetch(url.toString(), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            await loadAndDisplayNotifications();
        }
    } catch (error) {
        console.error('[MarkAllAsRead] Error:', error);
    }
}

/**
 * Delete a notification
 */
async function deleteNotification(event, notificationId) {
    event.stopPropagation();
    
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const url = new URL('/.netlify/functions/admin-notifications', window.location.origin);
        url.searchParams.append('action', 'delete');
        url.searchParams.append('id', notificationId);
        
        const response = await fetch(url.toString(), {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            await loadAndDisplayNotifications();
        }
    } catch (error) {
        console.error('[Delete] Error:', error);
    }
}

/**
 * Clear all notifications
 */
async function clearAllNotifications() {
    if (!confirm('Delete all notifications? This cannot be undone.')) {
        return;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const url = new URL('/.netlify/functions/admin-notifications', window.location.origin);
        url.searchParams.append('action', 'deleteAll');
        
        const response = await fetch(url.toString(), {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            await loadAndDisplayNotifications();
        }
    } catch (error) {
        console.error('[ClearAll] Error:', error);
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Initialize notifications system
 */
function initializeNotifications() {
    // Close menu when clicking outside
    document.addEventListener('click', (event) => {
        const wrapper = document.querySelector('.admin-notifications-wrapper');
        const dropdown = document.getElementById('notificationDropdown');
        
        if (!wrapper?.contains(event.target)) {
            closeNotificationMenu();
        }
    });

    // Initial load of badge count
    updateNotificationBadge();

    // Refresh badge count every 30 seconds
    notificationsRefreshInterval = setInterval(updateNotificationBadge, 30000);

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (notificationsRefreshInterval) {
            clearInterval(notificationsRefreshInterval);
        }
    });
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initializeNotifications);
