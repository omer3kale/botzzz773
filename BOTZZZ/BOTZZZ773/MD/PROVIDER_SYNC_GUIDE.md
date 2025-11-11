# How to Sync Services from g1618 Provider

## ✅ Changes Applied

I've fixed the provider sync functionality. Previously it was **fake/mock** - now it's **real** and will actually pull services from your g1618 API.

## Method 1: Admin Panel UI (Easiest) ⭐

### Steps:

1. **Deploy the updated code first:**
   ```powershell
   netlify deploy --prod
   ```

2. **Go to Admin Panel:**
   - Navigate to **Settings** → **Providers** section

3. **Find Your g1618 Provider Card:**
   - You'll see a card with:
     - Name: `g1618-1762341096654`
     - API URL: `https://g1618.com`
     - Status: Active

4. **Click "Sync Services" Button:**
   - A modal will appear showing progress
   - It will call your backend API
   - Backend will connect to g1618.com
   - Fetch all available services
   - Import them into your database

5. **Check Results:**
   - Modal will show:
     ```
     Successfully synced services!
     Added: X
     Updated: Y
     Total: Z
     ```

6. **Verify:**
   - Go to **Admin** → **Services**
   - You should see Instagram, TikTok, YouTube services imported

---

## Method 2: Browser Console (Manual) 🔧

If the button doesn't work or you want to test manually:

1. **Open Admin Settings page**
2. **Open Browser Console** (F12)
3. **Paste and run this:**

```javascript
const token = localStorage.getItem('token');

fetch('/.netlify/functions/providers', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
        action: 'sync',
        providerId: 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
    })
})
.then(r => r.json())
.then(data => {
    console.log('✅ Sync result:', data);
    if (data.success) {
        alert(`Success!\nAdded: ${data.added}\nUpdated: ${data.updated}\nTotal: ${data.total}`);
    } else {
        alert('Error: ' + data.error);
    }
});
```

---

## Method 3: SQL Query (Database Level) 🗄️

**After syncing via Method 1 or 2**, verify in Supabase:

```sql
-- Check services were imported
SELECT COUNT(*) as total_services
FROM services 
WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';

-- See service breakdown by category
SELECT 
    category,
    COUNT(*) as count
FROM services 
WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
GROUP BY category;

-- Check provider was updated
SELECT 
    name,
    services_count,
    last_sync
FROM providers 
WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';
```

---

## What the Sync Does Internally

### Backend Flow (`netlify/functions/providers.js`):

1. **Receives sync request** with provider ID
2. **Fetches provider credentials** from Supabase
3. **Calls g1618.com API** (`https://g1618.com/api/v2?action=services&key=YOUR_KEY`)
4. **For each service returned:**
   - Checks if it already exists (by `provider_service_id`)
   - If exists → Updates price/details
   - If new → Creates new service record
5. **Updates provider record:**
   - Sets `last_sync = NOW()`
   - Updates `services_count`
6. **Returns summary:** `{ success: true, added: X, updated: Y, total: Z }`

---

## Troubleshooting

### ❌ "Failed to sync: Invalid API key"
**Solution:** Update your g1618 API key in database:
```sql
UPDATE providers 
SET api_key = 'your-correct-api-key'
WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';
```

### ❌ "Failed to sync: Connection timeout"
**Solution:** g1618.com might be down or slow. Try again in a few minutes.

### ❌ "Added: 0, Updated: 0"
**Possible causes:**
1. g1618 API returned empty service list
2. API format changed (check backend logs)
3. All services already exist and haven't changed

**Check backend logs:**
```powershell
# In your project directory
netlify dev
```
Then trigger sync and watch the console output.

### ✅ "Added: 150, Updated: 0" 
**Perfect!** First sync imported 150 new services.

### ✅ "Added: 0, Updated: 150"
**Perfect!** Services already existed, but prices/details were updated.

---

## After Syncing

1. **Set Markup** (if not already set):
   ```sql
   UPDATE providers 
   SET markup = 20.00
   WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';
   ```

2. **Activate Services**:
   ```sql
   UPDATE services 
   SET status = 'active'
   WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
     AND status = 'inactive';
   ```

3. **Test on Frontend:**
   - Go to your public website
   - Navigate to Order page
   - Services should appear in dropdown
   - Prices should reflect your markup

---

## Automatic Sync (Optional Future Enhancement)

To automatically sync daily, you could:

1. **Add a Netlify Scheduled Function:**
   ```javascript
   // netlify/functions/scheduled-sync.js
   exports.handler = async (event) => {
     // Call sync for all active providers
     // Run daily at 3 AM
   };
   ```

2. **Or use Supabase Cron:**
   ```sql
   SELECT cron.schedule(
     'sync-providers',
     '0 3 * * *', -- 3 AM daily
     $$ SELECT sync_all_providers() $$
   );
   ```

For now, manual sync via admin panel is sufficient.

---

## Summary

✅ **Fixed Code:** `syncProvider()` now calls real API  
✅ **Fixed Code:** `testProvider()` now tests real connection  
✅ **Method 1:** Use "Sync Services" button in Admin UI  
✅ **Method 2:** Run JavaScript in browser console  
✅ **Method 3:** Verify results in SQL  

**Deploy and try it now!** 🚀
