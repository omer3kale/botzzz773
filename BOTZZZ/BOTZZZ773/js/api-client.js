// API Client - Centralized API communication
const API_BASE_URL = window.location.origin;

class APIClient {
    constructor() {
        this.baseURL = API_BASE_URL;
    }

    // Get auth token from localStorage
    getToken() {
        return localStorage.getItem('token');
    }

    // Make authenticated request
    async request(endpoint, options = {}) {
        const token = this.getToken();
        
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const config = {
            ...options,
            headers
        };

        try {
            const response = await fetch(`${this.baseURL}${endpoint}`, config);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP error! status: ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Auth endpoints
    async login(email, password, adminOtp = null, requestOtp = false) {
        const body = {
            action: 'login',
            email,
            password
        };
        
        // Include admin OTP if provided
        if (adminOtp) {
            body.adminOtp = adminOtp;
        }
        
        // Include OTP request flag
        if (requestOtp) {
            body.requestOtp = true;
        }
        
        return this.request('/.netlify/functions/auth', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async signup(email, password, username, firstName, lastName) {
        return this.request('/.netlify/functions/auth', {
            method: 'POST',
            body: JSON.stringify({
                action: 'signup',
                email,
                password,
                username,
                firstName,
                lastName
            })
        });
    }

    async verifyToken(token) {
        return this.request('/.netlify/functions/auth', {
            method: 'POST',
            body: JSON.stringify({
                action: 'verify',
                token
            })
        });
    }

    async logout() {
        const token = this.getToken();
        return this.request('/.netlify/functions/auth', {
            method: 'POST',
            body: JSON.stringify({
                action: 'logout',
                token
            })
        });
    }

    // User endpoints
    async getUser() {
        return this.request('/.netlify/functions/users', {
            method: 'GET'
        });
    }

    async updateUser(userId, data) {
        return this.request('/.netlify/functions/users', {
            method: 'PUT',
            body: JSON.stringify({ userId, ...data })
        });
    }

    async deleteUser(userId) {
        return this.request('/.netlify/functions/users', {
            method: 'DELETE',
            body: JSON.stringify({ userId })
        });
    }

    // Order endpoints
    async getOrders() {
        return this.request('/.netlify/functions/orders', {
            method: 'GET'
        });
    }

    async createOrder(serviceId, quantity, link) {
        return this.request('/.netlify/functions/orders', {
            method: 'POST',
            body: JSON.stringify({ serviceId, quantity, link })
        });
    }

    async refillOrder(orderId) {
        return this.request('/.netlify/functions/orders', {
            method: 'PUT',
            body: JSON.stringify({ orderId, action: 'refill' })
        });
    }

    async cancelOrder(orderId) {
        return this.request('/.netlify/functions/orders', {
            method: 'DELETE',
            body: JSON.stringify({ orderId })
        });
    }

    // Service endpoints
    async getServices({ audience = 'customer' } = {}) {
        const query = audience ? `?audience=${encodeURIComponent(audience)}` : '';
        return this.request(`/.netlify/functions/services${query}`, {
            method: 'GET'
        });
    }

    async createService(data) {
        return this.request('/.netlify/functions/services', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    }

    async updateService(serviceId, data) {
        return this.request('/.netlify/functions/services', {
            method: 'PUT',
            body: JSON.stringify({ serviceId, ...data })
        });
    }

    async deleteService(serviceId) {
        return this.request('/.netlify/functions/services', {
            method: 'DELETE',
            body: JSON.stringify({ serviceId })
        });
    }

    // Payment endpoints
    async createPayment(amount, method) {
        if (method === 'payeer') {
            return this.request('/.netlify/functions/payeer', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'create-payment',
                    amount
                })
            });
        } else {
            return this.request('/.netlify/functions/payments', {
                method: 'POST',
                body: JSON.stringify({
                    action: 'create-checkout',
                    amount,
                    method
                })
            });
        }
    }

    async getPaymentHistory() {
        return this.request('/.netlify/functions/payments', {
            method: 'POST',
            body: JSON.stringify({ action: 'history' })
        });
    }

    // Ticket endpoints
    async getTickets(ticketId = null) {
        return this.request('/.netlify/functions/tickets', {
            method: 'GET',
            body: JSON.stringify({ ticketId })
        });
    }

    async createTicket(subject, category, priority, message) {
        return this.request('/.netlify/functions/tickets', {
            method: 'POST',
            body: JSON.stringify({ subject, category, priority, message })
        });
    }

    async replyTicket(ticketId, message) {
        return this.request('/.netlify/functions/tickets', {
            method: 'PUT',
            body: JSON.stringify({ ticketId, action: 'reply', message })
        });
    }

    async closeTicket(ticketId) {
        return this.request('/.netlify/functions/tickets', {
            method: 'PUT',
            body: JSON.stringify({ ticketId, action: 'close' })
        });
    }

    // Provider endpoints (admin only)
    async getProviders() {
        return this.request('/.netlify/functions/providers', {
            method: 'GET'
        });
    }

    async testProvider(apiUrl, apiKey) {
        return this.request('/.netlify/functions/providers', {
            method: 'POST',
            body: JSON.stringify({ action: 'test', apiUrl, apiKey })
        });
    }

    async syncProvider(providerId) {
        return this.request('/.netlify/functions/providers', {
            method: 'POST',
            body: JSON.stringify({ action: 'sync', providerId })
        });
    }

    async createProvider(data) {
        return this.request('/.netlify/functions/providers', {
            method: 'POST',
            body: JSON.stringify({ action: 'create', ...data })
        });
    }

    async updateProvider(providerId, data) {
        return this.request('/.netlify/functions/providers', {
            method: 'PUT',
            body: JSON.stringify({ providerId, ...data })
        });
    }

    async deleteProvider(providerId) {
        return this.request('/.netlify/functions/providers', {
            method: 'DELETE',
            body: JSON.stringify({ providerId })
        });
    }
}

// Export singleton instance
const api = new APIClient();
