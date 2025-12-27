// Admin Tickets Management with Real Modals
window.initializeAdminPopupSurface?.('Admin tickets window');

let ticketsCache = [];
const selectedTicketIds = new Set();
let ticketsLoading = false;
let unreadFilterActive = false;
let lastTicketsRefreshAt = null;

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getTicketById(ticketId) {
    const idString = String(ticketId);
    return ticketsCache.find(ticket => getTicketSelectionKey(ticket) === idString);
}

function getTicketDisplayLabel(ticket) {
    if (!ticket) {
        return '';
    }
    const subject = ticket.subject ? ticket.subject.trim() : '';
    const status = ticket.status ? ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1) : 'Unknown';
    const ticketId = ticket.short_id ? `#${ticket.short_id}` : (ticket.id != null ? `#${ticket.id}` : 'Ticket');
    if (subject) {
        return `${ticketId} • ${subject.length > 36 ? `${subject.substring(0, 33)}...` : subject}`;
    }
    return `${ticketId} • ${status}`;
}

function getTicketSelectionKey(ticket) {
    if (!ticket) {
        return '';
    }
    if (ticket.short_id != null) {
        return String(ticket.short_id);
    }
    if (ticket.id != null) {
        return String(ticket.id);
    }
    const subject = (ticket.subject || 'ticket').toLowerCase().replace(/\s+/g, '-');
    const timestamp = ticket.created_at || ticket.updated_at || Date.now();
    return `${subject}-${timestamp}`;
}

function setTicketsRefreshStatus(message) {
    const statusEl = document.getElementById('ticketsRefreshStatus');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function attachTicketsQuickActionCard(element, handler) {
    if (!element || typeof handler !== 'function') {
        return;
    }
    element.addEventListener('click', handler);
    element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handler();
        }
    });
}

function updateUnreadQuickCardState() {
    const cardEl = document.getElementById('unreadTicketsCard');
    const statusEl = document.getElementById('unreadTicketsStatus');
    const unreadCount = ticketsCache.filter(ticket => {
        const status = (ticket.status || '').toLowerCase();
        return status === 'open';
    }).length;

    if (statusEl) {
        if (unreadCount === 0) {
            statusEl.textContent = unreadFilterActive ? 'No unread tickets' : 'No unread available';
        } else if (unreadFilterActive) {
            statusEl.textContent = `Showing ${unreadCount} unread`;
        } else {
            statusEl.textContent = `${unreadCount} unread ready`;
        }
    }

    if (cardEl) {
        cardEl.classList.toggle('is-active', unreadFilterActive);
        cardEl.setAttribute('aria-pressed', unreadFilterActive ? 'true' : 'false');
    }
}

function updateSelectedTicketsSummary() {
    const countEl = document.getElementById('selectedTicketsCount');
    const detailEl = document.getElementById('selectedTicketsDetail');
    const cardEl = document.getElementById('selectedTicketsCard');
    const bulkActionsContainer = document.getElementById('bulkActionsContainer');

    const count = selectedTicketIds.size;
    
    // Update bulk actions visibility regardless of other elements
    if (bulkActionsContainer) {
        bulkActionsContainer.style.display = count > 0 ? 'block' : 'none';
    }

    // If quick action cards don't exist, skip updating them
    if (!countEl || !detailEl || !cardEl) {
        return;
    }

    countEl.textContent = `${count} selected`;

    if (count === 0) {
        detailEl.textContent = 'Choose tickets from the table to review, reply, or close them in bulk.';
    } else {
        const labels = [];
        selectedTicketIds.forEach(id => {
            const label = getTicketDisplayLabel(getTicketById(id));
            if (label) {
                labels.push(label);
            }
        });
        const preview = labels.slice(0, 2).join(', ');
        const overflow = labels.length > 2 ? ` +${labels.length - 2}` : '';
        detailEl.textContent = preview ? `${preview}${overflow}` : `${count} selected`;
    }

    cardEl.classList.toggle('is-active', count > 0);
    cardEl.setAttribute('aria-pressed', count > 0 ? 'true' : 'false');
    
    syncTicketsMasterToggleState();
}

function initializeTicketsQuickActions() {
    attachTicketsQuickActionCard(document.getElementById('selectedTicketsCard'), openSelectedTicketsModal);
    attachTicketsQuickActionCard(document.getElementById('addTicketCard'), openAddTicketQuickAction);
    attachTicketsQuickActionCard(document.getElementById('unreadTicketsCard'), toggleUnreadTicketsQuickAction);
    attachTicketsQuickActionCard(document.getElementById('refreshTicketsCard'), triggerTicketsRefresh);
    updateUnreadQuickCardState();
    updateSelectedTicketsSummary();
    if (!lastTicketsRefreshAt) {
        setTicketsRefreshStatus('Sync latest updates');
    }
}

function initializeTicketSearch() {
    const searchInput = document.getElementById('ticketSearch');
    if (!searchInput) {
        return;
    }

    searchInput.addEventListener('input', () => {
        reapplyTicketSearchFilter();
    });

    reapplyTicketSearchFilter();
}

