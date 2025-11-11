# Google OAuth Setup Guide for BOTZZZ773

## Why You Need This

The current Google Client ID (`330182310617-douv2oleom0f2f9ak27qhh5t6om5tu06.apps.googleusercontent.com`) belongs to another project called "darling profiterole". This is why redirects are going to the wrong domain.

You need to create **YOUR OWN** Google OAuth credentials for your site.

---

## Step-by-Step Setup

### 1. Go to Google Cloud Console
Visit: https://console.cloud.google.com/

### 2. Create a New Project (or select existing)
- Click on the project dropdown at the top
- Click "New Project"
- Name it: **BOTZZZ773 SMM Panel** (or your preferred name)
- Click "Create"

### 3. Enable Google+ API
- In the sidebar, go to **APIs & Services** > **Library**
- Search for "**Google+ API**"
- Click on it and press "**Enable**"

### 4. Create OAuth 2.0 Credentials

#### Step 4a: Configure OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** (unless you have a Google Workspace)
3. Click "Create"
4. Fill in the required fields:
   - **App name**: BOTZZZ773 SMM Panel
   - **User support email**: your-email@example.com
   - **Developer contact email**: your-email@example.com
5. Click "Save and Continue"
6. **Scopes**: Click "Add or Remove Scopes"
   - Select: `email`, `profile`, `openid`
   - Click "Update" then "Save and Continue"
7. **Test users**: Add your email for testing
8. Click "Save and Continue"
9. Review and click "Back to Dashboard"

#### Step 4b: Create OAuth Client ID
1. Go to **APIs & Services** > **Credentials**
2. Click "**+ CREATE CREDENTIALS**" > "**OAuth client ID**"
3. Application type: **Web application**
4. Name: **BOTZZZ773 Web Client**
5. **Authorized JavaScript origins**:
   - http://localhost:8888 (for local testing)
   - https://your-actual-domain.netlify.app (your production URL)
   - https://your-custom-domain.com (if you have one)
6. **Authorized redirect URIs**:
   - http://localhost:8888/signin.html
   - http://localhost:8888/signup.html
   - https://your-actual-domain.netlify.app/signin.html
   - https://your-actual-domain.netlify.app/signup.html
7. Click "**Create**"

### 5. Copy Your Client ID
- You'll see a popup with your **Client ID** and **Client Secret**
- Copy the **Client ID** (looks like: `123456789-abcdefghijklmnop.apps.googleusercontent.com`)
- You don't need the Client Secret for this implementation

---

## Update Your Code

### 1. Update `signin.html`

Find this line (around line 105):
```html
data-client_id="YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```

Replace `YOUR_GOOGLE_CLIENT_ID` with your actual Client ID:
```html
data-client_id="123456789-abcdefghijklmnop.apps.googleusercontent.com"
```

Also update the `data-login_uri`:
```html
data-login_uri="https://your-actual-domain.netlify.app/signin.html"
```

### 2. Update `signup.html`

Find this line (around line 140):
```html
data-client_id="YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
```

Replace `YOUR_GOOGLE_CLIENT_ID` with your actual Client ID:
```html
data-client_id="123456789-abcdefghijklmnop.apps.googleusercontent.com"
```

Also update the `data-login_uri`:
```html
data-login_uri="https://your-actual-domain.netlify.app/signup.html"
```

### 3. Remove the Temporary Note

After updating the Client ID, you can remove this section from both files:
```html
<!-- Temporary message while Google OAuth is being set up -->
<div style="margin-top: 10px; padding: 10px; background: rgba(255, 20, 148, 0.1); border-radius: 8px; font-size: 0.85rem; color: var(--text-gray);">
    <strong>Note:</strong> Google Sign-In requires OAuth configuration. Please use email/password login.
</div>
```

---

## Backend Integration (Optional - for Future)

Currently, the Google Sign-In buttons show a message. To make them fully functional:

### 1. Update Auth Function

Add this to `netlify/functions/auth.js`:

