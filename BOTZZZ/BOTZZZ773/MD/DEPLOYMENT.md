# 🚀 Backend Deployment Guide

## Backend Infrastructure Setup Complete! ✅

Your SMM reseller panel now has a **production-ready serverless backend** with:

### ✅ What's Been Built:

1. **Database Schema** (Supabase PostgreSQL)
   - 11 tables with UUID primary keys
   - Row Level Security (RLS) policies
   - Performance indexes
   - Automatic timestamps

2. **Serverless API Functions** (Netlify Functions)
   - ✅ Authentication (signup, login, logout, password reset)
   - ✅ Users management
   - ✅ Orders (create, view, refill, cancel)
   - ✅ Services (CRUD operations)
   - ✅ Payments (Stripe integration)
   - ✅ Tickets (support system)
   - ✅ Providers (SMM API integration)

3. **Packages Installed**
   - @supabase/supabase-js (database client)
   - Express.js (API framework)
   - bcryptjs (password hashing)
   - jsonwebtoken (JWT authentication)
   - Stripe SDK (payment processing)
   - axios (HTTP requests)
   - netlify-cli (deployment tool)

---

## 📋 Deployment Steps:

### Step 1: Set Up Supabase Database

1. Go to [https://supabase.com](https://supabase.com)
2. Create a new project
3. Copy the project URL and keys:
   - Project URL (looks like: `https://xxxxx.supabase.co`)
   - Anon/Public Key
   - Service Role Key (keep secret!)

4. In your Supabase dashboard, go to **SQL Editor**
5. Copy the entire contents of `supabase/schema.sql`
6. Paste and run it in the SQL Editor
7. Your database is now ready! ✅

### Step 2: Configure Environment Variables

1. Open the `.env` file in your project root
2. Fill in all the values from your Supabase project:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# JWT Secret (generate a random string)
JWT_SECRET=your-super-secret-random-string-here

# Stripe Payment (get from stripe.com dashboard)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# PayPal (optional - get from paypal.com)
PAYPAL_CLIENT_ID=your-paypal-client-id
PAYPAL_SECRET=your-paypal-secret

# Email Service (get from sendgrid.com)
SENDGRID_API_KEY=SG.your_sendgrid_api_key

# Site Configuration
SITE_URL=https://your-site.netlify.app
SITE_NAME=BOTZZZ
```

3. **Generate a secure JWT_SECRET:**
   - Run: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
   - Or use an online generator

### Step 3: Deploy to Netlify

1. Install Netlify CLI (already installed):
   ```bash
   netlify login
   ```

2. Initialize your site:
   ```bash
   netlify init
   ```
   - Choose "Create & configure a new site"
   - Select your team
   - Enter site name (e.g., "botzzz-smm-panel")

3. Set environment variables in Netlify:
   ```bash
   netlify env:set SUPABASE_URL "your-value"
   netlify env:set SUPABASE_ANON_KEY "your-value"
   netlify env:set SUPABASE_SERVICE_ROLE_KEY "your-value"
   netlify env:set JWT_SECRET "your-value"
   netlify env:set STRIPE_SECRET_KEY "your-value"
   netlify env:set STRIPE_PUBLISHABLE_KEY "your-value"
   netlify env:set SITE_URL "https://your-site.netlify.app"
   ```

4. Deploy your site:
   ```bash
   netlify deploy --prod
   ```

5. Your site is live! 🎉

### Step 4: Configure Stripe Webhooks

1. Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Enter endpoint URL: `https://your-site.netlify.app/api/payments`
4. Select event: `checkout.session.completed`
5. Copy the webhook signing secret
6. Add to Netlify:
   ```bash
   netlify env:set STRIPE_WEBHOOK_SECRET "whsec_your_secret"
   ```

### Step 5: Update Frontend to Use Backend

The frontend currently uses localStorage. You'll need to update:

1. **js/auth.js** - Replace localStorage auth with API calls to `/api/auth`
2. **Admin pages** - Update to fetch data from `/api/users`, `/api/orders`, etc.
3. **Order forms** - Submit to `/api/orders` instead of localStorage

Example API call:
```javascript
// Login example
const response = await fetch('/api/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'login',
    email: 'user@example.com',
    password: 'password123'
  })
});

const data = await response.json();
if (data.success) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
}
```

---

## 🔧 Testing Locally

Test your functions locally before deployment:

```bash
netlify dev
```

This will start a local server at `http://localhost:8888` with your functions running.

---

## 📊 Database Admin Access

**Default Admin User** (created in schema.sql):
- Email: `admin@botzzz.com`
- Password: `admin123` (change this immediately!)
- Role: `admin`

Login at: `https://your-site.netlify.app/admin/login.html`

---

## 🔐 Security Checklist

- [ ] Change default admin password
- [ ] Set strong JWT_SECRET (64+ characters)
- [ ] Enable HTTPS (Netlify does this automatically)
- [ ] Configure CORS properly
- [ ] Set up rate limiting (consider Cloudflare)
- [ ] Enable Stripe webhook signature verification
- [ ] Set up monitoring and error tracking

---

## 📱 API Endpoints

All endpoints are available at: `https://your-site.netlify.app/api/[endpoint]`

### Authentication (`/api/auth`)
- POST `{ action: 'signup', email, password, username }`
- POST `{ action: 'login', email, password }`
- POST `{ action: 'verify', token }`
- POST `{ action: 'logout', token }`

### Users (`/api/users`)
- GET - List all users (admin) or current user
- PUT - Update user profile
- DELETE - Delete user (admin only)

### Orders (`/api/orders`)
- GET - List orders
- POST - Create new order
- PUT - Update/refill order
- DELETE - Cancel order

### Services (`/api/services`)
- GET - List all active services
- POST - Create service (admin)
- PUT - Update service (admin)
- DELETE - Delete service (admin)

### Payments (`/api/payments`)
- POST `{ action: 'create-checkout', amount, method }`
- POST `{ action: 'history' }`

### Tickets (`/api/tickets`)
- GET - List tickets
- POST - Create ticket
- PUT - Reply/update ticket

### Providers (`/api/providers`)
- GET - List providers (admin)
- POST `{ action: 'test', apiUrl, apiKey }` - Test connection
- POST `{ action: 'sync', providerId }` - Sync services
- PUT - Update provider
- DELETE - Delete provider

---

## 🎯 Next Steps

1. **Deploy the database** (run schema.sql in Supabase)
2. **Fill in `.env`** with your credentials
3. **Deploy to Netlify** using `netlify deploy --prod`
4. **Configure Stripe webhooks**
5. **Update frontend** to call API endpoints
6. **Test everything** before going live!

---

## 🆘 Need Help?

- **Supabase Docs:** https://supabase.com/docs
- **Netlify Functions:** https://docs.netlify.com/functions/overview/
- **Stripe Integration:** https://stripe.com/docs/api

Your backend is production-ready! 🚀
