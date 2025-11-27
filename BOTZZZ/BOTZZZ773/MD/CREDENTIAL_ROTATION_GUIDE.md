# 🚨 URGENT: Credential Rotation Guide

Your credentials were exposed on GitHub. **You MUST rotate all of these immediately.**

---

## ⚠️ Compromised Credentials (ROTATE NOW)

### 1. Supabase API Keys
**Risk: HIGH** - Anyone can access your database

**Steps to rotate:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project → Settings → API
3. Click "Regenerate" for both:
   - `anon` (public) key
   - `service_role` key
4. Update in **Netlify** → Site Settings → Environment Variables:
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`

### 2. Supabase Database Password
**Risk: CRITICAL** - Direct database access

**Steps to rotate:**
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project → Settings → Database
3. Under "Database Password", click "Reset database password"
4. Save the new password securely
5. Update any direct database connections

### 3. JWT Secret
**Risk: HIGH** - Token forgery possible

**Steps to rotate:**
1. Generate a new secret:
   ```bash
   openssl rand -base64 64
   ```
2. Update in **Netlify** → Site Settings → Environment Variables:
   - `JWT_SECRET`
3. **Note:** All existing user sessions will be invalidated

### 4. Payeer Credentials
**Risk: HIGH** - Payment fraud possible

**Steps to rotate:**
1. Log into [Payeer Merchant Dashboard](https://payeer.com/merchant/)
2. Go to Settings → Security
3. Generate new Secret Key
4. Update in **Netlify**:
   - `PAYEER_SECRET_KEY`

### 5. Gmail App Password (SMTP)
**Risk: MEDIUM** - Email access

**Steps to rotate:**
1. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
2. Revoke the existing app password
3. Generate a new 16-character app password
4. Update in **Netlify**:
   - `SMTP_PASS`

---

## 📋 Netlify Environment Variables Checklist

After rotating all credentials, verify these are set in Netlify:

```
✅ SUPABASE_URL
✅ SUPABASE_ANON_KEY        (rotated)
✅ SUPABASE_SERVICE_ROLE_KEY (rotated)
✅ JWT_SECRET               (rotated)
✅ PAYEER_MERCHANT_ID
✅ PAYEER_SECRET_KEY        (rotated)
✅ PAYEER_ACCOUNT
✅ SMTP_HOST=smtp.gmail.com
✅ SMTP_PORT=587
✅ SMTP_USER
✅ SMTP_PASS                (rotated)
✅ ADMIN_EMAIL
✅ ADMIN_OTP_EMAIL
```

---

## 🔒 How to Set Environment Variables in Netlify

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Select your site → **Site configuration** → **Environment variables**
3. Click **Add a variable** or edit existing ones
4. Add each variable with its new value
5. Click **Save**
6. **Redeploy** your site to apply changes

---

## 🧹 Git History Cleanup

The credentials are still in your Git history. To fully clean:

### Option 1: BFG Repo-Cleaner (Recommended)
```bash
# Install BFG
brew install bfg

# Clone a fresh copy
git clone --mirror git@github.com:omer3kale/botzzz773.git

# Remove secrets
bfg --delete-files .env.example --delete-files .env.production botzzz773.git

# Clean up
cd botzzz773.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive

# Force push
git push --force
```

### Option 2: Contact GitHub Support
Request a [cache purge](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) after cleaning history.

---

## ✅ Post-Rotation Verification

After rotating all credentials:

1. **Test signin flow** at https://www.botzzz773.pro/signin.html
2. **Test OTP email delivery** (admin login)
3. **Test database operations** (view services, create order)
4. **Test payments** (add funds flow)

---

## 🛡️ Prevention Tips

1. **Never commit `.env` files** - Use `.env.example` with placeholders only
2. **Use Netlify Environment Variables** for all secrets
3. **Enable GitHub Secret Scanning** in repository settings
4. **Use `.gitignore`** properly (already updated)
5. **Consider using GitHub Secrets** for CI/CD

---

**Last Updated:** November 27, 2025
