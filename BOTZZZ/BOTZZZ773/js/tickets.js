// Tickets System
let currentTicket = null;
let isPopupMode = false;
let authGuardTriggered = false;

const AUTH_ALERT_MESSAGE = 'You must be signed in to access support tickets. Please sign in or create an account.';

// Toast notification system
function showToast(message, type = 'error') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = 'position: fixed; top: 20px; right: 20px; background: ' + (type === 'error' ? '#dc2626' : '#16a34a') + '; color: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); z-index: 10000; max-width: 400px; animation: slideIn 0.3s ease;';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Normalize backend response keys to camelCase
function normalizeTicket(ticket) {
    return {
        ...ticket,
        createdAt: ticket.created_at || ticket.createdAt,
        updatedAt: ticket.updated_at || ticket.updatedAt,
        userId: ticket.user_id || ticket.userId,
        orderId: ticket.order_id || ticket.orderId,
        lastReplyBy: ticket.last_reply_by || ticket.lastReplyBy
    };
}

function normalizeMessage(message) {
    return {
        ...message,
        ticketId: message.ticket_id || message.ticketId,
        userId: message.user_id || message.userId,
        isAdmin: message.is_admin || message.isAdmin,
        createdAt: message.created_at || message.createdAt
    };
}

// Category subcategories mapping
const categorySubcategories = {
    orders: ['Refill', 'Cancel', 'Speed'],
    payment: [],
    other: []
};

// Tickets array - loaded from backend
let tickets = [];

// Load tickets from backend
async function loadTickets(ticketId = null) {
    const ticketsList = document.getElementById('ticketsList');
    
    // Set loading state
    if (ticketsList) {
        ticketsList.setAttribute('aria-busy', 'true');
    }
    
    try {
        const token = resolveAuthToken('load-tickets');
        if (!token) {
            if (ticketsList) {
                ticketsList.innerHTML = '<div class="empty-state"><p>Please sign in to view your support tickets</p></div>';
                ticketsList.setAttribute('aria-busy', 'false');
            }
            return;
        }
        
        // Support loading single ticket via query parameter
        const url = ticketId 
            ? `/.netlify/functions/tickets?ticketId=${encodeURIComponent(ticketId)}`
            : '/.netlify/functions/tickets';
        
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (ticketId && data.ticket) {
                // Single ticket loaded - normalize keys
                currentTicket = normalizeTicket(data.ticket);
                if (currentTicket.messages) {
                    currentTicket.messages = currentTicket.messages.map(normalizeMessage);
                }
                renderTicketDetails();
            } else if (data.tickets) {
                // Multiple tickets loaded - normalize all keys
                tickets = data.tickets.map(normalizeTicket);
            }
        } else {
            console.error('Failed to load tickets:', data.error);
            showToast(data.error || 'Failed to load tickets', 'error');
            if (ticketsList) {
                ticketsList.innerHTML = `<div class="empty-state"><p>${data.error || 'Failed to load tickets'}</p></div>`;
            }
        }
    } catch (error) {
        console.error('Failed to load tickets:', error);
        if (ticketsList) {
            ticketsList.innerHTML = '<div class="empty-state"><p>Failed to load tickets. Please try again.</p></div>';
        }
    } finally {
        if (ticketsList) {
            ticketsList.setAttribute('aria-busy', 'false');
        }
    }
}

// Save new ticket to backend
async function saveTicket(ticketData) {
    try {
        const token = resolveAuthToken('create-ticket');
        if (!token) {
            return false;
        }
        
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(ticketData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Add new ticket to local array - normalize keys
            const normalizedTicket = normalizeTicket(data.ticket);
            tickets.unshift(normalizedTicket);
            notifyOpener({ type: 'TICKET_CREATED', ticketId: normalizedTicket?.id });
            showToast('Ticket created successfully!', 'success');
            return true;
        } else {
            showToast(data.error || 'Failed to create ticket', 'error');
            return false;
        }
    } catch (error) {
        console.error('Failed to save ticket:', error);
        showToast('Failed to create ticket. Please try again.', 'error');
        return false;
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    isPopupMode = urlParams.get('popup') === '1';
    const ticketId = urlParams.get('ticketId'); // Support loading single ticket from URL
    
    if (isPopupMode) {
        enablePopupSurface();
    }

    if (!resolveAuthToken('initial-load')) {
        return;
    }

    // Load single ticket if ticketId provided, otherwise load all
    if (ticketId) {
        await loadTickets(ticketId);
    } else {
        await loadTickets();
        renderTickets();
    }
    
    setupCategoryChange();
    setupFilterButtons();
    setupNewTicketForm();
});

