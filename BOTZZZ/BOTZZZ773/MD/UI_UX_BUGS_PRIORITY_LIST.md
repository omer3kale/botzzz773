# UI/UX Bug Fixes - Priority List

## Bug #1: Reddit Service Title Alignment Issue

### Problem
The "Reddit" service card title (`.service-title`) is not properly centered/aligned compared to other service cards in the Popular Services section on `index.html`.

### Location
**File:** `index.html` (Lines ~156-164)
```html
<div class="service-card">
    <div class="service-icon">
        <i class="fab fa-reddit"></i>
    </div>
    <h3 class="service-title">Reddit</h3>
    <p class="service-desc">Subscribers, Upvotes, Comments & More</p>
    <a href="services.html#reddit" class="btn btn-primary">View Services</a>
</div>
```

**CSS File:** `css/style.css` (Lines ~504-508)
```css
.service-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: var(--spacing-sm);
}
```

### Root Cause
The `.service-title` class lacks explicit text-alignment properties. The title may appear left-aligned or inconsistent due to browser defaults or parent container flex properties.

### Solution
Add `text-align: center;` to ensure consistent centering across all service cards:

```css
.service-title {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: var(--spacing-sm);
    text-align: center;
}
```

### Files to Modify
- `css/style.css` - Add `text-align: center;` to `.service-title` (Line ~504)

---

## Bug #2: Dashboard Sidebar Link Labels Not Properly Structured

### Problem
The customer dashboard sidebar (`dashboard.html`) uses inline SVG icons with `<span>` text labels, but these are not semantically wrapped or structured for proper accessibility and onClick event handling compliance with the design system.

### Location
**File:** `dashboard.html` (Lines ~26-122)

Current structure example:
```html
<a href="dashboard.html" class="sidebar-link active">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"/>
        <rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/>
    </svg>
    <span>New Order</span>
</a>
```

### Issues Identified
1. **Inconsistent onclick handling**: Some links use `href="#"` with `id` attributes for JavaScript binding (e.g., `id="ordersLink"`), while others use direct navigation
2. **Missing semantic structure**: Icon and label are siblings without a wrapper, making styling and event delegation harder
3. **Accessibility concerns**: No ARIA labels or roles for screen readers
4. **Design system compliance**: onClick attributes should be consistently applied via JavaScript, not mixed with href navigation

### Current Implementation Analysis

**Links with JavaScript handlers:**
- `#orders` (Line ~48) - Has `id="ordersLink"` for JS binding
- `#subscriptions` (Line ~59)
- `#dripfeed` (Line ~68)
- `#refill` (Line ~77)
- `#refunds` (Line ~96)

**Links with direct navigation:**
- `dashboard.html` (Line ~26) - Direct page load
- `services.html` (Line ~37) - Direct page load
- `addfunds.html` (Line ~86) - Direct page load
- `api-dashboard.html` (Line ~105) - Direct page load
- `tickets.html` (Line ~114) - Direct page load

### Recommended Solution

#### Option 1: Standardize All Links with JavaScript Handlers (Preferred)
Convert all sidebar links to use `data-*` attributes and centralized event handling:

```html
<a href="#" class="sidebar-link" data-page="new-order" role="button" aria-label="New Order">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"/>
        <rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/>
    </svg>
    <span class="sidebar-link-label">New Order</span>
</a>
```

**JavaScript handler in `js/dashboard.js`:**
```javascript
// Centralized sidebar navigation
document.querySelectorAll('.sidebar-link').forEach(link => {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        
        // Remove active class from all links
        document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        
        // Add active class to clicked link
        this.classList.add('active');
        
        // Get the target page
        const page = this.dataset.page;
        
        // Handle navigation based on page type
        switch(page) {
            case 'new-order':
                // Show new order section (already on dashboard)
                break;
            case 'services':
                window.location.href = 'services.html';
                break;
            case 'orders':
                loadOrdersSection();
                break;
            case 'subscriptions':
                loadSubscriptionsSection();
                break;
            case 'dripfeed':
                loadDripfeedSection();
                break;
            case 'refill':
                loadRefillSection();
                break;
            case 'addfunds':
                window.location.href = 'addfunds.html';
                break;
            case 'refunds':
                loadRefundsSection();
                break;
            case 'api':
                window.location.href = 'api-dashboard.html';
                break;
            case 'tickets':
                window.location.href = 'tickets.html';
                break;
            default:
                console.warn('Unknown page:', page);
        }
    });
});
```

#### Option 2: Wrap Labels in Semantic Structure
Keep current href approach but improve structure:

```html
<a href="dashboard.html" class="sidebar-link active">
    <span class="sidebar-link-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/>
            <rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/>
        </svg>
    </span>
    <span class="sidebar-link-label">New Order</span>
</a>
```

**Updated CSS:**
```css
.sidebar-link {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) var(--spacing-md);
    color: var(--text-gray);
    font-size: 0.9rem;
    font-weight: 500;
    transition: all var(--transition-fast);
    border-left: 3px solid transparent;
}

.sidebar-link-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

.sidebar-link-label {
    flex: 1;
}
```

### Files to Modify
1. `dashboard.html` - Restructure all sidebar links (Lines ~26-122)
2. `css/dashboard-styles.css` - Add `.sidebar-link-icon` and `.sidebar-link-label` styles
3. `js/dashboard.js` - Add centralized click handler for all sidebar links

### Benefits
- ✅ **Consistent behavior**: All links follow the same pattern
- ✅ **Better accessibility**: Proper ARIA labels and semantic structure
- ✅ **Easier maintenance**: Single event handler for all navigation
- ✅ **Design system compliance**: Uniform onClick handling
- ✅ **Improved styling**: Wrapped elements for better CSS targeting

### Priority
🟡 **Medium** - Affects UX consistency and code maintainability

---

## Testing Checklist

### Bug #1 Testing:
- [ ] Open `https://botzzz773.pro`
- [ ] Scroll to "Popular Services" section
- [ ] Verify "Reddit" title is centered like other service titles
- [ ] Check alignment on mobile/tablet breakpoints

### Bug #2 Testing:
- [ ] Open `https://botzzz773.pro/dashboard.html`
- [ ] Click each sidebar link
- [ ] Verify active state updates correctly
- [ ] Test keyboard navigation (Tab + Enter)
- [ ] Check screen reader compatibility
- [ ] Verify no console errors
- [ ] Test on mobile (sidebar should remain functional)

## Implementation Order
1. Fix Bug #1 (quick CSS change)
2. Deploy and test
3. Implement Bug #2 (requires HTML, CSS, and JS changes)
4. Test thoroughly before production deployment
