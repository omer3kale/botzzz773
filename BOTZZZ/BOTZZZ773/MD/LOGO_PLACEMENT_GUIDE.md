# BOTZZZ773 Logo Placement Guide

## Available Logo Files
| File | Size | Best Use |
|------|------|----------|
| `/img/icons/BOTZZZ773.logo.png` | Full logo | Hero, Footer, Large displays |
| `/img/icons/icon-72x72.png` | 72px | Favicon, small badges |
| `/img/icons/icon-96x96.png` | 96px | Navigation, headers |
| `/img/icons/icon-128x128.png` | 128px | Auth pages, cards |
| `/img/icons/icon-192x192.png` | 192px | Sidebar headers |
| `/img/icons/icon-512x512.png` | 512px | Splash screens |

---

## Recommended Placements (Subtle & Professional)

### 1. **Navbar Logo** (All Public Pages)
**Element:** `.logo` in `<nav class="navbar">`  
**Current:** Text-only `BOTZZZ773`  
**Suggested:** Add small icon before text

```css
/* Add to css/style.css */
.logo::before {
    content: '';
    display: inline-block;
    width: 28px;
    height: 28px;
    background: url('/img/icons/icon-72x72.png') center/contain no-repeat;
    margin-right: 8px;
    vertical-align: middle;
}
```

**Size:** 28×28px — subtle, doesn't dominate

---

### 2. **Dashboard Sidebar Logo** 
**Element:** `.sidebar-logo` in `dashboard.html`  
**File:** `dashboard.html`, `order.html`, `addfunds.html`

```css
/* Add to css/dashboard-styles.css */
.sidebar-logo::before {
    content: '';
    display: inline-block;
    width: 32px;
    height: 32px;
    background: url('/img/icons/icon-96x96.png') center/contain no-repeat;
    margin-right: 10px;
    vertical-align: middle;
}
```

**Size:** 32×32px — fits sidebar width

---

### 3. **Auth Pages (Signin/Signup)**
**Element:** `.auth-header` inside `.auth-card`  
**Files:** `signin.html`, `signup.html`

```css
/* Add to css/auth-styles.css */
.auth-header::before {
    content: '';
    display: block;
    width: 64px;
    height: 64px;
    background: url('/img/icons/icon-128x128.png') center/contain no-repeat;
    margin: 0 auto 16px;
    opacity: 0.9;
}
```

**Size:** 64×64px — centered above "Welcome Back" text

---

### 4. **Footer Brand Section**
**Element:** `.footer-title` in first `.footer-col`  
**Files:** All pages with footer

```css
/* Add to css/style.css */
.footer-title::before {
    content: '';
    display: inline-block;
    width: 24px;
    height: 24px;
    background: url('/img/icons/icon-72x72.png') center/contain no-repeat;
    margin-right: 8px;
    vertical-align: middle;
    opacity: 0.85;
}
```

**Size:** 24×24px — subtle footer accent

---

### 5. **Admin Panel Header**
**Element:** `.admin-logo` in `admin/` pages  
**Files:** `admin/*.html`

```css
/* Add to css/admin-styles.css */
.admin-logo::before {
    content: '';
    display: inline-block;
    width: 30px;
    height: 30px;
    background: url('/img/icons/icon-96x96.png') center/contain no-repeat;
    margin-right: 10px;
    vertical-align: middle;
}
```

**Size:** 30×30px — professional admin look

---

### 6. **Hero Section Watermark** (Optional)
**Element:** `.hero` section background  
**File:** `index.html`

```css
/* Add to css/style.css - SUBTLE watermark */
.hero::after {
    content: '';
    position: absolute;
    bottom: 20px;
    right: 20px;
    width: 80px;
    height: 80px;
    background: url('/img/icons/icon-192x192.png') center/contain no-repeat;
    opacity: 0.08;
    pointer-events: none;
    z-index: 1;
}
```

**Size:** 80×80px at 8% opacity — barely visible watermark

---

### 7. **Loading/Splash Screen** (PWA)
**Element:** Offline page or loading state  
**File:** `offline.html`

```css
.offline-logo {
    width: 120px;
    height: 120px;
    background: url('/img/icons/icon-512x512.png') center/contain no-repeat;
    margin: 0 auto 24px;
}
```

---

## Quick Implementation Checklist

| Location | CSS File | Size | Priority |
|----------|----------|------|----------|
| Navbar | `style.css` | 28px | ⭐ High |
| Sidebar | `dashboard-styles.css` | 32px | ⭐ High |
| Auth Header | `auth-styles.css` | 64px | ⭐ High |
| Footer | `style.css` | 24px | Medium |
| Admin Header | `admin-styles.css` | 30px | Medium |
| Hero Watermark | `style.css` | 80px | Low |
| Offline Page | inline | 120px | Low |

---

## Design Guidelines

1. **Keep it subtle** — Logo should complement, not dominate
2. **Consistent sizing** — Use multiples of 8 (24, 32, 64, etc.)
3. **Opacity** — Use 0.85-0.95 for icons, 0.05-0.1 for watermarks
4. **Spacing** — Always add `margin-right: 8-10px` when beside text
5. **Responsive** — Consider hiding on mobile if space is tight

```css
/* Mobile: hide logo icon, keep text */
@media (max-width: 480px) {
    .logo::before {
        display: none;
    }
}
```

---

## Files to Modify

1. `css/style.css` — Navbar, Footer, Hero
2. `css/dashboard-styles.css` — Sidebar
3. `css/auth-styles.css` — Signin/Signup
4. `css/admin-styles.css` — Admin panel

**Total CSS additions:** ~50 lines across 4 files