function reapplyTicketSearchFilter() {
    const searchInput = document.getElementById('ticketSearch');
    if (!searchInput) {
        return;
    }

    const filter = searchInput.value.trim().toLowerCase();
    document.querySelectorAll('#ticketsTableBody tr').forEach(row => {
        const matches = filter.length === 0 || row.textContent.toLowerCase().includes(filter);
        row.dataset.matchesSearch = matches ? 'true' : 'false';
        updateTicketRowVisibility(row);
    });
}

function openSelectedTicketsModal() {
    if (selectedTicketIds.size === 0) {
        showNotification('Select a ticket from the table first', 'error');
        return;
    }

    const items = Array.from(selectedTicketIds).map(ticketId => {
        const ticket = getTicketById(ticketId);
        if (!ticket) {
            return `<li class="selected-ticket-item">Ticket #${escapeHtml(String(ticketId))} (details unavailable)</li>`;
        }

        const subject = ticket.subject ? ticket.subject : 'Support ticket';
        const statusLabel = ticket.status ? ticket.status.charAt(0).toUpperCase() + ticket.status.slice(1) : 'Unknown';
        const categoryLabel = ticket.category || 'General';
        const userLabel = ticket.user?.username || ticket.user?.email || ticket.user_email || ticket.username || ticket.user || 'Unknown user';
        const updated = ticket.updated_at ? new Date(ticket.updated_at).toLocaleString() : (ticket.created_at ? new Date(ticket.created_at).toLocaleString() : 'Unknown');
    const ticketIdLabel = ticket.short_id != null ? `#${ticket.short_id}` : (ticket.id != null ? `#${ticket.id}` : `Ticket ${String(ticketId)}`);

        return `
            <li class="selected-ticket-item">
                <div class="selected-ticket-row">
                    <strong>${escapeHtml(subject)}</strong>
                    <span>${escapeHtml(statusLabel)}</span>
                </div>
                <div class="selected-ticket-meta">
                    ${escapeHtml(ticketIdLabel)} • ${escapeHtml(categoryLabel)} • ${escapeHtml(userLabel)}
                </div>
                <div class="selected-ticket-note">Last updated ${escapeHtml(updated)}</div>
            </li>
        `;
    }).join('');

    const content = `
        <div class="selected-tickets-summary">
            <p>You have ${selectedTicketIds.size} ticket${selectedTicketIds.size === 1 ? '' : 's'} selected.</p>
            <ul class="selected-tickets-list">
                ${items}
            </ul>
        </div>
    `;

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Close</button>
    `;

    createModal('Selected Tickets', content, actions);
}

function openAddTicketQuickAction() {
    addTicket();
}

function toggleUnreadTicketsQuickAction() {
    unreadFilterActive = !unreadFilterActive;
    applyUnreadFilter();
    updateUnreadQuickCardState();
    const unreadCount = ticketsCache.filter(ticket => {
        const status = (ticket.status || '').toLowerCase();
        return status === 'open';
    }).length;
    if (unreadFilterActive) {
        if (unreadCount === 0) {
            showNotification('No unread tickets available right now', 'info');
        } else {
            showNotification(`Showing ${unreadCount} unread ticket${unreadCount === 1 ? '' : 's'}`, 'success');
        }
    } else {
        showNotification('Showing all tickets', 'success');
    }
}

function triggerTicketsRefresh() {
    if (ticketsLoading) {
        showNotification('Tickets are already refreshing. Please wait...', 'info');
        return;
    }
    loadTickets();
}

function pruneSelectedTicketIds() {
    if (selectedTicketIds.size === 0) {
        return;
    }
    const validIds = new Set(ticketsCache.map(getTicketSelectionKey));
    for (const id of Array.from(selectedTicketIds)) {
        if (!validIds.has(String(id))) {
            selectedTicketIds.delete(id);
        }
    }
}

function bindTicketSelectionEvents() {
    document.querySelectorAll('.ticket-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleTicketSelectionChange);
    });
}

function handleTicketSelectionChange(event) {
    const checkbox = event?.target;
    if (!checkbox || !checkbox.dataset.ticketId) {
        return;
    }

    const ticketId = checkbox.dataset.ticketId;
    if (checkbox.checked) {
        selectedTicketIds.add(ticketId);
    } else {
        selectedTicketIds.delete(ticketId);
    }

    const row = checkbox.closest('tr');
    if (row) {
        row.classList.toggle('is-selected', checkbox.checked);
    }

    updateSelectedTicketsSummary();
}

function restoreTicketSelectionState() {
    document.querySelectorAll('.ticket-checkbox').forEach(checkbox => {
        const ticketId = checkbox.dataset.ticketId;
        const shouldSelect = selectedTicketIds.has(ticketId);
        checkbox.checked = shouldSelect;
        const row = checkbox.closest('tr');
        if (row) {
            row.classList.toggle('is-selected', shouldSelect);
        }
    });
}

function syncTicketsMasterToggleState() {
    const masterToggle = document.querySelector('th input[type="checkbox"][aria-label="Select all tickets"]');
    if (!masterToggle) {
        return;
    }

    const checkboxes = Array.from(document.querySelectorAll('.ticket-checkbox'));
    if (checkboxes.length === 0) {
        masterToggle.checked = false;
        masterToggle.indeterminate = false;
        return;
    }

    const selectedCount = checkboxes.filter(cb => cb.checked).length;
    masterToggle.checked = selectedCount > 0 && selectedCount === checkboxes.length;
    masterToggle.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
}

function toggleAllTickets(masterCheckbox) {
    if (!masterCheckbox) {
        return;
    }

    const checkboxes = document.querySelectorAll('.ticket-checkbox');
    const shouldSelectAll = masterCheckbox.checked;
    masterCheckbox.indeterminate = false;

    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
}
 
function updateTicketRowVisibility(row) {
    if (!row) {
        return;
    }
    const matchesSearch = row.dataset.matchesSearch !== 'false';
    const passesUnreadFilter = !unreadFilterActive || row.classList.contains('unread-ticket');
    row.style.display = matchesSearch && passesUnreadFilter ? '' : 'none';
}

function applyUnreadFilter() {
    document.querySelectorAll('#ticketsTableBody tr').forEach(updateTicketRowVisibility);
}

// Modal Helper Functions
function createModal(title, content, actions = '', headerContent = '') {
    const modalHTML = `
        <div class="modal-overlay" id="activeModal" onclick="if(event.target === this) closeModal()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header" style="padding: 16px 24px; flex-direction: column; align-items: flex-start;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%; margin-bottom: 8px;">
                        <h3 style="margin: 0;">${title}</h3>
                        <button class="modal-close" onclick="closeModal()">&times;</button>
                    </div>
                    ${headerContent ? `<div style="margin-top: 0; width: 100%;">${headerContent}</div>` : ''}
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                ${actions ? `<div class="modal-footer">${actions}</div>` : ''}
            </div>
        </div>
    `;
    
    const existing = document.querySelector('#activeModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setTimeout(() => document.querySelector('#activeModal')?.classList.add('show'), 10);
}

function closeModal() {
    const modal = document.querySelector('#activeModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// Add ticket
async function addTicket() {
    // Fetch real users from backend
    let usersOptions = '<option value="">Loading users...</option>';
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/users', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            const users = result.users || [];
            usersOptions = '<option value="">Select user...</option>' + 
                users.map(user => `<option value="${user.id}">${user.username} (${user.email})</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading users:', error);
        usersOptions = '<option value="">Error loading users</option>';
    }
    
    const content = `
        <form id="addTicketForm" onsubmit="submitAddTicket(event)" class="admin-form">
            <div class="form-group">
                <label>User *</label>
                <select name="userId" required>
                    ${usersOptions}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category *</label>
                    <select name="category" required>
                        <option value="Orders">Orders</option>
                        <option value="Payment">Payment</option>
                        <option value="Account">Account</option>
                        <option value="Technical">Technical</option>
                        <option value="Other">Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Priority *</label>
                    <select name="priority" required>
                        <option value="Low">Low</option>
                        <option value="Medium" selected>Medium</option>
                        <option value="High">High</option>
                        <option value="Urgent">Urgent</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Subject *</label>
                <input type="text" name="subject" placeholder="Brief description of the issue" required>
            </div>
            <div class="form-group">
                <label>Message *</label>
                <textarea name="message" rows="5" placeholder="Detailed description of the issue..." required></textarea>
            </div>
            <div class="form-group">
                <label>Assign To</label>
                <select name="assignee">
                    <option value="">Unassigned</option>
                    <option value="support1">Support Agent 1</option>
                    <option value="support2">Support Agent 2</option>
                    <option value="admin">Admin</option>
                </select>
            </div>
            <div class="form-group">
                <label>Related Order ID</label>
                <input type="text" name="orderId" placeholder="Optional order ID if ticket is order-related">
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addTicketForm" class="btn-primary">
            <i class="fas fa-plus"></i> Create Ticket
        </button>
    `;
    
    createModal('Add New Ticket', content, actions);
}

