# 🔧 GOOGLE OAUTH FIX - Error 400: origin_mismatch

**Date:** November 3, 2025  
**Error:** `You can't sign in to this app because it doesn't comply with Google's OAuth 2.0 policy`  
**Issue:** JavaScript origin not registered in Google Cloud Console

---

## 🔍 PROBLEM IDENTIFIED

**Current Client ID:** `330182310617-douv2oleom0f2f9ak27qhh5t6om5tu06.apps.googleusercontent.com`

This Client ID belongs to **another project** ("darling profiterole") and is configured for different domains. That's why you're getting the `origin_mismatch` error.

**Your Production URL:** https://botzzz773.pro  
**Configured for:** Different domain (wrong project)

---

## ✅ SOLUTION: Create New Google OAuth Credentials

You have **TWO OPTIONS**:

### **Option 1: Quick Fix - Update Existing Project (Recommended)**
Update the JavaScript origins in your existing Google Cloud project.

### **Option 2: Complete Fix - Create New Project**
Create a brand new OAuth client for BOTZZZ773.

---

## 🚀 OPTION 1: UPDATE EXISTING PROJECT (5 Minutes)

### Step 1: Go to Google Cloud Console
1. Visit: https://console.cloud.google.com/
2. Select the project that owns Client ID: `330182310617-douv2oleom0f2f9ak27qhh5t6om5tu06`
3. Or create/select the correct project if you have multiple

### Step 2: Configure OAuth Consent Screen (If Not Done)
1. Go to: **APIs & Services** → **OAuth consent screen**
2. Choose **External** (unless you have Google Workspace)
3. Fill in app information:
   - **App name:** BOTZZZ773
   - **User support email:** Your email
   - **Developer contact:** Your email
4. Click **Save and Continue**
5. Skip scopes (default is fine)
6. Add test users (your email for testing)
7. Click **Save and Continue**

### Step 3: Update Authorized JavaScript Origins
1. Go to: **APIs & Services** → **Credentials**
2. Click on your OAuth 2.0 Client ID
3. Under **Authorized JavaScript origins**, add:
   ```
   https://botzzz773.pro
   ```
4. For testing, also add:
   ```
   http://localhost:8080
   http://localhost:3000
   http://127.0.0.1:8080
   ```

### Step 4: Update Authorized Redirect URIs
1. In the same screen, under **Authorized redirect URIs**, add:
   ```
   https://botzzz773.pro/signin.html
   https://botzzz773.pro/signup.html
   https://botzzz773.pro/dashboard.html
   ```
2. For testing, also add:
   ```
   http://localhost:8080/signin.html
   http://localhost:8080/signup.html
   ```

### Step 5: Save Changes
1. Click **Save**
2. **IMPORTANT:** Changes may take 5-10 minutes to propagate

---

## 🆕 OPTION 2: CREATE NEW OAUTH CLIENT (10 Minutes)

### Step 1: Create New Project (Optional)
1. Go to: https://console.cloud.google.com/
2. Click project dropdown → **New Project**
3. Name: **BOTZZZ773**
4. Click **Create**

### Step 2: Enable Google+ API
1. Go to: **APIs & Services** → **Library**
2. Search for: **Google+ API**
3. Click **Enable**

### Step 3: Configure OAuth Consent Screen
1. Go to: **APIs & Services** → **OAuth consent screen**
2. Choose **External**
3. Fill in:
   - **App name:** BOTZZZ773 SMM Panel
   - **User support email:** Your email
   - **App logo:** (optional)
   - **Application home page:** https://botzzz773.pro
   - **Application privacy policy:** https://botzzz773.pro/privacy.html
   - **Application terms of service:** https://botzzz773.pro/terms.html
   - **Authorized domains:** botzzz773.pro
   - **Developer contact:** Your email
4. Click **Save and Continue**
5. **Scopes:** Click **Add or Remove Scopes**
   - Select: `email`, `profile`, `openid`
6. Click **Save and Continue**
7. **Test users:** Add your email
8. Click **Save and Continue**
9. Click **Back to Dashboard**

### Step 4: Create OAuth 2.0 Client ID
1. Go to: **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Choose: **Web application**
4. Name: **BOTZZZ773 Web Client**
5. **Authorized JavaScript origins:**
   ```
   https://botzzz773.pro
   http://localhost:8080
   ```
6. **Authorized redirect URIs:**
   ```
   https://botzzz773.pro/signin.html
   https://botzzz773.pro/signup.html
   https://botzzz773.pro/dashboard.html
   http://localhost:8080/signin.html
   http://localhost:8080/signup.html
   ```
