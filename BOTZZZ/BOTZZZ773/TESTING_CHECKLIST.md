# Testing Checklist - November 19, 2025 Updates

## 🎯 Features Added Today

1. **Horizontal Scroll Fix** - Admin orders table now scrolls horizontally on narrow screens
2. **Dynamic Category Management** - Categories are now stored in database and fetched dynamically
3. **Category Creation** - New categories can be created and immediately appear in dropdowns

---

## ✅ PRE-FLIGHT: Database Migration

**CRITICAL**: Must run BEFORE testing categories!

### Run the Migration

1. Open [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to **SQL Editor**
4. Click **New Query**
5. Open file: `supabase/migrations/20251119_create_service_categories.sql`
6. Copy entire contents
7. Paste into SQL Editor
8. Click **Run** (or Cmd/Ctrl + Enter)

### Verify Migration Success

```sql
SELECT * FROM service_categories ORDER BY display_order;
```

Expected result: 5 rows (Instagram, TikTok, YouTube, Twitter, Facebook)

---

## 🧪 Test 1: Horizontal Scroll on Admin Orders

### Test Steps

1. ✅ Open: https://botzzz773.pro/admin/orders.html
2. ✅ Login as admin
3. ✅ Resize browser window to < 1600px wide (or use DevTools responsive mode)
4. ✅ Look for horizontal scrollbar at bottom of orders table
5. ✅ Try scrolling left/right to see all columns

### Expected Results

- ✅ Horizontal scrollbar visible when window < 1600px
- ✅ All table columns accessible via scroll
- ✅ No columns cut off or hidden
- ✅ Smooth scroll on desktop (mouse wheel)
- ✅ Touch scroll works on mobile/tablet

### Verification Commands (Browser Console)

```javascript
// Check table min-width
const table = document.querySelector('.admin-table');
console.log('Table min-width:', getComputedStyle(table).minWidth);
// Should be: "1600px"

// Check container overflow
const container = document.querySelector('.table-container');
console.log('Container overflow-x:', getComputedStyle(container).overflowX);
// Should be: "auto"

// Check admin-main overflow
const main = document.querySelector('.admin-main');
console.log('Main overflow-x:', getComputedStyle(main).overflowX);
// Should be: "hidden"
```

### ❌ If Test Fails

- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Clear cache and try incognito mode
- Check browser console for errors

---

## 🧪 Test 2: Fetch Categories Endpoint

### Test Steps (Browser Console)

1. ✅ Open: https://botzzz773.pro/admin/services.html
2. ✅ Open DevTools Console (F12)
3. ✅ Run this command:

```javascript
fetch("/.netlify/functions/services?type=categories", {
  headers: { 
    "Authorization": `Bearer ${localStorage.getItem("token")}` 
  }
})
.then(r => r.json())
.then(data => {
  console.log('Categories response:', data);
  if (data.success) {
    console.log(`✅ Found ${data.categories.length} categories`);
    data.categories.forEach(cat => {
      console.log(`   - ${cat.name} (${cat.slug})`);
    });
  }
});
```

### Expected Results

```json
{
  "success": true,
  "categories": [
    {
      "id": "...",
      "name": "Instagram",
      "slug": "instagram",
      "icon": "fab fa-instagram",
      "display_order": 1,
      "status": "active"
    },
    // ... 4 more categories
  ]
}
```

### ❌ If Test Fails

Check response:
- **Empty array**: Migration not run or failed
- **Error 500**: Database table doesn't exist → Run migration
- **Error 401**: Not authenticated → Refresh page and try again

---

## 🧪 Test 3: Create Category Endpoint

### Test Steps (Browser Console)

```javascript
fetch("/.netlify/functions/services", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${localStorage.getItem("token")}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    action: "create-category",
    name: "Spotify",
    description: "Spotify music services",
    icon: "fab fa-spotify"
  })
})
.then(r => r.json())
.then(data => {
  console.log('Create category response:', data);
  if (data.success) {
    console.log('✅ Category created:', data.category);
  } else {
    console.error('❌ Error:', data.error);
  }
});
```

### Expected Results

```json
{
  "success": true,
  "message": "Category \"Spotify\" created successfully",
  "category": {
    "id": "...",
    "name": "Spotify",
    "slug": "spotify",
    "description": "Spotify music services",
    "icon": "fab fa-spotify"
  }
}
```

### Verify in Database

```sql
SELECT * FROM service_categories WHERE name = 'Spotify';
```

---

## 🧪 Test 4: Add Service Form Shows Categories

### Test Steps (UI)

1. ✅ Go to: https://botzzz773.pro/admin/services.html
2. ✅ Click **Add Service** button (top right)
3. ✅ Look at the **Category** dropdown
4. ✅ Check if it shows categories from database

### Expected Results

- ✅ Dropdown shows: Instagram, TikTok, YouTube, Twitter, Facebook
- ✅ If you created Spotify, it should also appear
- ✅ Below dropdown shows: "5 categories available • Create new category"
- ✅ Link "Create new category" is clickable

### Test with Console

```javascript
// Check if categories are cached
console.log('Cached categories:', window.categoriesCache);
// Should not be null after opening Add Service form

// Force refresh categories
window.invalidateCategoriesCache();
console.log('Cache invalidated');
```

### ❌ If Test Fails

- **Shows old hardcoded list**: Hard refresh page (Ctrl+Shift+R)
- **Empty dropdown**: Migration not run → Run SQL migration
- **Error in console**: Check network tab for failed requests

---

## 🧪 Test 5: Create Category from UI

### Test Steps (UI)

1. ✅ Go to: https://botzzz773.pro/admin/services.html
2. ✅ Click **Create Category** button (top right)
3. ✅ Fill form:
   - Name: "Discord"
   - Icon: "fab fa-discord"
   - Display Order: 6
   - Status: Active
4. ✅ Click **Create Category**
5. ✅ Wait for success notification
6. ✅ Page should auto-reload

### Expected Results

- ✅ Success notification: "Category 'Discord' created successfully!"
- ✅ Page reloads after ~800ms
- ✅ New category appears in database
- ✅ New category appears in Add Service dropdown

### Verify

1. Click **Add Service** again
2. Check Category dropdown
3. "Discord" should be in the list

---

## 🧪 Test 6: Create Service with New Category

### Test Steps (UI)

1. ✅ Click **Add Service** button
2. ✅ Fill form:
   - Service Name: "Discord Server Boost"
   - Category: Select "Discord" (the one you just created)
   - Provider: (any available)
   - Provider Service ID: "123"
   - Rate: 10
   - Min: 100
   - Max: 10000
3. ✅ Click **Create Service**

### Expected Results

- ✅ Success notification
- ✅ Modal closes
- ✅ Services table refreshes
- ✅ New service appears in table with "Discord" category
- ✅ Service is immediately visible (no page reload needed)

---

## 🧪 Test 7: Edit Service Shows Categories

### Test Steps (UI)

1. ✅ Find any service in the table
2. ✅ Click **Edit** (pencil icon)
3. ✅ Check the **Category** dropdown

### Expected Results

- ✅ Dropdown shows all categories from database
- ✅ Current service category is pre-selected
- ✅ Can change to any category
- ✅ Save works and updates category

---

## 🧪 Test 8: Cache Invalidation

### Test Steps (Console)

```javascript
// Check current cache
console.log('Categories cache:', window.categoriesCache);

// Invalidate
window.invalidateCategoriesCache();
console.log('After invalidation:', window.categoriesCache);
// Should be: null

// Next fetch will reload from database
```

---

## 📊 Quick Verification Script

Run this in browser console to verify everything:

```javascript
(async function verifyEverything() {
  console.log('🧪 Running verification tests...\n');
  
  // Test 1: Check CSS
  const table = document.querySelector('.admin-table');
  const container = document.querySelector('.table-container');
  const main = document.querySelector('.admin-main');
  
  console.log('1. CSS Checks:');
  console.log('   Table min-width:', getComputedStyle(table)?.minWidth || 'N/A');
  console.log('   Container overflow-x:', getComputedStyle(container)?.overflowX || 'N/A');
  console.log('   Main overflow-x:', getComputedStyle(main)?.overflowX || 'N/A');
  
  // Test 2: Fetch categories
  console.log('\n2. Fetching categories...');
  const token = localStorage.getItem('token');
  const res = await fetch('/.netlify/functions/services?type=categories', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  
  if (data.success) {
    console.log(`   ✅ Found ${data.categories.length} categories:`);
    data.categories.forEach(cat => {
      console.log(`      - ${cat.name} (${cat.slug})`);
    });
  } else {
    console.log('   ❌ Failed to fetch categories:', data.error);
  }
  
  // Test 3: Check cache
  console.log('\n3. Cache status:');
  console.log('   Categories cache:', window.categoriesCache ? `${window.categoriesCache.length} items` : 'null');
  console.log('   Providers cache:', window.providersCache ? `${window.providersCache.length} items` : 'null');
  
  console.log('\n✅ Verification complete!');
})();
```

---

## ✅ Success Criteria

All tests pass if:

- ✅ Horizontal scroll works on admin/orders page
- ✅ Categories fetch endpoint returns data
- ✅ Create category endpoint saves to database
- ✅ Add Service form shows dynamic categories
- ✅ Create category UI works end-to-end
- ✅ New services can use new categories
- ✅ Edit service shows correct categories
- ✅ Cache invalidation works

---

## 🚨 Known Issues / Troubleshooting

### Issue: "service_categories table does not exist"

**Solution**: Run the SQL migration (see PRE-FLIGHT section)

### Issue: Categories dropdown shows old hardcoded list

**Solution**: 
1. Hard refresh: Ctrl+Shift+R or Cmd+Shift+R
2. Clear browser cache
3. Try incognito mode

### Issue: "Cannot read property 'length' of null"

**Solution**: Categories cache is null - reload the page or call `window.invalidateCategoriesCache()`

### Issue: Horizontal scroll doesn't work

**Solution**:
1. Ensure browser width < 1600px
2. Hard refresh to clear CSS cache
3. Check DevTools for CSS override errors

---

## 📝 Testing Log

Record your test results:

| Test # | Test Name | Status | Notes |
|--------|-----------|--------|-------|
| 0 | Database Migration | ⬜ | Required before all other tests |
| 1 | Horizontal Scroll | ⬜ | |
| 2 | Fetch Categories API | ⬜ | |
| 3 | Create Category API | ⬜ | |
| 4 | Add Service Form | ⬜ | |
| 5 | Create Category UI | ⬜ | |
| 6 | Create Service with New Category | ⬜ | |
| 7 | Edit Service Categories | ⬜ | |
| 8 | Cache Invalidation | ⬜ | |

**Legend**: ✅ Pass | ❌ Fail | ⬜ Not Tested

---

**Deploy ID**: 691da4427de80700ad6d36b4  
**Production URL**: https://botzzz773.pro  
**Last Updated**: November 19, 2025