function submitAddTicket(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const ticketData = Object.fromEntries(formData);
    
    // Show loading state
    const submitBtn = document.querySelector('button[form="addTicketForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }
    
    // Call backend API to create ticket
    const token = localStorage.getItem('token');
    
    fetch('/.netlify/functions/tickets', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            action: 'create',
            userId: ticketData.userId,
            subject: ticketData.subject,
            category: ticketData.category,
            priority: ticketData.priority,
            status: ticketData.status || 'open',
            orderId: ticketData.orderId || null,
            message: ticketData.message || 'Ticket created by admin'
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(data.message || 'Ticket created successfully!', 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to create ticket', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-plus"></i> Create Ticket';
            }
        }
    })
    .catch(error => {
        console.error('Create ticket error:', error);
        showNotification('Failed to create ticket. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Create Ticket';
        }
    });
}

// View ticket
async function viewTicket(ticketId) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/.netlify/functions/tickets?ticketId=${ticketId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errText = await response.text();
            console.error('View ticket error:', response.status, errText);
            showNotification('Ticket detayları yüklenemedi. Lütfen oturumunuzu doğrulayın.', 'error');
            return;
        }

        const data = await response.json();
        if (!data || !data.ticket) {
            showNotification('Ticket bulunamadı.', 'error');
            return;
        }
        
        const ticket = data.ticket;
        const displayId = ticket.short_id ? `#${ticket.short_id}` : `#${ticket.id}`;
        const statusColor = {
            'open': '#ef4444',
            'answered': '#3b82f6',
            'closed': '#6b7280'
        }[ticket.status] || '#8b5cf6';
        
        // Header content with ticket information
        const headerContent = `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <!-- First Row: Status, User, Category -->
                <div style="display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr; gap: 16px; align-items: center; font-size: 13px;">
                    <div style="color: #6b7280;">Status:</div>
                    <div style="color: ${statusColor}; font-weight: 600; padding: 2px 8px; background: ${statusColor}20; border-radius: 4px; display: inline-block; width: fit-content;">${ticket.status.toUpperCase()}</div>
                    
                    <div style="color: #6b7280;">User:</div>
                    <div style="color: #e5e7eb; font-weight: 500;">${escapeHtml((ticket.user && (ticket.user.username || ticket.user.email)) || ticket.user_email || ticket.username || 'Unknown')}</div>
                    
                    <div style="color: #6b7280;">Category:</div>
                    <div style="color: #e5e7eb; font-weight: 500;">${escapeHtml(ticket.category || 'General')}</div>
                </div>
                
                <!-- Second Row: Priority, Created -->
                <div style="display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 16px; align-items: center; font-size: 13px;">
                    <div style="color: #6b7280;">Priority:</div>
                    <div style="color: #e5e7eb; font-weight: 500;">${escapeHtml(ticket.priority || 'Normal')}</div>
                    
                    <div style="color: #6b7280;">Created:</div>
                    <div style="color: #e5e7eb; font-weight: 500;">${new Date(ticket.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                </div>
                
                <!-- Third Row: Subject (Full Width) -->
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: flex-start; font-size: 13px;">
                    <div style="color: #6b7280; white-space: nowrap;">Subject:</div>
                    <div style="color: #e5e7eb; font-weight: 500;">${escapeHtml(ticket.subject)}</div>
                </div>
            </div>
        `;
        
        const content = `
            <div class="ticket-details" style="display: flex; flex-direction: column; height: 500px;">
                <!-- Messages Section -->
                <div class="ticket-conversation" style="flex: 1; overflow-y: auto; margin-bottom: 16px; padding-right: 4px; border-radius: 6px;">
                    ${ticket.messages && ticket.messages.length > 0 ? ticket.messages.map(msg => `
                        <div style="background: ${msg.is_admin ? 'rgba(255, 20, 147, 0.08)' : 'rgba(16, 185, 129, 0.08)'}; border-left: 3px solid ${msg.is_admin ? '#FF1494' : '#10b981'}; padding: 12px; border-radius: 6px; margin-bottom: 10px;">
                            <div style="font-weight: 600; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: ${msg.is_admin ? '#FF1494' : '#10b981'}; font-size: 13px;">${escapeHtml(msg.sender_name || (msg.is_admin ? 'Admin' : 'User'))}</span>
                                <span style="font-size: 11px; color: #6b7280;">${new Date(msg.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <p style="margin: 0; color: #d1d5db; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word;">${escapeHtml(msg.message)}</p>
                        </div>
                    `).join('') : '<div style="color: #6b7280; text-align: center; padding: 20px; font-size: 13px;">No messages yet</div>'}
                </div>

                <!-- Reply Form Section -->
                <form id="replyTicketForm" onsubmit="submitReplyTicket(event, '${ticketId}')" class="admin-form" style="border-top: 1px solid #374151; padding-top: 16px;">
                    <input type="hidden" name="shortId" value="${ticket.short_id}">
                <!-- Quick Responses Dropdown -->
                <div class="form-group" style="margin-bottom: 12px;">
                    <label style="font-size: 12px; color: #9ca3af; margin-bottom: 4px; display: block;">Quick Responses</label>
                    <select id="quickResponseSelect" onchange="insertQuickResponse(this)" style="background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 8px; border-radius: 4px; font-family: inherit; font-size: 13px; width: 100%; box-sizing: border-box; cursor: pointer;">
                        <option value="">Select a quick response...</option>
                        <option value="We are working on your issue.">We are working on your issue.</option>
                        <option value="Your issue has been resolved.">Your issue has been resolved.</option>
                        <option value="Refund has been processed.">Refund has been processed.</option>
                        <option value="We need more information.">We need more information.</option>
                        <option value="Please provide order details for verification.">Please provide order details for verification.</option>
                        <option value="Thank you for your patience. We'll get back to you soon.">Thank you for your patience. We'll get back to you soon.</option>
                    </select>
                </div>

                <div class="form-group" style="margin-bottom: 12px;">
                    <label style="font-size: 12px; color: #9ca3af; margin-bottom: 4px; display: block;">Reply Message *</label>
                    <textarea name="replyMessage" rows="3" placeholder="Type your reply..." required style="background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 8px; border-radius: 4px; font-family: inherit; font-size: 13px; width: 100%; box-sizing: border-box; resize: vertical;"></textarea>
                </div>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #d1d5db; font-size: 12px;">
                        <input type="checkbox" name="closeTicket" style="cursor: pointer;">
                        <span>Close ticket after sending</span>
                    </label>
                </form>
            </div>
            
            <style>
                .ticket-conversation::-webkit-scrollbar {
                    width: 6px;
                }
                .ticket-conversation::-webkit-scrollbar-track {
                    background: transparent;
                }
                .ticket-conversation::-webkit-scrollbar-thumb {
                    background: #4b5563;
                    border-radius: 3px;
                }
                .ticket-conversation::-webkit-scrollbar-thumb:hover {
                    background: #5a6573;
                }
            </style>
        `;
        
        const actions = `
            <button type="button" class="btn-secondary" onclick="closeModal()">Close</button>
            <button type="submit" form="replyTicketForm" class="btn-primary">
                <i class="fas fa-reply"></i> Send Reply
            </button>
        `;
        
        createModal(`Ticket ${displayId}`, content, actions, headerContent);
    } catch (error) {
        console.error('Error loading ticket:', error);
        alert('Failed to load ticket details');
    }
}

