# Customer Dashboard & API Access Authentication

## Overview
This document explains the authentication and access control system for the customer dashboard and API features.

## Authentication Requirements

### Dashboard Access
- **URL**: `/dashboard.html`
- **Authentication**: Required
- **Redirect**: Unauthenticated users → `/signin.html`
- **Features**:
  - View and place new orders
  - Check order history and status
  - View account balance
  - Manage subscriptions
  - Access support tickets
  - Add funds to account

### API Access
All API-related pages require user authentication:

1. **API Documentation** (`/api.html`)
   - Requires: Valid authentication token
   - Redirect if not authenticated → `/signin.html`
   
2. **API Dashboard** (`/api-dashboard.html`)
   - Requires: Valid authentication token
   - Redirect if not authenticated → `/signin.html`
   - Features:
     - Generate API keys
     - View API usage statistics
     - Manage API integrations

## Authentication Flow

### 1. Sign Up Process
```
User → signup.html → POST /.netlify/functions/auth (action: signup)
↓
Response: { token, user: { id, email, username, balance, role } }
↓
localStorage.setItem('token', token)
localStorage.setItem('user', JSON.stringify(user))
↓
Redirect → dashboard.html
```

### 2. Sign In Process
```
User → signin.html → POST /.netlify/functions/auth (action: login)
↓
Response: { token, user: { id, email, username, balance, role } }
↓
localStorage.setItem('token', token)
localStorage.setItem('user', JSON.stringify(user))
↓
Redirect → dashboard.html
```

### 3. Dashboard Access Check
```javascript
// Runs on dashboard.html load
const token = localStorage.getItem('token');
const user = localStorage.getItem('user');

if (!token || !user) {
    window.location.href = 'signin.html';
    return;
}
```

### 4. API Access Check
```javascript
// Runs on api.html and api-dashboard.html load
const token = localStorage.getItem('token');
const user = localStorage.getItem('user');

if (!token || !user) {
    alert('You must be signed in to access the API');
    window.location.href = 'signin.html';
    return;
}
```

### 5. Backend API Key Validation
```javascript
// In /.netlify/functions/api-keys
const user = getUserFromToken(authHeader);
if (!user) {
    return { 
        statusCode: 401, 
        body: JSON.stringify({ 
            error: 'Unauthorized - Please sign in to access API keys' 
        }) 
    };
}
```

## Protected Routes

### Client-Side Protection
The following pages have authentication checks:
- `dashboard.html` - Customer dashboard
- `api.html` - API documentation (authenticated users only)
- `api-dashboard.html` - API key management (authenticated users only)

### Backend Protection
All Netlify functions require valid JWT tokens:
- `/.netlify/functions/orders` - Order management
- `/.netlify/functions/api-keys` - API key management
- `/.netlify/functions/payments` - Payment operations
- `/.netlify/functions/tickets` - Support tickets
- `/.netlify/functions/dashboard` - Dashboard data

## Security Features

### 1. JWT Token Authentication
- **Storage**: localStorage
- **Expiration**: 7 days
- **Contents**: userId, email, role
- **Validation**: Server-side verification on all protected endpoints

### 2. Role-Based Access
```javascript
{
    userId: "uuid",
    email: "user@example.com",
    role: "user" // or "admin"
}
```

### 3. Session Management
- Logout clears all localStorage and sessionStorage
- Token expiration triggers automatic logout
- Invalid tokens redirect to sign-in page

## API Key Access Control

### Generation Rules
1. ✅ User must be authenticated
2. ✅ User must have valid JWT token
3. ✅ User account must be active
4. ✅ API keys are user-specific
5. ✅ Keys are masked in responses (first 20 chars visible)

### Usage Restrictions
- API keys are only accessible to authenticated users
- Each user can have multiple API keys
- Keys can be deleted by the owner
- API usage is tracked per user

## Public Routes (No Authentication Required)

The following pages are accessible without authentication:
- `index.html` - Homepage
- `services.html` - Service catalog
- `contact.html` - Contact form
- `signin.html` - Sign in page
- `signup.html` - Sign up page

## Implementation Details

### Frontend Auth Check
```javascript
// dashboard.js (runs on all dashboard pages)
function checkAuth() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');

    if (!token || !user) {
        window.location.href = 'signin.html';
        return null;
    }

    try {
        const userData = JSON.parse(user);
        return { token, user: userData };
    } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'signin.html';
        return null;
    }
}
```

### Backend Token Verification
```javascript
// utils/auth.js
function getUserFromToken(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    
    const token = authHeader.substring(7);
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}
```

## User Experience Flow

### First-Time User
1. Visit homepage → Browse services
2. Click "Sign Up" → Create account
3. Redirect to dashboard → Explore features
4. Want API access? → Visit API Dashboard (authenticated)
5. Generate API key → Start integrating

### Returning User
1. Visit homepage or any page
2. Click "Sign In" → Enter credentials
3. Redirect to dashboard → Continue managing orders
4. Access API features freely (already authenticated)

### Unauthenticated User Trying to Access Protected Routes
1. Visit `dashboard.html` or `api.html` directly
2. JavaScript checks authentication
3. No valid token found
4. Alert shown (for API pages)
5. Redirect to `signin.html`
6. After sign-in → Redirect back to requested page

## Error Handling

### Frontend Errors
- **Invalid token**: Clear storage → Redirect to sign-in
- **Expired token**: Clear storage → Redirect to sign-in
- **Network error**: Show toast notification → Retry option

### Backend Errors
- **401 Unauthorized**: Missing or invalid token
- **403 Forbidden**: Valid token but insufficient permissions
- **500 Server Error**: Internal server error

## Best Practices

1. **Always check authentication** before showing protected content
2. **Validate tokens server-side** for all API requests
3. **Use HTTPS** in production to protect tokens
4. **Implement token refresh** for better UX
5. **Log security events** for monitoring
6. **Rate limit API requests** to prevent abuse
7. **Sanitize user inputs** to prevent XSS/injection attacks

## Testing Authentication

### Manual Tests
1. Try accessing `dashboard.html` without signing in → Should redirect
2. Sign in → Should access dashboard
3. Try accessing `api.html` without signing in → Should redirect
4. Sign in → Should access API docs
5. Logout → Should clear session and redirect

### Automated Tests
```javascript
// Example test
describe('Dashboard Authentication', () => {
    it('should redirect unauthenticated users to sign-in', () => {
        localStorage.clear();
        visit('/dashboard.html');
        expect(window.location.pathname).toBe('/signin.html');
    });
    
    it('should allow authenticated users to access dashboard', () => {
        localStorage.setItem('token', 'valid-jwt-token');
        localStorage.setItem('user', JSON.stringify({ id: 1, email: 'test@test.com' }));
        visit('/dashboard.html');
        expect(window.location.pathname).toBe('/dashboard.html');
    });
});
```

## Summary

✅ **Dashboard**: Requires authentication - users must sign in  
✅ **API Pages**: Requires authentication - users must sign in  
✅ **API Keys**: Only accessible to authenticated users  
✅ **Backend**: All protected endpoints validate JWT tokens  
✅ **Public Pages**: Homepage, services, contact remain public  
✅ **Security**: Token-based auth with server-side validation  

This ensures that **customers can only access API features AFTER signing in**, not before!
