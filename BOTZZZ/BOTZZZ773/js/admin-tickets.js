// Admin Tickets Management with Real Modals

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
    const ticketId = ticket.id != null ? `#${ticket.id}` : 'Ticket';
    if (subject) {
        return `${ticketId} • ${subject.length > 36 ? `${subject.substring(0, 33)}...` : subject}`;
    }
    return `${ticketId} • ${status}`;
}

function getTicketSelectionKey(ticket) {
    if (!ticket) {
        return '';
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
        return status === 'open' || status === 'pending';
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

    if (!countEl || !detailEl || !cardEl) {
        return;
    }

    const count = selectedTicketIds.size;
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
        const userLabel = ticket.users?.username || ticket.user_email || ticket.username || 'Unknown user';
        const updated = ticket.updated_at ? new Date(ticket.updated_at).toLocaleString() : (ticket.created_at ? new Date(ticket.created_at).toLocaleString() : 'Unknown');
    const ticketIdLabel = ticket.id != null ? `#${ticket.id}` : `Ticket ${String(ticketId)}`;

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
        return status === 'open' || status === 'pending';
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
function createModal(title, content, actions = '') {
    const modalHTML = `
        <div class="modal-overlay" id="activeModal" onclick="if(event.target === this) closeModal()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                ${actions ? `<div class="modal-footer">${actions}</div>` : ''}
            </div>
        </div>
    `;
    
    const existing = document.getElementById('activeModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setTimeout(() => document.getElementById('activeModal').classList.add('show'), 10);
}

function closeModal() {
    const modal = document.getElementById('activeModal');
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
        const response = await fetch(`/.netlify/functions/tickets?id=${ticketId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        if (!data.success || !data.ticket) {
            alert('Failed to load ticket details');
            return;
        }
        
        const ticket = data.ticket;
        
        const content = `
            <div class="ticket-details">
                <div class="ticket-header" style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <div>
                            <h3 style="margin: 0 0 8px;">${escapeHtml(ticket.subject)}</h3>
                            <div style="color: #888; font-size: 14px;">
                                Ticket #${ticket.id} • Created ${new Date(ticket.created_at).toLocaleDateString()}
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <span class="badge badge-${ticket.status === 'open' ? 'success' : ticket.status === 'closed' ? 'secondary' : 'warning'}">${ticket.status}</span>
                            <div style="color: #888; font-size: 12px; margin-top: 4px;">Priority: ${ticket.priority || 'Normal'}</div>
                        </div>
                    </div>
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; font-size: 13px;">
                            <div>
                                <div style="color: #888;">User</div>
                                <div>${escapeHtml(ticket.user_email || ticket.username || 'Unknown')}</div>
                            </div>
                            <div>
                                <div style="color: #888;">Category</div>
                                <div>${escapeHtml(ticket.category)}</div>
                            </div>
                            <div>
                                <div style="color: #888;">Order ID</div>
                                <div>${ticket.order_id || 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="ticket-conversation" style="max-height: 400px; overflow-y: auto; margin-bottom: 20px;">
                    ${ticket.messages && ticket.messages.length > 0 ? ticket.messages.map(msg => `
                        <div class="message ${msg.is_admin ? 'admin-message' : 'user-message'}" style="background: rgba(${msg.is_admin ? '255, 20, 147' : '16, 185, 129'}, 0.1); border-left: 3px solid ${msg.is_admin ? '#FF1494' : '#10b981'}; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
                            <div style="font-weight: 600; margin-bottom: 4px; display: flex; justify-content: space-between;">
                                <span>${escapeHtml(msg.sender_name || (msg.is_admin ? 'Admin' : 'User'))}</span>
                                <span style="font-size: 12px; color: #888;">${new Date(msg.created_at).toLocaleString()}</span>
                            </div>
                            <p style="margin: 0;">${escapeHtml(msg.message)}</p>
                        </div>
                    `).join('') : '<p style="color: #888; text-align: center;">No messages yet</p>'}
                </div>

                <form id="replyTicketForm" onsubmit="submitReplyTicket(event, '${ticketId}')" class="admin-form">
                    <div class="form-group">
                        <label>Reply Message</label>
                        <textarea name="replyMessage" rows="4" placeholder="Type your reply..." required></textarea>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" name="closeTicket">
                            <span>Close ticket after sending</span>
                        </label>
                    </div>
                </form>
            </div>
        `;
        
        const actions = `
            <button type="button" class="btn-secondary" onclick="closeModal()">Close</button>
            <button type="submit" form="replyTicketForm" class="btn-primary">
                <i class="fas fa-reply"></i> Send Reply
            </button>
        `;
        
        createModal(`Ticket #${ticketId}`, content, actions);
    } catch (error) {
        console.error('Error loading ticket:', error);
        alert('Failed to load ticket details');
    }
}

async function submitReplyTicket(event, ticketId) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const message = formData.get('message');
    
    const submitBtn = document.querySelector('button[form="replyTicketForm"]');
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
                isAdmin: true
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
        return status === 'open' || status === 'pending';
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
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading tickets...</td></tr>';

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
            throw new Error(`Failed to load tickets: ${response.status}`);
        }

        const data = await response.json();
        ticketsCache = Array.isArray(data.tickets) ? data.tickets : [];
        pruneSelectedTicketIds();

        if (ticketsCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #888;">No tickets found</td></tr>';
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
            const displayId = ticket.id != null ? String(ticket.id) : selectionKey;
            const checkboxLabel = ticket.id != null ? `Select ticket #${ticket.id}` : 'Select ticket';
            const status = (ticket.status || '').toLowerCase();
            const isUnread = status === 'open' || status === 'pending';
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

            const statusOptions = ['open', 'pending', 'answered', 'closed'].map(option =>
                `<option value="${option}" ${status === option ? 'selected' : ''}>${option}</option>`
            ).join('');

            const assignee = ticket.assigned_to || '';
            const assigneeOptions = [
                { value: '', label: 'Unassigned' },
                { value: 'admin', label: 'Admin' },
                { value: 'support1', label: 'Support 1' },
                { value: 'support2', label: 'Support 2' }
            ].map(option => `<option value="${option.value}" ${assignee === option.value ? 'selected' : ''}>${option.label}</option>`).join('');

            const ticketIdValue = ticket.id != null ? String(ticket.id) : '';
            const row = `
                <tr data-ticket-id="${escapeHtml(selectionKey)}" data-matches-search="true"${rowClassAttr}>
                    <td>
                        <input type="checkbox" class="ticket-checkbox" data-ticket-id="${escapeHtml(selectionKey)}" aria-label="${escapeHtml(checkboxLabel)}" ${isSelected ? 'checked' : ''}>
                    </td>
                    <td>${escapeHtml(displayId)}</td>
                    <td>${escapeHtml(ticket.users?.username || ticket.user_email || ticket.username || 'Unknown')}</td>
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
                    <td>
                        <select class="inline-select assignee-select" ${ticketIdValue ? `onchange="assignTicket('${ticketIdValue}', this.value)"` : 'disabled'}>
                            ${assigneeOptions}
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
    } catch (error) {
        console.error('Load tickets error:', error);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load tickets. Please refresh the page.</td></tr>';
        setTicketsRefreshStatus('Refresh failed');
    } finally {
        ticketsLoading = false;
        if (refreshCard) {
            refreshCard.classList.remove('is-active');
            refreshCard.setAttribute('aria-pressed', 'false');
        }
    }
}