7. Click **Create**
8. **COPY YOUR CLIENT ID** (you'll need this!)

---

## 📝 UPDATE YOUR CODE

### Step 1: Update signin.html
Open `signin.html` and find line 103:

**BEFORE:**
```html
data-client_id="330182310617-douv2oleom0f2f9ak27qhh5t6om5tu06.apps.googleusercontent.com"
```

**AFTER:**
```html
data-client_id="YOUR_NEW_CLIENT_ID.apps.googleusercontent.com"
```

Replace `YOUR_NEW_CLIENT_ID` with your actual Client ID from Google Cloud Console.

### Step 2: Update signup.html
Open `signup.html` and find line 152:

**BEFORE:**
```html
data-client_id="330182310617-douv2oleom0f2f9ak27qhh5t6om5tu06.apps.googleusercontent.com"
```

**AFTER:**
```html
data-client_id="YOUR_NEW_CLIENT_ID.apps.googleusercontent.com"
```

### Step 3: Update .env (Optional - for backend validation)
Add to your `.env` file:
```bash
GOOGLE_CLIENT_ID=YOUR_NEW_CLIENT_ID.apps.googleusercontent.com
```

### Step 4: Update Netlify Environment Variables (Optional)
If you want to validate tokens on the backend:
```bash
netlify env:set GOOGLE_CLIENT_ID "YOUR_NEW_CLIENT_ID.apps.googleusercontent.com"
```

---

## 🚀 DEPLOY CHANGES

### Option A: Push to GitHub (Auto-Deploy)
```bash
git add .
git commit -m "Fix: Update Google OAuth Client ID for botzzz773.pro"
git push origin master
```

### Option B: Direct Netlify Deploy
```bash
netlify deploy --prod
```

---

## ✅ VERIFY IT WORKS

### Step 1: Clear Browser Cache
1. Open Chrome DevTools (F12)
2. Right-click refresh button → **Empty Cache and Hard Reload**

### Step 2: Test Sign-In
1. Go to: https://botzzz773.pro/signin.html
2. Click **Sign in with Google**
3. Should now work without errors! ✅

### Step 3: Test Sign-Up
1. Go to: https://botzzz773.pro/signup.html
2. Click **Sign up with Google**
3. Should work without errors! ✅

---

## 🔍 COMMON ISSUES

### Issue: "Error 400: redirect_uri_mismatch"
**Solution:** Add the exact redirect URI to Google Cloud Console:
```
https://botzzz773.pro/signin.html
```

### Issue: "Error 403: access_denied"
**Solution:** Check OAuth consent screen is configured and published.

### Issue: "Error 401: invalid_client"
**Solution:** Double-check Client ID is correct in HTML files.

### Issue: Changes not working
**Solution:** 
1. Wait 5-10 minutes for Google to propagate changes
2. Clear browser cache
3. Test in incognito mode

---

## 📋 CHECKLIST

### Google Cloud Console:
- [ ] OAuth consent screen configured
- [ ] JavaScript origins added: `https://botzzz773.pro`
- [ ] Redirect URIs added: `https://botzzz773.pro/signin.html`
- [ ] Redirect URIs added: `https://botzzz773.pro/signup.html`
- [ ] Client ID copied

### Code Updates:
- [ ] `signin.html` updated with new Client ID
- [ ] `signup.html` updated with new Client ID
- [ ] `.env` updated (optional)
- [ ] Changes committed to git

### Deployment:
- [ ] Pushed to GitHub OR deployed to Netlify
- [ ] Browser cache cleared
- [ ] Tested sign-in with Google
- [ ] Tested sign-up with Google

---

## 🎯 SUMMARY

**Current Problem:**
- Using Client ID from wrong project ("darling profiterole")
- JavaScript origin not registered for `botzzz773.pro`

**Solution:**
1. Go to Google Cloud Console
2. Add `https://botzzz773.pro` to authorized origins
3. Add redirect URIs for signin/signup pages
4. Update Client ID in `signin.html` and `signup.html`
5. Deploy changes
6. Test!

**Expected Result:**
✅ Google Sign-In works on https://botzzz773.pro  
✅ No more `origin_mismatch` errors  
✅ Users can authenticate with Google

---

## 📞 NEED HELP?

If you're still stuck:
1. Check Google Cloud Console error logs
2. Check browser console (F12) for errors
3. Verify Client ID matches exactly
4. Wait 10 minutes after making changes in Google Console

**Your Client ID should look like:**
```
123456789-abcdefg123456.apps.googleusercontent.com
```

Good luck! 🚀