async function submitReplyTicket(event, ticketId) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const message = formData.get('replyMessage');
    const closeTicket = formData.get('closeTicket');
    const shortId = formData.get('shortId'); // Get from hidden input
    
    console.log('[ADMIN REPLY] ticketId:', ticketId, 'shortId:', shortId, 'message:', message);
    
    if (!ticketId || !message) {
        alert('Ticket ID and message are required');
        return;
    }
    
    const submitBtn = document.querySelector('button[form="replyTicketForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }
    
    try {
        const token = localStorage.getItem('token');
        console.log('[ADMIN REPLY] Sending:', { action: 'reply', shortId, messageLength: message.length, isAdmin: true });
        
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'reply',
                shortId: shortId,
                message: message,
                isAdmin: true,
                autoClose: closeTicket === 'on'
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Reply sent to ticket #${ticketId}`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to send reply', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-reply"></i> Send Reply';
            }
        }
    } catch (error) {
        console.error('Reply ticket error:', error);
        showNotification('Failed to send reply. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-reply"></i> Send Reply';
        }
    }
}

// Reply to ticket (quick reply)
function replyTicket(ticketId) {
    const content = `
        <form id="quickReplyForm" onsubmit="submitQuickReply(event, ${ticketId})" class="admin-form">
            <div class="form-group">
                <label>Quick Reply *</label>
                <textarea name="message" rows="5" placeholder="Type your reply message..." required></textarea>
            </div>
            <div class="form-group">
                <label>Quick Responses</label>
                <select onchange="insertQuickResponse(this.value)" style="margin-bottom: 8px;">
                    <option value="">-- Use Template --</option>
                    <option value="working">We're working on your issue</option>
                    <option value="resolved">Your issue has been resolved</option>
                    <option value="refund">Refund has been processed</option>
                    <option value="info">We need more information</option>
                </select>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="internal">
                    Internal note (not visible to user)
                </label>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="autoClose">
                    Close ticket after sending
                </label>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="quickReplyForm" class="btn-primary">
            <i class="fas fa-reply"></i> Send Reply
        </button>
    `;
    
    createModal(`Reply to Ticket #${ticketId}`, content, actions);
}

