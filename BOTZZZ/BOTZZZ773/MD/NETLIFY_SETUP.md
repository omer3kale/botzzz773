# 🚀 Connect to Netlify - Quick Setup

## ✅ Repository Successfully Pushed!

Your code is now at: **https://github.com/omer3kale/botzzz773.git**

---

## 📋 Connect to Netlify (2 Methods)

### Method 1: Netlify Dashboard (Recommended - Easiest)

1. **Go to Netlify Dashboard**
   - Visit: https://app.netlify.com/

2. **Add New Site**
   - Click "Add new site" → "Import an existing project"

3. **Connect to GitHub**
   - Click "GitHub"
   - Authorize Netlify if needed
   - Search for and select: `botzzz773`

4. **Configure Build Settings**
   ```
   Base directory: BOTZZZ/BOTZZZ773
   Build command: (leave empty)
   Publish directory: BOTZZZ/BOTZZZ773
   Functions directory: BOTZZZ/BOTZZZ773/netlify/functions
   ```

5. **Add Environment Variables** (CRITICAL!)
   Click "Show advanced" → "New variable" and add:
   
   ```
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   JWT_SECRET=your_jwt_secret
   GOOGLE_CLIENT_ID=your_google_client_id
   FRONTEND_URL=https://botzzz773.pro
   SITE_URL=https://botzzz773.pro
   NODE_ENV=production
   ```

6. **Deploy!**
   - Click "Deploy site"
   - Wait for deployment to complete

7. **Set Custom Domain**
   - Go to Site settings → Domain management
   - Add custom domain: `botzzz773.pro`
   - Configure DNS as instructed

---

### Method 2: Netlify CLI (Alternative)

1. **Link to Netlify Site**
   ```powershell
   cd "c:\Users\ÖmerÜckale\OneDrive - NEA X GmbH\Desktop\vs code files\BOTZZZ\BOTZZZ773"
   netlify link
   ```
   
2. **Set Environment Variables**
   ```powershell
   netlify env:set SUPABASE_URL "your_value"
   netlify env:set SUPABASE_ANON_KEY "your_value"
   netlify env:set SUPABASE_SERVICE_ROLE_KEY "your_value"
   netlify env:set JWT_SECRET "your_value"
   netlify env:set GOOGLE_CLIENT_ID "your_value"
   netlify env:set FRONTEND_URL "https://botzzz773.pro"
   netlify env:set SITE_URL "https://botzzz773.pro"
   netlify env:set NODE_ENV "production"
   ```

3. **Deploy**
   ```powershell
   netlify deploy --prod --dir=. --functions=netlify/functions
   ```

---

## 🔧 After Deployment

### 1. Update GitHub OAuth (if using Google Sign-In)
- Go to: https://console.cloud.google.com/
- Navigate to your OAuth credentials
- Add authorized origins:
  - `https://botzzz773.pro`
  - `https://your-netlify-site.netlify.app` (your Netlify URL)

### 2. Update Supabase Settings
- Go to Supabase dashboard
- Project Settings → API
- Add site URL to allowed URLs

### 3. Test Everything
- [ ] Visit your deployed site
- [ ] Test sign-up (create new account)
- [ ] Test sign-in
- [ ] Test Google OAuth
- [ ] Test placing an order
- [ ] Test admin panel access (only for admin users)
- [ ] Test contact form

---

## 📊 Netlify Build Settings

Your `netlify.toml` is already configured with:
- ✅ Functions directory: `netlify/functions`
- ✅ Publish directory: `.` (root)
- ✅ Redirects for API routes
- ✅ Security headers
- ✅ CORS settings

**No additional configuration needed!**

---

## 🎯 Expected Deployment Structure

```
Netlify Site Root (BOTZZZ/BOTZZZ773/)
├── index.html
├── signin.html
├── signup.html
├── dashboard.html
├── admin/
│   ├── index.html
│   ├── users.html
│   └── ...
├── js/
│   ├── auth-backend.js
│   ├── admin-auth.js
│   └── ...
└── netlify/functions/
    ├── auth.js
    ├── orders.js
    ├── dashboard.js
    └── ...
```

---

## ⚠️ Important Notes

1. **Base Directory**: Make sure Netlify uses `BOTZZZ/BOTZZZ773` as base directory
2. **Environment Variables**: Must be set in Netlify dashboard
3. **Custom Domain**: DNS propagation may take 24-48 hours
4. **SSL Certificate**: Netlify auto-provisions Let's Encrypt SSL

---

## 🐛 Troubleshooting

### Functions not working?
- Check Netlify Functions logs in dashboard
- Verify environment variables are set
- Check `netlify.toml` functions directory path

### Can't sign up/sign in?
- Verify Supabase env vars are correct
- Check browser console for errors
- Check Netlify Functions logs

### Admin panel accessible by non-admins?
- Check `js/admin-auth.js` is loaded
- Verify user role in database is 'admin'

---

## 🚀 Quick Deploy Command

```powershell
# One-line deploy after setup
cd "c:\Users\ÖmerÜckale\OneDrive - NEA X GmbH\Desktop\vs code files\BOTZZZ\BOTZZZ773"
git add . && git commit -m "Update" && git push origin master
```

Netlify will auto-deploy on push to master!

---

**Repository:** https://github.com/omer3kale/botzzz773.git  
**Site Ready:** All fixes applied, production ready! 🎉
