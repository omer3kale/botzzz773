// Ticket Management with Backend Integration
// Load this AFTER api-client.js

let tickets = [];
let selectedTicketId = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadTicketsFromBackend();
    setupFilterButtons();
    setupNewTicketForm();
});

// Load tickets from backend
async function loadTicketsFromBackend() {
    try {
        const data = await api.getTickets();
        
        if (data.tickets) {
            tickets = data.tickets;
            renderTickets('all');
        }
    } catch (error) {
        console.error('Failed to load tickets:', error);
        showTicketMessage('Failed to load tickets. Please refresh the page.', 'error');
    }
}

// Render tickets
function renderTickets(filter = 'all') {
    const ticketsList = document.getElementById('ticketsList');
    if (!ticketsList) return;

    let filteredTickets = tickets;
    
    if (filter !== 'all') {
        filteredTickets = tickets.filter(t => t.status === filter);
    }

    if (filteredTickets.length === 0) {
        ticketsList.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: #666;">
                <p>No tickets found</p>
            </div>
        `;
        return;
    }

    ticketsList.innerHTML = filteredTickets.map(ticket => `
        <div class="ticket-item ${selectedTicketId === ticket.id ? 'active' : ''}" 
             onclick="selectTicket('${ticket.id}')">
            <div class="ticket-header">
                <h4>${ticket.subject}</h4>
                <span class="status-badge ${ticket.status}">${ticket.status}</span>
            </div>
            <p class="ticket-category">${ticket.category}</p>
            <p class="ticket-date">${formatDate(ticket.created_at)}</p>
        </div>
    `).join('');
}

// Select ticket and show details
async function selectTicket(ticketId) {
    selectedTicketId = ticketId;
    
    try {
        const data = await api.getTickets(ticketId);
        
        if (data.ticket) {
            renderTicketDetails(data.ticket);
            renderTickets(document.querySelector('.filter-btn.active')?.dataset.filter || 'all');
        }
    } catch (error) {
        console.error('Failed to load ticket details:', error);
        showTicketMessage('Failed to load ticket details', 'error');
    }
}

// Render ticket details
function renderTicketDetails(ticket) {
    const ticketDetails = document.getElementById('ticketDetails');
    if (!ticketDetails) return;

    const messagesHtml = ticket.messages.map(msg => `
        <div class="message ${msg.is_admin ? 'admin' : 'user'}">
            <div class="message-header">
                <strong>${msg.is_admin ? 'Support Team' : 'You'}</strong>
                <span>${formatDate(msg.created_at)}</span>
            </div>
            <div class="message-content">${msg.message}</div>
        </div>
    `).join('');

    ticketDetails.innerHTML = `
        <div class="ticket-detail-header">
            <div>
                <h3>${ticket.subject}</h3>
                <p>Category: ${ticket.category} | Priority: ${ticket.priority}</p>
            </div>
            <span class="status-badge ${ticket.status}">${ticket.status}</span>
        </div>
        <div class="messages-container">
            ${messagesHtml}
        </div>
        ${ticket.status !== 'closed' ? `
            <div class="reply-section">
                <textarea id="replyMessage" placeholder="Type your reply..." rows="4"></textarea>
                <div class="reply-actions">
                    <button onclick="sendReply()" class="btn-primary">Send Reply</button>
                    <button onclick="closeTicketConfirm()" class="btn-secondary">Close Ticket</button>
                </div>
            </div>
        ` : '<p style="text-align: center; color: #666; padding: 2rem;">This ticket is closed.</p>'}
    `;

    // Scroll to bottom
    const messagesContainer = ticketDetails.querySelector('.messages-container');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// Send reply
async function sendReply() {
    const message = document.querySelector('#replyMessage')?.value.trim();
    
    if (!message) {
        showTicketMessage('Please enter a message', 'error');
        return;
    }

    try {
        const data = await api.replyTicket(selectedTicketId, message);
        
        if (data.success) {
            showTicketMessage('Reply sent successfully', 'success');
            const replyInput = document.querySelector('#replyMessage');
            if (replyInput) {
                replyInput.value = '';
            }
            
            // Reload ticket details
            await selectTicket(selectedTicketId);
        } else {
            showTicketMessage(data.error || 'Failed to send reply', 'error');
        }
    } catch (error) {
        console.error('Reply error:', error);
        showTicketMessage(error.message || 'Failed to send reply', 'error');
    }
}

// Close ticket
async function closeTicketConfirm() {
    if (!confirm('Are you sure you want to close this ticket?')) return;

    try {
        const data = await api.closeTicket(selectedTicketId);
        
        if (data.success) {
            showTicketMessage('Ticket closed successfully', 'success');
            await loadTicketsFromBackend();
            await selectTicket(selectedTicketId);
        } else {
            showTicketMessage(data.error || 'Failed to close ticket', 'error');
        }
    } catch (error) {
        console.error('Close ticket error:', error);
        showTicketMessage(error.message || 'Failed to close ticket', 'error');
    }
}

// Setup filter buttons
function setupFilterButtons() {
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTickets(btn.dataset.filter);
        });
    });
}

// Setup new ticket form
function setupNewTicketForm() {
    const newTicketForm = document.getElementById('newTicketForm');
    if (newTicketForm) {
        newTicketForm.addEventListener('submit', handleCreateTicket);
    }

    const newTicketBtn = document.querySelector('#newTicketBtn');
    if (newTicketBtn) {
        newTicketBtn.addEventListener('click', openNewTicketModal);
    }
}

// Open new ticket modal
function openNewTicketModal() {
    const modal = document.getElementById('newTicketModal');
    if (modal) {
        modal.style.display = 'block';
    }
}

// Close new ticket modal
function closeNewTicketModal() {
    const modal = document.getElementById('newTicketModal');
    if (modal) {
        modal.style.display = 'none';
        document.getElementById('newTicketForm')?.reset();
    }
}

// Handle create ticket
async function handleCreateTicket(e) {
    e.preventDefault();

    const subject = document.getElementById('ticketSubject')?.value.trim();
    const category = document.getElementById('ticketCategory')?.value;
    const priority = document.querySelector('#ticketPriority')?.value || 'medium';
    const message = document.getElementById('ticketMessage')?.value.trim();

    if (!subject || !category || !message) {
        showTicketMessage('Please fill in all fields', 'error');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
        const data = await api.createTicket(subject, category, priority, message);
        
        if (data.success && data.ticket) {
            showTicketMessage('Ticket created successfully', 'success');
            closeNewTicketModal();
            await loadTicketsFromBackend();
            selectTicket(data.ticket.id);
        } else {
            showTicketMessage(data.error || 'Failed to create ticket', 'error');
        }
    } catch (error) {
        console.error('Create ticket error:', error);
        showTicketMessage(error.message || 'Failed to create ticket', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// Format date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        if (hours === 0) {
            const minutes = Math.floor(diff / (1000 * 60));
            return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
        }
        return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    } else if (days === 1) {
        return 'Yesterday';
    } else if (days < 7) {
        return `${days} days ago`;
    } else {
        return date.toLocaleDateString();
    }
}

// Show ticket message
function showTicketMessage(message, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `ticket-toast ${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 9999;
        animation: slideIn 0.3s ease;
        max-width: 400px;
    `;

    if (type === 'success') {
        messageDiv.style.background = '#10b981';
    } else if (type === 'error') {
        messageDiv.style.background = '#ef4444';
    }

    document.body.appendChild(messageDiv);

    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => messageDiv.remove(), 300);
    }, 5000);
}