async function submitQuickReply(event, ticketId) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const message = formData.get('message');
    const autoClose = formData.get('autoClose') === 'on';
    
    const submitBtn = document.querySelector('button[form="quickReplyForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'reply',
                ticketId: ticketId,
                message: message,
                isAdmin: true,
                autoClose: autoClose
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Reply sent to ticket #${ticketId}`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to send reply', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-reply"></i> Send Reply';
            }
        }
    } catch (error) {
        console.error('Quick reply error:', error);
        showNotification('Failed to send reply. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-reply"></i> Send Reply';
        }
    }
}

function insertQuickResponse(text) {
    const templates = {
        'working': "Thank you for contacting us. We're currently working on resolving your issue and will update you soon.",
        'resolved': "Your issue has been resolved. Please check and let us know if you need further assistance.",
        'refund': "Your refund has been processed and should appear in your account within 3-5 business days.",
        'info': "We need some additional information to help you better. Please provide more details about your issue."
    };
    
    if (templates[text]) {
        const textarea = document.querySelector('textarea[name="message"]');
        if (textarea) textarea.value = templates[text];
    }
}

// Update ticket status
async function updateTicketStatus(ticketId, status) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'update-status',
                ticketId: ticketId,
                status: status
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Ticket #${ticketId} status updated to ${status}`, 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to update status', 'error');
        }
    } catch (error) {
        console.error('Update status error:', error);
        showNotification('Failed to update status. Please try again.', 'error');
    }
}

// Assign ticket
async function assignTicket(ticketId, assignee) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'assign',
                ticketId: ticketId,
                assignee: assignee
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Ticket #${ticketId} assigned to ${assignee}`, 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to assign ticket', 'error');
        }
    } catch (error) {
        console.error('Assign ticket error:', error);
        showNotification('Failed to assign ticket. Please try again.', 'error');
    }
}

// Close ticket
function closeTicket(ticketId) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-check-circle" style="font-size: 48px; color: #10b981; margin-bottom: 20px;"></i>
            <p>Close ticket #${ticketId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                The ticket will be marked as closed. You can reopen it later if needed.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmCloseTicket(${ticketId})">
            <i class="fas fa-check"></i> Close Ticket
        </button>
    `;
    
    createModal('Close Ticket', content, actions);
}

async function confirmCloseTicket(ticketId) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'close',
                ticketId: ticketId
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Ticket #${ticketId} has been closed`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to close ticket', 'error');
        }
    } catch (error) {
        console.error('Close ticket error:', error);
        showNotification('Failed to close ticket. Please try again.', 'error');
    }
}

