# ⚡ Quick Start - Get Live in 20 Minutes!

## Step 1: Supabase Setup (5 min) ⏱️

1. **Create Account:** https://supabase.com → Sign up
2. **New Project:** Click "New Project"
   - Name: `botzzz-smm`
   - Database Password: (generate strong password)
   - Region: Choose closest to users
   - Click "Create new project" (takes 2 min)

3. **Get Credentials:**
   - Go to Settings → API
   - Copy:
     - `Project URL`
     - `anon public` key
     - `service_role` key (⚠️ keep secret!)

4. **Create Database:**
   - Go to SQL Editor
   - Click "New query"
   - Open `supabase/schema.sql` from your project
   - Copy ALL content
   - Paste in SQL Editor
   - Click "Run" (bottom right)
   - ✅ Should see "Success. No rows returned"

---

## Step 2: Environment Setup (3 min) ⏱️

1. **Open `.env` file** in your project

2. **Fill in Supabase values:**
```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
```

3. **Generate JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copy the output and paste in `.env`:
```env
JWT_SECRET=your-generated-secret-here
```

4. **Stripe Keys** (get test keys for now):
   - Go to https://dashboard.stripe.com
   - Developers → API keys
   - Copy "Publishable key" and "Secret key"
```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

5. **Site URL** (will update after Netlify):
```env
SITE_URL=http://localhost:8888
```

---

## Step 3: Test Locally (2 min) ⏱️

```bash
npm run dev
```

Should see:
```
◈ Netlify Dev ◈
◈ Server now ready on http://localhost:8888
```

**Test Authentication:**
Open browser → http://localhost:8888/api/auth

Should see: `{"error":"Method not allowed"}` ✅ (means API is working)

**Stop server:** Press `Ctrl + C`

---

## Step 4: Deploy to Netlify (10 min) ⏱️

1. **Login to Netlify:**
```bash
netlify login
```
Opens browser → Authorize

2. **Initialize Site:**
```bash
netlify init
```
- Select: "Create & configure a new site"
- Team: Select your team
- Site name: `botzzz-smm-panel` (or your choice)
- Build command: (leave empty, press Enter)
- Directory to deploy: `.` (press Enter)
- Functions directory: `netlify/functions` (press Enter)

3. **Set Environment Variables:**
```bash
netlify env:set SUPABASE_URL "YOUR_VALUE_FROM_ENV_FILE"
netlify env:set SUPABASE_ANON_KEY "YOUR_VALUE"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "YOUR_VALUE"
netlify env:set JWT_SECRET "YOUR_VALUE"
netlify env:set STRIPE_SECRET_KEY "YOUR_VALUE"
netlify env:set STRIPE_PUBLISHABLE_KEY "YOUR_VALUE"
```

Replace `YOUR_VALUE` with actual values from your `.env` file!

4. **Deploy:**
```bash
netlify deploy --prod
```

Should see:
```
✔ Deployed to main site URL
Website URL: https://botzzz-smm-panel.netlify.app
```

5. **Update Site URL:**
```bash
netlify env:set SITE_URL "https://your-site-name.netlify.app"
```

---

## Step 5: Configure Stripe Webhook (3 min) ⏱️

1. Go to: https://dashboard.stripe.com/webhooks
2. Click: "Add endpoint"
3. Endpoint URL: `https://your-site.netlify.app/api/payments`
4. Select events: `checkout.session.completed`
5. Click: "Add endpoint"
6. Copy "Signing secret" (starts with `whsec_`)
7. Add to Netlify:
```bash
netlify env:set STRIPE_WEBHOOK_SECRET "whsec_YOUR_SECRET"
```

---

## ✅ You're Live!

**Your site:** https://your-site.netlify.app

**Test it:**
1. Go to: https://your-site.netlify.app/admin/login.html
2. Login with:
   - Email: `admin@botzzz.com`
   - Password: `admin123`
3. ⚠️ **IMMEDIATELY change password** in settings!

---

## 🧪 Test Your APIs

**Test Login API:**
```bash
curl -X POST https://your-site.netlify.app/api/auth \
  -H "Content-Type: application/json" \
  -d '{
    "action": "login",
    "email": "admin@botzzz.com",
    "password": "admin123"
  }'
```

Should return: `{"success":true,"token":"...","user":{...}}`

**Test Services API:**
```bash
curl https://your-site.netlify.app/api/services
```

Should return: `{"services":[]}`

---

## 🔧 Common Issues:

**"Database error" when accessing site:**
- Check: Did you run `schema.sql` in Supabase?
- Check: Are environment variables set correctly in Netlify?

**"Unauthorized" errors:**
- Check: Is JWT_SECRET set in Netlify?
- Check: Are you sending Authorization header?

**Stripe webhook not working:**
- Check: Is webhook secret set in Netlify?
- Check: Is webhook URL correct?

**Functions not found:**
- Run: `netlify deploy --prod` again
- Check: netlify.toml has correct functions path

---

## 📱 Next: Connect Frontend

Your backend is live! Now update frontend files:

**Update `js/auth.js`:**
```javascript
// Replace this:
localStorage.setItem('user', JSON.stringify(userData));

// With this:
const response = await fetch('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'login',
    email: email,
    password: password
  })
});
const data = await response.json();
if (data.success) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
}
```

Do similar for all admin pages to fetch from APIs.

---

## 🎉 Congratulations!

You now have:
✅ Database (Supabase PostgreSQL)
✅ Serverless APIs (Netlify Functions)
✅ Authentication (JWT + bcrypt)
✅ Payment Processing (Stripe)
✅ Order System (with provider integration)
✅ Support Tickets
✅ Admin Panel

**Time to launch:** You're 90% there! Just connect frontend to backend APIs.

---

## 🆘 Need Help?

Check these docs:
- **Supabase:** https://supabase.com/docs
- **Netlify:** https://docs.netlify.com
- **Stripe:** https://stripe.com/docs

Or read:
- `DEPLOYMENT.md` - Detailed deployment guide
- `BACKEND_COMPLETE.md` - Full feature list
- API endpoint docs in each function file

**Good luck! 🚀**
