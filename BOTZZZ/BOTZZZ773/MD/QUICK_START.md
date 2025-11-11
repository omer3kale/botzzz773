# 🚀 QUICK START - Go Live in 20 Minutes

## Step 1: Get Payeer Merchant Credentials (5 min)

1. Login to https://payeer.com/ (Account: P1135223884)
2. Go to **Merchant** → **Settings**
3. Copy your **Merchant ID**
4. Copy your **Secret Key**
5. Open `.env` file and add:
```
PAYEER_MERCHANT_ID=your_merchant_id_here
PAYEER_SECRET_KEY=your_secret_key_here
```

## Step 2: Deploy to Netlify (5 min)

```bash
# Login to Netlify
netlify login

# Initialize site
netlify init

# Deploy
netlify deploy --prod
```

Follow prompts:
- Create new site
- Team: Your team
- Site name: your-smm-panel (or custom)
- Publish directory: `.` (current directory)

After deploy, you'll get: `https://your-smm-panel.netlify.app`

## Step 3: Configure Environment Variables in Netlify (3 min)

Go to Netlify Dashboard → Your Site → Site Settings → Environment Variables

Add these variables (copy from your `.env` file):

```
SUPABASE_URL=https://qmnbwpmnidguccsiwoow.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
JWT_SECRET=dvSFnsIPha...
PAYEER_MERCHANT_ID=your_merchant_id
PAYEER_SECRET_KEY=your_secret_key
PAYEER_ACCOUNT=P1135223884
SITE_URL=https://your-smm-panel.netlify.app
```

Click **Save**

## Step 4: Redeploy (1 min)

```bash
netlify deploy --prod
```

This applies the environment variables.

## Step 5: Configure Payeer Webhook (2 min)

1. Back to Payeer → Merchant → Settings
2. Set **Status URL** (webhook):
```
https://your-smm-panel.netlify.app/.netlify/functions/payeer
```
3. Save settings

## Step 6: Add SMM Provider (10 min)

1. Visit your site: `https://your-smm-panel.netlify.app`
2. Login with admin credentials:
   - Email: `admin@botzzz.com`
   - Password: `admin123` (change this immediately!)
3. Go to **Admin Panel** → **Providers**
4. Click **Add Provider**
5. Enter provider details:
   - Name: (e.g., "JustAnotherPanel")
   - API URL: (e.g., `https://justanotherpanel.com/api/v2`)
   - API Key: (your provider API key)
6. Click **Test Connection**
7. If successful, click **Sync Services**
8. Services will be imported automatically

## Step 7: Test Everything (5 min)

### Test Payments:
1. Logout from admin
2. Create test user account
3. Go to **Add Funds**
4. Enter $10
5. Click **Pay with Payeer**
6. Complete payment (use real or test Payeer account)
7. Check if balance updated

### Test Orders:
1. Go to **Services**
2. Select a service
3. Enter link and quantity
4. Place order
5. Check **Orders** page
6. Verify order appears

### Test Admin Panel:
1. Login as admin
2. Check **Dashboard** stats
3. View all users
4. View all orders
5. Check provider status

## Step 8: Change Admin Password (1 min)

1. As admin, go to **Settings** or **Profile**
2. Change password from `admin123` to something secure
3. Save

## Step 9: Customize Site (Optional)

- Update site name in settings
- Add your logo to `assets/` folder
- Update colors in CSS
- Add your contact information

## Step 10: Go Live! 🎉

Your SMM reseller panel is now LIVE and ready to accept customers!

---

## 📞 Support Checklist

Make sure you have:
- ✅ Provider API access
- ✅ Provider balance topped up
- ✅ Payeer account verified
- ✅ Admin password changed
- ✅ Contact email updated

---

## 🔒 Security Notes

After launch:
1. Change admin password immediately
2. Enable 2FA on Payeer
3. Monitor orders daily
4. Keep provider balance topped up
5. Regular database backups (Supabase auto-backups)

---

**Total Time: ~22 minutes**

**You're ready to start making money! 💰**