// Delete ticket
function deleteTicket(ticketId) {
    const content = `
        <div class="confirmation-message danger">
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
            <p>Delete ticket #${ticketId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will permanently delete the ticket and all its messages. This action cannot be undone.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-danger" onclick="confirmDeleteTicket(${ticketId})">
            <i class="fas fa-trash"></i> Delete Ticket
        </button>
    `;
    
    createModal('Delete Ticket', content, actions);
}

async function confirmDeleteTicket(ticketId) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                ticketId: ticketId
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Ticket #${ticketId} deleted successfully`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to delete ticket', 'error');
        }
    } catch (error) {
        console.error('Delete ticket error:', error);
        showNotification('Failed to delete ticket. Please try again.', 'error');
    }
}

// Show unread tickets
function showUnread() {
    unreadFilterActive = true;
    applyUnreadFilter();
    updateUnreadQuickCardState();
    const unreadCount = ticketsCache.filter(ticket => {
        const status = (ticket.status || '').toLowerCase();
        return status === 'open';
    }).length;
    showNotification(
        unreadCount === 0 ? 'No unread tickets available right now' : `Showing ${unreadCount} unread ticket${unreadCount === 1 ? '' : 's'}`,
        unreadCount === 0 ? 'info' : 'success'
    );
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initializeTicketsQuickActions();
    initializeTicketSearch();
    await loadTickets();
});