// Render tickets list
function renderTickets(filter = 'all') {
    const ticketsList = document.getElementById('ticketsList');
    
    // Guard for missing element
    if (!ticketsList) {
        console.warn('ticketsList element not found');
        return;
    }
    
    let filteredTickets = tickets;
    if (filter !== 'all') {
        filteredTickets = tickets.filter(t => t.status === filter);
    }

    if (filteredTickets.length === 0) {
        // Professional empty state with CTA button
        const emptyMessage = filter === 'all' 
            ? 'You don\'t have any tickets yet' 
            : `No ${filter} tickets found`;
        const showCTA = filter === 'all';
        
        ticketsList.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 60px 20px;">
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1" style="margin-bottom: 20px;">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <p style="color: rgba(255, 255, 255, 0.6); font-size: 16px; margin-bottom: ${showCTA ? '24px' : '0'};">${emptyMessage}</p>
                ${showCTA ? '<button class="btn-primary" onclick="openNewTicketModal()">Create Your First Ticket</button>' : ''}
            </div>
        `;
        return;
    }

    ticketsList.innerHTML = filteredTickets.map(ticket => `
        <div class="ticket-item ${currentTicket?.id === ticket.id ? 'active' : ''}" onclick="selectTicket('${ticket.id}')">
            <div class="ticket-item-header">
                <span class="ticket-id">#${ticket.short_id || ticket.id}</span>
                <span class="ticket-status ${ticket.status}">${ticket.status}</span>
            </div>
            <div class="ticket-subject">${ticket.subject}</div>
            <div class="ticket-meta">
                <span class="ticket-category">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M20 7h-9M14 17H5M3 12h18"/>
                    </svg>
                    ${ticket.category}
                </span>
                <span class="ticket-date">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${formatDate(ticket.updatedAt)}
                </span>
            </div>
        </div>
    `).join('');
}

// Select ticket
async function selectTicket(ticketId) {
    const ticket = tickets.find(t => t.id === ticketId);
    currentTicket = ticket;
    
    // Send short_id to API instead of UUID
    const shortId = ticket.short_id || ticket.id.substring(0, 6);
    
    // Fetch full ticket details including messages
    try {
        const response = await fetch(`/.netlify/functions/tickets?shortId=${encodeURIComponent(shortId)}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.ticket) {
                currentTicket = data.ticket;
                
                // Update notification badges if ticket was marked as read
                if (window.checkUnreadTickets) {
                    window.checkUnreadTickets();
                }
            }
        }
    } catch (error) {
        console.error('Error loading ticket details:', error);
    }
    
    renderTicketDetails();
    renderTickets(); // Re-render to update active state
}

