# Admin OTP Authentication Test Documentation

## Overview
This document outlines the test cases and validation steps for the Admin OTP (One-Time Password) authentication system implemented in BOTZZZ773.

## Security Requirements
1. **Admin-Only Trigger**: OTP codes should only be generated for users with admin role
2. **Email Restriction**: OTP codes should only be sent to the configured admin email address
3. **Credential Validation**: User credentials must be valid before OTP generation
4. **Single Use**: OTP codes must be invalidated after successful use
5. **Time Expiration**: OTP codes must expire after a defined time period (10 minutes)

## Test Environment Setup

### Required Environment Variables
```bash
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Admin Configuration  
ADMIN_EMAIL=admin@botzzz773.com
ADMIN_OTP_EMAIL=admin@botzzz773.com
# (Optional legacy) G_ADMIN_EMAIL=admin@botzzz773.com

# JWT Secret
JWT_SECRET=your-jwt-secret-key

# Netlify Function URL
URL=https://your-site.netlify.app
```

### Database Requirements
- Admin user must exist in `users` table with `role = 'admin'`
- `admin_otp_codes` table must be created (see migration file)

## Test Cases

### Test Case 1: Admin OTP Request ✅
**Objective**: Verify OTP generation for valid admin credentials

**Steps**:
1. Navigate to `/tests/admin-otp-test.html`
2. Enter admin email and password
3. Click "Request Admin OTP"

**Expected Result**:
- ✅ Success response with message "OTP sent to admin email"
- ✅ Email received at admin address with 6-digit code
- ✅ OTP record created in database with proper expiration

**API Call**:
```javascript
POST /.netlify/functions/auth
{
  "action": "login",
  "email": "admin@botzzz773.com", 
  "password": "admin_password",
  "requestOtp": true
}
```

**Expected Response**:
```json
{
  "success": true,
  "requiresOtp": true,
  "message": "OTP sent to admin email. Please check your inbox.",
  "expiresIn": 600
}
```

### Test Case 2: Regular User OTP Rejection ✅
**Objective**: Verify regular users cannot trigger admin OTP

**Steps**:
1. Enter regular user credentials
2. Attempt OTP request
3. Verify rejection

**Expected Result**:
- ❌ Request rejected before OTP generation
- ❌ No email sent
- ❌ No OTP record created

**Expected Response**:
```json
{
  "success": false,
  "error": "Invalid credentials" // or role-based rejection
}
```

### Test Case 3: Invalid Credentials Rejection ✅
**Objective**: Verify invalid credentials are rejected before OTP

**Steps**:
1. Enter incorrect admin password
2. Attempt OTP request

**Expected Result**:
- ❌ Request rejected due to invalid password
- ❌ No OTP generated or sent

### Test Case 4: OTP Validation and Login ✅
**Objective**: Verify successful admin login with OTP

**Steps**:
1. Generate OTP using Test Case 1
2. Retrieve OTP from admin email
3. Enter credentials + OTP code
4. Submit login

**Expected Result**:
- ✅ Successful authentication
- ✅ JWT token returned
- ✅ User object with admin role
- ✅ OTP marked as used in database

**API Call**:
```javascript
POST /.netlify/functions/auth
{
  "action": "login",
  "email": "admin@botzzz773.com",
  "password": "admin_password", 
  "adminOtp": "123456"
}
```

**Expected Response**:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid",
    "email": "admin@botzzz773.com",
    "role": "admin",
    "username": "admin"
  }
}
```

### Test Case 5: Expired OTP Rejection ✅
**Objective**: Verify expired OTP codes are rejected

**Steps**:
1. Generate OTP
2. Wait for expiration (10+ minutes)
3. Attempt login with expired OTP

**Expected Result**:
- ❌ Login rejected
- ❌ Error message about expired OTP

### Test Case 6: Used OTP Rejection ✅
**Objective**: Verify used OTP codes cannot be reused

**Steps**:
1. Successfully login with OTP (Test Case 4)
2. Attempt to use same OTP again

**Expected Result**:
- ❌ Login rejected
- ❌ Error message about invalid OTP

## Frontend Integration Test

### Admin Signin Flow
1. Navigate to `/signin.html`
2. Click "Admin Sign In" toggle
3. Enter admin credentials
4. Click "Sign In" (should trigger OTP request)
5. Check email for OTP
6. Enter OTP in revealed field
7. Click "Sign In" again (should validate OTP)

**Expected Behavior**:
- Button text changes: "Requesting OTP..." → "Sign In" → "Verifying OTP..."
- Success message shows OTP sent
- OTP field gets focus after OTP request
- Successful redirect to `/admin/index.html`

## Security Validation Checklist

- [ ] ✅ Only admin users can trigger OTP generation
- [ ] ✅ OTP only sent to configured admin email
- [ ] ✅ Invalid credentials rejected before OTP
- [ ] ✅ OTP codes expire after 10 minutes
- [ ] ✅ OTP codes are single-use only
- [ ] ✅ OTP format validation (6 digits)
- [ ] ✅ Rate limiting prevents OTP spam
- [ ] ✅ Email templates are professional
- [ ] ✅ Database cleanup removes expired codes
- [ ] ✅ Frontend prevents non-admin OTP attempts

## Implementation Files

### Backend
- `netlify/functions/admin-otp.js` - OTP generation and email sending
- `netlify/functions/auth.js` - Login with OTP validation
- `supabase/migrations/20251119_create_admin_otp.sql` - Database schema

### Frontend  
- `signin.html` - Admin signin form with OTP field
- `js/auth-backend.js` - OTP request and validation logic
- `js/api-client.js` - API wrapper for OTP calls
- `css/auth-styles.css` - Admin signin styling

### Testing
- `tests/admin-otp-test.html` - Comprehensive test interface

## Troubleshooting

### Common Issues
1. **SMTP Configuration**: Verify Gmail app password and SMTP settings
2. **Environment Variables**: Ensure all required env vars are set
3. **Database Schema**: Run migration to create OTP table
4. **Admin User**: Verify admin user exists with correct role
5. **Email Delivery**: Check spam folder for OTP emails

### Debug Steps
1. Check Netlify function logs for errors
2. Verify database records in `admin_otp_codes` table
3. Test SMTP connection independently
4. Validate JWT secret configuration
5. Check browser console for frontend errors

## Deployment Notes

### Production Checklist
- [ ] Environment variables configured in Netlify
- [ ] SMTP credentials are valid app passwords
- [ ] Admin email is configured and accessible
- [ ] Database migration has been applied
- [ ] JWT secret is secure (32+ characters)
- [ ] Function timeout allows for email sending
- [ ] Rate limiting is configured to prevent abuse

This completes the Admin OTP authentication implementation with full test coverage and security validation.