// Load real tickets from database
async function loadTickets() {
    const tbody = document.getElementById('ticketsTableBody');
    if (!tbody) {
        return;
    }

    ticketsLoading = true;
    const refreshCard = document.getElementById('refreshTicketsCard');
    if (refreshCard) {
        refreshCard.classList.add('is-active');
        refreshCard.setAttribute('aria-pressed', 'true');
    }

    setTicketsRefreshStatus('Refreshing...');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading tickets...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            // Graceful handling for auth issues
            if (response.status === 401 || response.status === 403) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #ef4444;">Authorization required. Please sign in again.</td></tr>';
                showNotification('Oturum gerekli: Lütfen yeniden giriş yapın.', 'error');
                const filtersBar = document.querySelector('.filter-bar');
                if (filtersBar) filtersBar.style.display = 'none';
                // Optionally, redirect to signin after short delay
                setTimeout(() => { window.location.href = '/signin.html'; }, 1500);
                return;
            }
            throw new Error(`Failed to load tickets: ${response.status}`);
        }

        const data = await response.json();
        ticketsCache = Array.isArray(data.tickets) ? data.tickets : [];
        pruneSelectedTicketIds();

        if (ticketsCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #888;">No tickets found</td></tr>';
            updateSelectedTicketsSummary();
            updateUnreadQuickCardState();
            reapplyTicketSearchFilter();
            applyUnreadFilter();
            const paginationInfo = document.getElementById('paginationInfo');
            if (paginationInfo) {
                paginationInfo.textContent = 'Showing 0 of 0';
            }
            return;
        }

        tbody.innerHTML = '';

        ticketsCache.forEach(ticket => {
            const selectionKey = getTicketSelectionKey(ticket);
            const displayId = (ticket.short_id ? String(ticket.short_id) : (ticket.id != null ? String(ticket.id) : selectionKey));
            const checkboxLabel = ticket.short_id ? `Select ticket #${ticket.short_id}` : (ticket.id != null ? `Select ticket #${ticket.id}` : 'Select ticket');
            const status = (ticket.status || '').toLowerCase();
            const isUnread = status === 'open';
            const createdDate = ticket.created_at ? new Date(ticket.created_at).toLocaleString() : 'Unknown';
            const updatedDate = ticket.updated_at ? new Date(ticket.updated_at).toLocaleString() : createdDate;
            const categoryLabel = ticket.category || 'General';
            const normalizedCategory = categoryLabel.toLowerCase();
            const categoryClass = normalizedCategory.includes('order') ? 'orders' :
                normalizedCategory.includes('payment') ? 'payment' :
                normalizedCategory.includes('technical') ? 'technical' :
                normalizedCategory.includes('account') ? 'account' : 'other';

            const isSelected = selectedTicketIds.has(selectionKey);
            const rowClasses = [];
            if (isUnread) rowClasses.push('unread-ticket');
            if (isSelected) rowClasses.push('is-selected');
            const rowClassAttr = rowClasses.length ? ` class="${rowClasses.join(' ')}"` : '';

            const statusOptions = ['open', 'answered', 'closed'].map(option =>
                `<option value="${option}" ${status === option ? 'selected' : ''}>${option}</option>`
            ).join('');


            // Assignee column removed

            const ticketIdValue = ticket.id != null ? String(ticket.id) : '';
            const row = `
                <tr data-ticket-id="${escapeHtml(selectionKey)}" data-matches-search="true"${rowClassAttr}>
                    <td>
                        <input type="checkbox" class="ticket-checkbox" data-ticket-id="${escapeHtml(selectionKey)}" aria-label="${escapeHtml(checkboxLabel)}" ${isSelected ? 'checked' : ''}>
                    </td>
                    <td>${escapeHtml(ticket.user?.username || ticket.user?.email || ticket.user_email || ticket.username || ticket.user || 'Unknown')}</td>
                    <td>
                        <div class="ticket-subject">
                            <span class="category-badge ${categoryClass}">${escapeHtml(categoryLabel)}</span>
                            ${ticketIdValue ? `<a href="#" onclick="viewTicket('${ticketIdValue}'); return false;">${escapeHtml(ticket.subject || 'No subject')}</a>` : `<span>${escapeHtml(ticket.subject || 'No subject')}</span>`}
                        </div>
                    </td>
                    <td>
                        <select class="inline-select status-select" ${ticketIdValue ? `onchange="updateTicketStatus('${ticketIdValue}', this.value)"` : 'disabled'}>
                            ${statusOptions}
                        </select>
                    </td>
                    <td>${escapeHtml(createdDate)}</td>
                    <td>${escapeHtml(updatedDate)}</td>
                    <td>
                        <div class="actions-dropdown">
                            <button class="btn-icon"><i class="fas fa-ellipsis-v"></i></button>
                            <div class="dropdown-menu">
                                ${ticketIdValue ? `
                                    <a href="#" onclick="viewTicket('${ticketIdValue}'); return false;">View</a>
                                    <a href="#" onclick="replyTicket('${ticketIdValue}'); return false;">Reply</a>
                                    <a href="#" onclick="closeTicket('${ticketIdValue}'); return false;">Close</a>
                                    <a href="#" onclick="deleteTicket('${ticketIdValue}'); return false;">Delete</a>
                                ` : '<span class="dropdown-note">Actions unavailable</span>'}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
            tbody.insertAdjacentHTML('beforeend', row);
        });

        restoreTicketSelectionState();
        bindTicketSelectionEvents();
        reapplyTicketSearchFilter();
        applyUnreadFilter();
        updateSelectedTicketsSummary();
        updateUnreadQuickCardState();

        const paginationInfo = document.getElementById('paginationInfo');
        if (paginationInfo) {
            const total = ticketsCache.length;
            const upperBound = Math.min(total, 50);
            paginationInfo.textContent = `Showing 1-${upperBound} of ${total}`;
        }

        lastTicketsRefreshAt = new Date();
        const timeText = lastTicketsRefreshAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        setTicketsRefreshStatus(`Updated ${timeText}`);

        // Update admin sidebar tickets badge (open tickets)
        try {
            if (typeof window.refreshAdminTicketsBadge === 'function') {
                window.refreshAdminTicketsBadge();
            } else {
                const badgeEl = document.getElementById('adminSidebarTicketBadge');
                if (badgeEl) {
                    const openCount = ticketsCache.filter(t => (t.status || '').toLowerCase() === 'open').length;
                    if (openCount > 0) {
                        badgeEl.textContent = openCount > 99 ? '99+' : String(openCount);
                        badgeEl.style.display = 'inline-flex';
                        badgeEl.style.alignItems = 'center';
                        badgeEl.style.justifyContent = 'center';
                    } else {
                        badgeEl.style.display = 'none';
                    }
                }
            }
        } catch (e) {}
    } catch (error) {
        console.error('Load tickets error:', error);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load tickets. Please refresh the page.</td></tr>';
        setTicketsRefreshStatus('Refresh failed');
    } finally {
        ticketsLoading = false;
        if (refreshCard) {
            refreshCard.classList.remove('is-active');
            refreshCard.setAttribute('aria-pressed', 'false');
        }
    }
}

// Insert quick response into reply textarea
function insertQuickResponse(selectElement) {
    const selectedText = selectElement.value;
    if (!selectedText) return;
    
    const textarea = document.querySelector('textarea[name="replyMessage"]');
    if (textarea) {
        textarea.value = selectedText;
        textarea.focus();
        selectElement.value = '';
    }
}

// Toggle bulk actions dropdown menu
function toggleBulkActionsMenu() {
    const menu = document.getElementById('bulkActionsMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    }
}

// Close bulk actions menu when clicking outside
document.addEventListener('click', function(event) {
    const bulkActionsContainer = document.getElementById('bulkActionsContainer');
    if (bulkActionsContainer && !bulkActionsContainer.contains(event.target)) {
        const menu = document.getElementById('bulkActionsMenu');
        if (menu) {
            menu.style.display = 'none';
        }
    }
});

// Open bulk reply modal with quick responses
function openBulkReplyModal() {
    if (selectedTicketIds.size === 0) {
        showNotification('Select tickets first', 'error');
        return;
    }
    
    const selectedCount = selectedTicketIds.size;
    const content = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; padding: 12px; border-radius: 4px;">
                <p style="margin: 0; color: #e5e7eb; font-size: 13px;">You are replying to <strong>${selectedCount}</strong> selected ticket${selectedCount > 1 ? 's' : ''}.</p>
            </div>
            
            <div>
                <label style="font-size: 12px; color: #9ca3af; margin-bottom: 4px; display: block;">Quick Responses</label>
                <select id="bulkQuickResponseSelect" onchange="insertBulkQuickResponse(this)" style="background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 8px; border-radius: 4px; font-family: inherit; font-size: 13px; width: 100%; box-sizing: border-box; cursor: pointer;">
                    <option value="">Select a quick response...</option>
                    <option value="We are working on your issue.">We are working on your issue.</option>
                    <option value="Your issue has been resolved.">Your issue has been resolved.</option>
                    <option value="Refund has been processed.">Refund has been processed.</option>
                    <option value="We need more information.">We need more information.</option>
                    <option value="Please provide order details for verification.">Please provide order details for verification.</option>
                    <option value="Thank you for your patience. We'll get back to you soon.">Thank you for your patience. We'll get back to you soon.</option>
                </select>
            </div>
            
            <div>
                <label style="font-size: 12px; color: #9ca3af; margin-bottom: 4px; display: block;">Reply Message *</label>
                <textarea id="bulkReplyMessage" rows="4" placeholder="Type your reply to all selected tickets..." required style="background: #1f2937; border: 1px solid #374151; color: #e5e7eb; padding: 8px; border-radius: 4px; font-family: inherit; font-size: 13px; width: 100%; box-sizing: border-box; resize: vertical;"></textarea>
            </div>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeBulkReplyModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="submitBulkReply()">
            <i class="fas fa-paper-plane"></i> Send Reply to All
        </button>
    `;
    
    createModal('Reply to All Selected Tickets', content, actions);
    document.getElementById('bulkActionsMenu').style.display = 'none';
}

// Insert quick response into bulk reply textarea
function insertBulkQuickResponse(selectElement) {
    const selectedText = selectElement.value;
    if (!selectedText) return;
    
    const textarea = document.getElementById('bulkReplyMessage');
    if (textarea) {
        textarea.value = selectedText;
        textarea.focus();
        selectElement.value = '';
    }
}

// Close bulk reply modal
function closeBulkReplyModal() {
    closeModal();
}

// Submit bulk reply
async function submitBulkReply() {
    const message = document.getElementById('bulkReplyMessage')?.value;
    
    if (!message) {
        showNotification('Please enter a reply message', 'error');
        return;
    }
    
    if (selectedTicketIds.size === 0) {
        showNotification('No tickets selected', 'error');
        return;
    }
    
    const ticketIds = Array.from(selectedTicketIds);
    const submitBtn = document.querySelector('button[onclick="submitBulkReply()"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'bulkReply',
                shortIds: ticketIds,
                message: message,
                isAdmin: true
            })
        });
        
        if (!response.ok) {
            const errText = await response.text();
            console.error('Bulk reply error:', response.status, errText);
            showNotification(`Error: ${response.status === 401 ? 'Unauthorized' : 'Failed to send replies'}`, 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reply to All';
            }
            return;
        }
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Reply sent to ${selectedTicketIds.size} ticket${selectedTicketIds.size > 1 ? 's' : ''}`, 'success');
            closeModal();
            setTimeout(() => loadTickets(), 500);
        } else {
            showNotification(data.error || 'Failed to send replies', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reply to All';
            }
        }
    } catch (error) {
        console.error('Bulk reply error:', error);
        showNotification('Error sending replies', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Reply to All';
        }
    }
}

// Close all selected tickets
async function closeBulkTickets() {
    if (selectedTicketIds.size === 0) {
        showNotification('Select tickets first', 'error');
        return;
    }
    
    if (!confirm(`Close ${selectedTicketIds.size} selected ticket${selectedTicketIds.size > 1 ? 's' : ''}?`)) {
        return;
    }
    
    const ticketIds = Array.from(selectedTicketIds);
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'bulkClose',
                shortIds: ticketIds,
                isAdmin: true
            })
        });
        
        if (!response.ok) {
            const errText = await response.text();
            console.error('Bulk close error:', response.status, errText);
            showNotification(`Error: ${response.status === 401 ? 'Unauthorized' : 'Failed to close tickets'}`, 'error');
            return;
        }
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Closed ${selectedTicketIds.size} ticket${selectedTicketIds.size > 1 ? 's' : ''}`, 'success');
            selectedTicketIds.clear();
            updateSelectedTicketsSummary();
            setTimeout(() => loadTickets(), 500);
        } else {
            showNotification(data.error || 'Failed to close tickets', 'error');
        }
    } catch (error) {
        console.error('Bulk close error:', error);
        showNotification('Error closing tickets', 'error');
    }
    
    document.getElementById('bulkActionsMenu').style.display = 'none';
}

