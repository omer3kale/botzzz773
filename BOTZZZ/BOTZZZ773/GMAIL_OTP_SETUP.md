# Gmail OTP Authentication Setup Guide

## 🎯 What This Does

Replaces password-based admin authentication with **secure one-time password (OTP)** codes sent via Gmail.

### How It Works:
1. Admin enters email on sign-in page
2. System sends 6-digit code to Gmail
3. Admin enters code within 10 minutes
4. System verifies and issues JWT token
5. Admin is signed in for 7 days

---

## 📋 Required Environment Variables

Add these to your Netlify environment:

### 1. SMTP Configuration (Gmail)

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-app-password
```

### 2. Admin Email

```bash
ADMIN_EMAIL=your-admin-email@gmail.com
```

---

## 🔐 Gmail App Password Setup

**IMPORTANT**: Don't use your regular Gmail password! Use an App Password.

### Steps:

1. **Enable 2-Factor Authentication** on your Gmail account
   - Go to: https://myaccount.google.com/security
   - Enable "2-Step Verification"

2. **Generate App Password**
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Name it: "BOTZZZ773 Admin OTP"
   - Click "Generate"
   - Copy the 16-character password (remove spaces)

3. **Save to Netlify**
   ```bash
   netlify env:set SMTP_USER "your-gmail@gmail.com"
   netlify env:set SMTP_PASS "your-16-char-app-password"
   netlify env:set ADMIN_EMAIL "your-admin-email@gmail.com"
   netlify env:set SMTP_HOST "smtp.gmail.com"
   netlify env:set SMTP_PORT "587"
   ```

---

## 🗄️ Database Migration

Run this SQL in Supabase SQL Editor:

```bash
# Copy and run this file:
supabase/migrations/20251119_create_admin_otp.sql
```

Or run in SQL Editor directly:
```sql
-- See the migration file for full SQL
CREATE TABLE admin_otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 📦 NPM Package Required

The OTP system uses `nodemailer` for sending emails:

```bash
npm install nodemailer
```

Already included in your `package.json` if you deployed the code.

---

## 🧪 Testing

### 1. Test Email Sending (Terminal)

```javascript
// test-otp.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransporter({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: 'your-gmail@gmail.com',
        pass: 'your-app-password'
    }
});

transporter.sendMail({
    from: 'your-gmail@gmail.com',
    to: 'your-admin-email@gmail.com',
    subject: 'Test Email',
    text: 'If you receive this, SMTP is working!'
}).then(() => {
    console.log('✅ Email sent successfully!');
}).catch(err => {
    console.error('❌ Email failed:', err);
});
```

```bash
node test-otp.js
```

### 2. Test OTP Request (Browser Console)

```javascript
fetch('/.netlify/functions/admin-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        action: 'request-otp',
        email: 'your-admin-email@gmail.com'
    })
})
.then(r => r.json())
.then(console.log);
```

Expected response:
```json
{
  "success": true,
  "message": "Verification code sent to your-admin-email@gmail.com",
  "expiresIn": 600
}
```

### 3. Test OTP Verification

Check your email for the 6-digit code, then:

```javascript
fetch('/.netlify/functions/admin-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        action: 'verify-otp',
        email: 'your-admin-email@gmail.com',
        otpCode: '123456' // Use the code from your email
    })
})
.then(r => r.json())
.then(console.log);
```

Expected response:
```json
{
  "success": true,
  "message": "Authentication successful",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "...",
    "email": "your-admin-email@gmail.com",
    "role": "admin",
    "username": "admin"
  }
}
```

---

## 🚀 Deployment

1. **Install nodemailer**:
   ```bash
   npm install nodemailer
   ```

2. **Run database migration** (see above)

3. **Set environment variables** (see above)

4. **Deploy**:
   ```bash
   git add .
   git commit -m "feat: Add Gmail OTP authentication for admin"
   git push origin master
   netlify deploy --prod
   ```

