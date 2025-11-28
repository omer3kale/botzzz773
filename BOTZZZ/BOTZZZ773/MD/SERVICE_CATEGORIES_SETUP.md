# Service Categories - Setup Guide

## 🎯 What's New

Your admin services page now has **dynamic category management**! 

### Features Added:
1. ✅ **Create custom categories** - No more hardcoded Instagram/TikTok/YouTube
2. ✅ **Categories persist in database** - Saved in `service_categories` table
3. ✅ **Automatic dropdown updates** - New categories appear instantly in Add Service form
4. ✅ **Edit service categories** - All services can use any custom category
5. ✅ **Default categories included** - Instagram, TikTok, YouTube, Twitter, Facebook

---

## 🚀 Quick Setup (REQUIRED - One Time Only)

### Step 1: Run Database Migration

You need to create the `service_categories` table in your Supabase database.

**Option A: Using Supabase Dashboard (Recommended)**

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project → **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of this file:
   ```
   supabase/migrations/20251119_create_service_categories.sql
   ```
5. Paste into the SQL Editor
6. Click **Run** (or press Cmd/Ctrl + Enter)
7. You should see: "Success. No rows returned"

**Option B: Using Node.js Script**

```bash
node migrate-categories.js
```

This will:
- Connect to your Supabase database
- Create the `service_categories` table
- Insert 5 default categories (Instagram, TikTok, YouTube, Twitter, Facebook)
- Verify the migration worked

---

## ✅ Verification

After running the migration, verify it worked:

### Check in Supabase Dashboard:
1. Go to **Table Editor** → Look for `service_categories` table
2. You should see 5 rows with the default categories

### Check on Your Site:
1. Go to https://botzzz773.pro/admin/services.html
2. Click **Add Service** button
3. Look at the **Category** dropdown
4. You should see: Instagram, TikTok, YouTube, Twitter, Facebook

---

## 📝 How to Use

### Creating a New Category

1. **Admin → Services** page
2. Click **Create Category** button (top right)
3. Fill in the form:
   - **Category Name**: e.g., "Spotify"
   - **Icon**: Font Awesome class, e.g., "fab fa-spotify"
   - **Display Order**: Controls position in dropdown (1 = first)
   - **Status**: Active or Inactive
4. Click **Create Category**
5. Page will reload and your new category appears in dropdowns!

### Adding a Service with New Category

1. Click **Add Service** button
2. **Category dropdown** now shows all your custom categories
3. Select the category you just created
4. Fill in other service details
5. Click **Create Service**
6. Service appears in the table with the correct category!

### Quick Link in Add Service Form

When adding a service, you'll see:
```
Category *
[Select Category ▼]
5 categories available • Create new category
```

Click "Create new category" to open the category creation form without leaving the Add Service modal.

---

## 🔍 Technical Details

### Database Schema

```sql
service_categories
├── id (UUID, Primary Key)
├── name (TEXT, UNIQUE) - Display name
├── slug (TEXT, UNIQUE) - URL-friendly version
├── description (TEXT) - Optional description
├── icon (TEXT) - Font Awesome icon class
├── display_order (INTEGER) - Sort order
├── parent_id (UUID) - For nested categories (future)
├── status (TEXT) - 'active' or 'inactive'
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)
```

### API Endpoints

**Fetch Categories:**
```javascript
GET /.netlify/functions/services?type=categories
```

**Create Category:**
```javascript
POST /.netlify/functions/services
{
  "action": "create-category",
  "name": "Spotify",
  "description": "Spotify services",
  "icon": "fab fa-spotify"
}
```

### Frontend Caching

Categories are cached in memory for performance:
```javascript
let categoriesCache = null; // Auto-fetched on first use

// Manually refresh cache:
window.invalidateCategoriesCache();
```

---

## 🎨 Icon Examples

Use [Font Awesome](https://fontawesome.com/icons) icons:

| Platform | Icon Class |
|----------|------------|
| Instagram | `fab fa-instagram` |
| TikTok | `fab fa-tiktok` |
| YouTube | `fab fa-youtube` |
| Twitter/X | `fab fa-twitter` |
| Facebook | `fab fa-facebook` |
| Spotify | `fab fa-spotify` |
| Discord | `fab fa-discord` |
| Telegram | `fab fa-telegram` |
| Twitch | `fab fa-twitch` |
| LinkedIn | `fab fa-linkedin` |
| Reddit | `fab fa-reddit` |
| Pinterest | `fab fa-pinterest` |
| Snapchat | `fab fa-snapchat` |
| WhatsApp | `fab fa-whatsapp` |

---

## 🐛 Troubleshooting

### "No categories available" in dropdown

**Problem**: Migration didn't run or failed
**Solution**: Run the migration again (see Step 1 above)

### New category doesn't appear immediately

**Problem**: Cache not invalidated
**Solution**: 
- Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
- Or wait 5 seconds and refresh normally
- Cache auto-invalidates after category creation

### Category dropdown shows old hardcoded list

**Problem**: Browser cached old JavaScript
**Solution**:
- Clear browser cache
- Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
- Try incognito/private window

---

## 📊 Migration Details

**Deploy ID**: 691da4427de80700ad6d36b4  
**Production URL**: https://botzzz773.pro  
**Deployed**: November 19, 2025  

**Files Modified**:
- `netlify/functions/services.js` - Added category endpoints
- `js/admin-services.js` - Dynamic category fetching
- `supabase/migrations/20251119_create_service_categories.sql` - Database schema

**Commit**: `ca02678` - "feat: Dynamic category management for services"

---

## 🎉 Next Steps

1. ✅ Run the migration (see Step 1 above)
2. ✅ Verify categories appear in Add Service form
3. ✅ Create your first custom category
4. ✅ Add services using the new categories

**Need help?** Check the Supabase logs or browser console for errors.

---

## 📌 Important Notes

- **Default categories** (Instagram, TikTok, YouTube, Twitter, Facebook) are auto-created
- **Existing services** will continue to use their current category strings
- **Category slugs** are auto-generated (lowercase, hyphenated)
- **Unique constraint**: Can't create duplicate category names
- **Soft delete**: Inactive categories are hidden but not deleted

---

**Status**: ✅ DEPLOYED TO PRODUCTION  
**Last Updated**: November 19, 2025