// Render ticket details
function renderTicketDetails() {
    const emptyState = document.getElementById('emptyState');
    const ticketDetails = document.getElementById('ticketDetails');

    if (!currentTicket) {
        emptyState.style.display = 'flex';
        ticketDetails.style.display = 'none';
        ticketDetails.setAttribute('aria-live', 'off');
        return;
    }

    emptyState.style.display = 'none';
    ticketDetails.style.display = 'block';
    // Announce ticket selection to screen readers
    ticketDetails.setAttribute('aria-live', 'polite');

    ticketDetails.innerHTML = `
        <div class="ticket-details-header">
            <div class="ticket-details-info">
                <div class="ticket-details-id">#${currentTicket.short_id || currentTicket.id}</div>
                <h2 class="ticket-details-subject">${currentTicket.subject}</h2>
                <div class="ticket-details-meta">
                    <div class="ticket-details-meta-item">
                        <span class="category-badge">
                            ${currentTicket.category}
                            ${currentTicket.subcategory ? ` → ${currentTicket.subcategory}` : ''}
                        </span>
                    </div>
                    <div class="ticket-details-meta-item">
                        <strong>Status:</strong>
                        <span class="ticket-status ${currentTicket.status}">${currentTicket.status}</span>
                    </div>
                    ${currentTicket.order_id ? `
                        <div class="ticket-details-meta-item">
                            <strong>Order:</strong> #${currentTicket.order?.order_number || currentTicket.order_id}
                        </div>
                    ` : ''}
                    <div class="ticket-details-meta-item">
                        <strong>Created:</strong> ${formatDate(currentTicket.created_at)}
                    </div>
                </div>
            </div>
        </div>

        <div class="ticket-messages">
            ${(currentTicket.messages || []).map(message => {
                const isAdmin = message.is_admin || false;
                const author = isAdmin ? 'Support Team' : (currentTicket.user?.username || currentTicket.user?.email || 'User');
                const firstLetter = author.charAt(0).toUpperCase();
                return `
                <div class="message ${isAdmin ? 'admin' : ''}">
                    <div class="message-header">
                        <div class="message-author">
                            <div class="message-avatar">
                                ${firstLetter}
                            </div>
                            <div class="message-author-info">
                                <div class="message-author-name">${author}</div>
                                ${isAdmin ? '<div class="message-author-role">Support Team</div>' : ''}
                            </div>
                        </div>
                        <div class="message-date">${formatDate(message.created_at)}</div>
                    </div>
                    <div class="message-content">${message.message}</div>
                </div>
                `;
            }).join('')}
        </div>

        ${currentTicket.status !== 'closed' ? `
            <div class="reply-form">
                <h3>Reply to Ticket</h3>
                <textarea id="replyMessage" placeholder="Type your message here..."></textarea>
                <div class="reply-form-actions">
                    <button type="button" class="btn-secondary" onclick="closeTicket()">Close Ticket</button>
                    <button type="button" class="btn-primary" onclick="sendReply()">Send Reply</button>
                </div>
            </div>
        ` : `
            <div class="reply-form">
                <p style="color: rgba(255, 255, 255, 0.6); text-align: center;">This ticket is closed.</p>
            </div>
        `}
    `;
}

// Send reply to backend
async function sendReply() {
    const replyMessage = document.querySelector('#replyMessage');
    const message = replyMessage.value.trim();

    if (!message) {
        alert('Please enter a message');
        return;
    }

    try {
        const token = resolveAuthToken('reply-ticket');
        if (!token) {
            return;
        }
        
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'reply',
                ticketId: currentTicket.id,
                message: message
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Reload ticket from backend to sync status, timestamps, and messages
            await loadTickets(currentTicket.id);
            // Also reload the full tickets list to update timestamps
            await loadTickets();
            renderTickets();
            showToast('Reply sent successfully', 'success');
            notifyOpener({ type: 'TICKET_REPLIED', ticketId: currentTicket.id });
        } else {
            showToast(data.error || 'Failed to send reply', 'error');
        }
    } catch (error) {
        console.error('Failed to send reply:', error);
        showToast('Failed to send reply. Please try again.', 'error');
    }
}

// Close ticket via backend
async function closeTicket() {
    if (!confirm('Are you sure you want to close this ticket?')) return;
    
    try {
        const token = resolveAuthToken('close-ticket');
        if (!token) {
            return;
        }
        
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'close',
                ticketId: currentTicket.id
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentTicket.status = 'closed';
            currentTicket.updatedAt = new Date().toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            renderTickets();
            renderTicketDetails();
            showToast('Ticket closed successfully', 'success');
            notifyOpener({ type: 'TICKET_CLOSED', ticketId: currentTicket.id });
        } else {
            showToast(data.error || 'Failed to close ticket', 'error');
        }
    } catch (error) {
        console.error('Failed to close ticket:', error);
        showToast('Failed to close ticket. Please try again.', 'error');
    }
}

// Setup filter buttons
function setupFilterButtons() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Update aria-pressed and active state for accessibility
            filterBtns.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-pressed', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-pressed', 'true');
            
            const status = btn.dataset.status;
            renderTickets(status);
        });
    });
}

// Modal functions
let modalTriggerButton = null;