// Delete all selected tickets
async function deleteBulkTickets() {
    if (selectedTicketIds.size === 0) {
        showNotification('Select tickets first', 'error');
        return;
    }
    
    if (!confirm(`Permanently delete ${selectedTicketIds.size} selected ticket${selectedTicketIds.size > 1 ? 's' : ''}? This cannot be undone.`)) {
        return;
    }
    
    const ticketIds = Array.from(selectedTicketIds);
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/tickets', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'bulkDelete',
                shortIds: ticketIds,
                isAdmin: true
            })
        });
        
        if (!response.ok) {
            const errText = await response.text();
            console.error('Bulk delete error:', response.status, errText);
            showNotification(`Error: ${response.status === 401 ? 'Unauthorized' : 'Failed to delete tickets'}`, 'error');
            return;
        }
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Deleted ${selectedTicketIds.size} ticket${selectedTicketIds.size > 1 ? 's' : ''}`, 'success');
            selectedTicketIds.clear();
            updateSelectedTicketsSummary();
            setTimeout(() => loadTickets(), 500);
        } else {
            showNotification(data.error || 'Failed to delete tickets', 'error');
        }
    } catch (error) {
        console.error('Bulk delete error:', error);
        showNotification('Error deleting tickets', 'error');
    }
    
    document.getElementById('bulkActionsMenu').style.display = 'none';
}

