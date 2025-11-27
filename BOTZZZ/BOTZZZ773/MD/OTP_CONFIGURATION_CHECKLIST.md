# OTP Configuration Checklist for BOTZZZ773

## ✅ Frontend Components (Already Implemented)

| Component | File | Status |
|-----------|------|--------|
| OTP Modal HTML | `signin.html` (lines 228-260) | ✅ Ready |
| OTP Modal CSS | `css/auth-styles.css` (lines 561-700) | ✅ Ready |
| OTP Submit Handler | `js/auth-backend.js` `handleAdminOtpSubmit()` | ✅ Ready |
| OTP Resend Handler | `js/auth-backend.js` `handleAdminOtpResend()` | ✅ Ready |
| Countdown Timer | `js/auth-backend.js` `updateAdminOtpCountdown()` | ✅ Ready |

## ✅ Backend Components (Already Implemented)

| Component | File | Status |
|-----------|------|--------|
| OTP Generation | `netlify/functions/admin-otp.js` | ✅ Ready |
| OTP Email Sending | `netlify/functions/admin-otp.js` | ✅ Ready |
| OTP Verification | `netlify/functions/auth.js` | ✅ Ready |
| Login OTP Trigger | `netlify/functions/auth.js` `triggerAdminOTP()` | ✅ Ready |

## ✅ Database (Migration Exists)

| Table | Migration File | Status |
|-------|----------------|--------|
| `admin_otp_codes` | `supabase/migrations/20251119_create_admin_otp.sql` | ✅ Created |

---

## ⚠️ REQUIRED: Netlify Environment Variables

You MUST set these in Netlify Dashboard → Site Settings → Environment Variables:

### 1. Admin Email (Where OTPs are sent)
```
ADMIN_EMAIL=botzzz773@gmail.com
```
or
```
ADMIN_OTP_EMAIL=botzzz773@gmail.com
```

### 2. SMTP Configuration (Gmail)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=botzzz773@gmail.com
SMTP_PASS=<your-gmail-app-password>
```

---

## 🔐 Gmail App Password Setup

**DO NOT use your regular Gmail password!**

### Steps to Get App Password:

1. **Go to Google Account Security**
   - URL: https://myaccount.google.com/security

2. **Enable 2-Step Verification** (if not already enabled)
   - Click "2-Step Verification" → Turn on

3. **Generate App Password**
   - URL: https://myaccount.google.com/apppasswords
   - App: Select "Mail"
   - Device: Select "Other (Custom name)"
   - Name: `BOTZZZ773 Admin OTP`
   - Click **Generate**

4. **Copy the 16-character password**
   - It looks like: `abcd efgh ijkl mnop`
   - Remove spaces: `abcdefghijklmnop`

5. **Set in Netlify**
   ```bash
   SMTP_PASS=abcdefghijklmnop
   ```

---

## 🧪 How to Test

1. **Go to**: https://www.botzzz773.pro/signin.html

2. **Enter credentials**:
   - Email: `botzzz773@gmail.com`
   - Password: `Mariogomez33*`

3. **Click "Sign In"**

4. **If admin OTP is configured**:
   - A modal popup should appear
   - Check your Gmail inbox for the 6-digit code
   - Enter the code and click "Verify & Continue"

5. **If OTP email doesn't arrive**:
   - Check Netlify function logs
   - Verify SMTP_PASS is correct (App Password, not regular password)
   - Check spam/junk folder

---

## 📋 Quick Netlify CLI Commands

```bash
# Set all environment variables
netlify env:set ADMIN_EMAIL "botzzz773@gmail.com"
netlify env:set SMTP_HOST "smtp.gmail.com"
netlify env:set SMTP_PORT "587"
netlify env:set SMTP_USER "botzzz773@gmail.com"
netlify env:set SMTP_PASS "your-16-char-app-password"

# Verify they're set
netlify env:list
```

---

## 🔍 Troubleshooting

### OTP Modal Not Appearing
- Check browser console for errors
- Verify user role is `admin` in database
- Check `ADMIN_OTP_IDENTIFIERS` env var if set

### OTP Email Not Sending
- Check Netlify function logs: `netlify functions:log admin-otp`
- Verify Gmail App Password (not regular password)
- Ensure 2FA is enabled on Gmail account

### Invalid OTP Error
- Code expires in 10 minutes
- Each code can only be used once
- Codes are case-sensitive (all numeric)

---

## ✅ Current Status

- **Frontend**: Fully implemented ✅
- **Backend**: Fully implemented ✅
- **Database**: Migration ready ✅
- **Configuration**: **NEEDS NETLIFY ENV VARS** ⚠️