```javascript
case 'google-signin':
case 'google-signup':
    return await handleGoogleAuth(data, headers);
```

### 2. Create Google Auth Handler

```javascript
async function handleGoogleAuth({ credential, email, name, picture }, headers) {
  try {
    // Verify the Google token (optional but recommended)
    // const ticket = await client.verifyIdToken({
    //     idToken: credential,
    //     audience: process.env.GOOGLE_CLIENT_ID
    // });
    
    // Check if user exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (existingUser) {
      // User exists - login
      const token = createToken(existingUser);
      delete existingUser.password_hash;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          token,
          user: existingUser
        })
      };
    } else {
      // New user - signup
      const username = email.split('@')[0] + '_' + Math.random().toString(36).substring(7);
      
      const { data: newUser, error } = await supabaseAdmin
        .from('users')
        .insert({
          email,
          username,
          full_name: name,
          password_hash: '', // Google users don't need password
          role: 'user',
          status: 'active',
          avatar: picture
        })
        .select()
        .single();

      if (error) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ success: false, error: 'Failed to create user' })
        };
      }

      const token = createToken(newUser);
      delete newUser.password_hash;

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          token,
          user: newUser
        })
      };
    }
  } catch (error) {
    console.error('Google auth error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error' })
    };
  }
}
```

### 3. Update Frontend Handlers

Uncomment the fetch code in `signin.html` and `signup.html`:

```javascript
// In handleGoogleSignIn function
const response = await fetch('/.netlify/functions/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        action: 'google-signin',
        credential: credential,
        email: payload.email,
        name: payload.name,
        picture: payload.picture
    })
});

const data = await response.json();

if (data.success) {
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = 'dashboard.html';
} else {
    alert('Google Sign-In failed: ' + data.error);
}
```

---

## Testing

### Local Testing
1. Make sure your Client ID includes `http://localhost:8888` in authorized origins
2. Run: `netlify dev`
3. Visit: `http://localhost:8888/signin.html`
4. Click "Continue with Google"
5. Should redirect properly to your local site

### Production Testing
1. Deploy to Netlify
2. Make sure your Client ID includes your Netlify URL
3. Visit your production site
4. Test Google Sign-In

---

## Common Issues

### Issue: "redirect_uri_mismatch"
**Solution**: Make sure your redirect URI in Google Console exactly matches your site URL

### Issue: "idpiframe_initialization_failed"
**Solution**: Make sure cookies are enabled and you're not in incognito mode

### Issue: "popup_closed_by_user"
**Solution**: This is normal - user closed the popup without completing sign-in

### Issue: Still redirecting to "darling profiterole"
**Solution**: You're still using the old Client ID. Double-check you replaced it with YOUR Client ID

---

## Security Notes

1. **Never commit your Client Secret** to Git (you don't need it for this implementation anyway)
2. **Restrict your authorized domains** to only your actual domains
3. **Use environment variables** for sensitive data in backend
4. **Validate tokens server-side** before trusting user data

---

## Environment Variables (If Using Backend Integration)

Add to Netlify:
```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret (optional)
```

---

## Quick Checklist

- [ ] Created Google Cloud Project
- [ ] Enabled Google+ API
- [ ] Configured OAuth Consent Screen
- [ ] Created OAuth 2.0 Client ID
- [ ] Added authorized JavaScript origins
- [ ] Added authorized redirect URIs
- [ ] Copied Client ID
- [ ] Updated `signin.html` with new Client ID
- [ ] Updated `signup.html` with new Client ID
- [ ] Updated login URIs to match your domain
- [ ] Tested locally
- [ ] Tested in production
- [ ] (Optional) Implemented backend Google auth handler

---

## Support

If you need help:
1. Check Google Cloud Console error messages
2. Check browser console for errors
3. Verify all URLs match exactly (including http:// vs https://)
4. Make sure Client ID is copied correctly (no extra spaces)

---

**Your site will redirect properly once you use YOUR OWN Google OAuth credentials!** 🚀