function openNewTicketModal() {
    const modal = document.getElementById('newTicketModal');
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    
    // Store reference to trigger button for focus restoration
    modalTriggerButton = document.activeElement;
    
    // Move focus to first input for keyboard accessibility
    setTimeout(() => {
        const firstInput = document.getElementById('ticketCategory');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closeNewTicketModal() {
    const modal = document.getElementById('newTicketModal');
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('newTicketForm').reset();
    document.getElementById('subcategoryGroup').style.display = 'none';
    document.getElementById('orderIdGroup').style.display = 'none';
    
    // Restore focus to trigger button for keyboard accessibility
    if (modalTriggerButton) {
        modalTriggerButton.focus();
        modalTriggerButton = null;
    }
}

// Setup category change
function setupCategoryChange() {
    const categorySelect = document.getElementById('ticketCategory');
    const subcategoryGroup = document.getElementById('subcategoryGroup');
    const subcategorySelect = document.getElementById('ticketSubcategory');
    const orderIdGroup = document.getElementById('orderIdGroup');

    categorySelect.addEventListener('change', (e) => {
        const category = e.target.value;
        
        if (category === 'orders') {
            // Show subcategory for orders
            subcategoryGroup.style.display = 'block';
            subcategorySelect.innerHTML = '<option value="">Select Subcategory</option>' +
                categorySubcategories.orders.map(sub => `<option value="${sub}">${sub}</option>`).join('');
            subcategorySelect.required = true;
            
            // Show order ID field
            orderIdGroup.style.display = 'block';
        } else {
            // Hide subcategory for payment and other
            subcategoryGroup.style.display = 'none';
            subcategorySelect.required = false;
            
            // Hide order ID field for non-order categories
            if (category !== 'orders') {
                orderIdGroup.style.display = 'none';
            }
        }
    });
}

// Setup new ticket form
function setupNewTicketForm() {
    const form = document.getElementById('newTicketForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const category = document.getElementById('ticketCategory').value;
        
        // Inline validation for category
        if (!category) {
            showToast('Please select a category', 'error');
            document.getElementById('ticketCategory').focus();
            return;
        }
        
        const subcategory = document.getElementById('ticketSubcategory').value;
        const subject = document.getElementById('ticketSubject').value;
        const message = document.getElementById('ticketMessage').value;
        const orderId = document.getElementById('ticketOrderId').value;

        const ticketData = {
            subject: subject,
            category: category.charAt(0).toUpperCase() + category.slice(1),
            subcategory: subcategory || null,
            orderId: orderId || null,
            message: message
        };

        const success = await saveTicket(ticketData);
        
        if (success) {
            closeNewTicketModal();
            renderTickets();
            // Auto-select the newly created ticket
            if (tickets.length > 0) {
                selectTicket(tickets[0].id);
            }
        }
    });
}

// Format date with safe fallback for invalid dates
function formatDate(dateStr) {
    if (!dateStr) return '—';
    
    const date = new Date(dateStr);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
        return '—';
    }
    
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
        return 'Just now';
    } else if (diffMins < 60) {
        return `${diffMins}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else {
        return dateStr.split(' ')[0] || '—';
    }
}

function resolveAuthToken(reason) {
    const token = getAuthToken();
    if (!token) {
        handleMissingAuth(reason);
    }
    return token;
}

function getAuthToken() {
    return localStorage.getItem('token');
}

function handleMissingAuth(reason) {
    if (authGuardTriggered) {
        return;
    }
    authGuardTriggered = true;

    const payload = { type: 'AUTH_REQUIRED', source: 'tickets', reason };
    if (isPopupMode) {
        notifyOpener(payload);
        setTimeout(() => {
            try {
                window.close();
            } catch (error) {
                console.warn('Failed to close tickets popup after auth guard.', error);
            }
        }, 200);
        return;
    }

    showToast(AUTH_ALERT_MESSAGE, 'error');
    const redirectTarget = buildRedirectTarget();
    // Delay redirect slightly so user sees the toast
    setTimeout(() => {
        window.location.href = `signin.html?redirect=${encodeURIComponent(redirectTarget)}`;
    }, 1500);
}

function buildRedirectTarget() {
    const path = window.location.pathname.replace(/^\//, '');
    const search = window.location.search || '';
    return search ? `${path}${search}` : path;
}

function enablePopupSurface() {
    document.body.classList.add('popup-mode');

    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Support tickets window');
        panel.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => panel.focus());
    }

    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.addEventListener('click', handlePopupClose);
    }

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            handlePopupClose();
        }
    });
}

function handlePopupClose() {
    if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
    }

    document.body.classList.remove('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.removeAttribute('role');
        panel.removeAttribute('aria-modal');
        panel.removeAttribute('tabindex');
    }
    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.style.display = 'none';
    }
}

function notifyOpener(payload) {
    if (!isPopupMode || !window.opener || window.opener.closed) {
        return;
    }
    window.opener.postMessage(payload, window.location.origin);
}