5. **Update admin sign-in link**:
   Change `/admin/signin.html` to `/admin/signin-otp.html`

---

## 🎨 Features

### Security
- ✅ No passwords stored
- ✅ OTP expires in 10 minutes
- ✅ One-time use only
- ✅ IP address logging
- ✅ User agent tracking
- ✅ Automatic cleanup of old codes

### User Experience
- ✅ Beautiful email template
- ✅ 6-digit OTP input with auto-focus
- ✅ Countdown timer
- ✅ Resend code (60s cooldown)
- ✅ Clear error messages
- ✅ 7-day JWT token (stay signed in)

### Email Template
- ✅ Professional design
- ✅ Matches BOTZZZ773 branding
- ✅ Mobile responsive
- ✅ Security warnings
- ✅ Expiry notice

---

## 📊 Database Cleanup

OTP codes are stored temporarily. To cleanup old codes:

```sql
-- Manual cleanup
DELETE FROM admin_otp_codes
WHERE expires_at < NOW() - INTERVAL '1 hour'
OR (used = TRUE AND created_at < NOW() - INTERVAL '24 hours');

-- Or use the built-in function
SELECT cleanup_expired_otp_codes();
```

### Automatic Cleanup (Optional)

If you have pg_cron enabled:

```sql
SELECT cron.schedule(
    'cleanup-otp-codes',
    '0 * * * *',  -- Every hour
    'SELECT cleanup_expired_otp_codes()'
);
```

---

## 🔄 Migration from Old System

### Before (Password-based):
- Admin enters email + password
- Credentials checked against database
- JWT token issued

### After (OTP-based):
- Admin enters email only
- 6-digit code sent to Gmail
- Admin enters code
- JWT token issued

### Migration Steps:

1. Keep old `/admin/signin.html` as fallback
2. Add new `/admin/signin-otp.html`
3. Test OTP system thoroughly
4. Update all admin links to use `-otp.html`
5. Eventually remove old signin page

---

## 🐛 Troubleshooting

### "Failed to send verification email"

**Causes**:
- Wrong Gmail app password
- 2FA not enabled on Gmail
- SMTP credentials not set in Netlify

**Fix**:
1. Verify SMTP_USER and SMTP_PASS in Netlify
2. Test with test-otp.js script
3. Check Gmail "Less secure apps" is OFF (use App Password instead)

### "Admin account not found"

**Cause**: Email not in users table or not admin role

**Fix**:
```sql
-- Check if user exists
SELECT * FROM users WHERE email = 'your-admin-email@gmail.com';

-- Update role to admin
UPDATE users SET role = 'admin' WHERE email = 'your-admin-email@gmail.com';
```

### "Invalid or expired verification code"

**Causes**:
- Code already used
- Code expired (>10 min)
- Wrong code entered

**Fix**:
- Request new code
- Check email for latest code
- Ensure code is entered within 10 minutes

---

## 📝 Environment Variables Checklist

```bash
# Verify all are set
netlify env:get SMTP_USER
netlify env:get SMTP_PASS
netlify env:get ADMIN_EMAIL
netlify env:get SMTP_HOST
netlify env:get SMTP_PORT
netlify env:get JWT_SECRET
```

All should return values (not "No value set").

---

## 🎉 Benefits

### For Security:
- ✅ No password to remember or leak
- ✅ One-time codes prevent replay attacks
- ✅ Time-limited (10 min expiry)
- ✅ Audit trail (IP + user agent logged)

### For Admins:
- ✅ Quick sign-in (just email + code)
- ✅ Professional email design
- ✅ Mobile-friendly
- ✅ Clear instructions

### For Development:
- ✅ Easy to test
- ✅ Well-documented
- ✅ Scalable (add more admins easily)
- ✅ No password management needed

---

**Status**: Ready to deploy after environment setup  
**Last Updated**: November 19, 2025
