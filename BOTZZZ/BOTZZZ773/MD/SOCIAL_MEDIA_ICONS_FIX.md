# Social Media Icons Not Displaying Issue

## Problem Description
The social media service icons in the "Popular Services" section on `index.html` are not displaying on the live production website at https://botzzz773.pro.

## Root Cause
The CSS references icon images at path `../img/icons/*.svg` but these image files may not be properly deployed or the paths are incorrect in production.

### Current Implementation
**File:** `index.html` (Lines ~110-150)
```html
<section class="popular-services">
    <div class="container">
        <h2 class="section-title">Popular Services</h2>
        <p class="section-subtitle">Most ordered services by our clients</p>
        
        <div class="services-grid services-grid--icons">
            <div class="service-card">
                <div class="service-icon service-icon--instagram"></div>
                <h3 class="service-title">Instagram</h3>
                ...
            </div>
            <!-- More service cards -->
        </div>
    </div>
</section>
```

**File:** `css/style.css` (Lines ~502-509)
```css
.service-icon--instagram { background-image: url('../img/icons/instagram.svg'); }
.service-icon--tiktok { background-image: url('../img/icons/tiktok.svg'); }
.service-icon--youtube { background-image: url('../img/icons/youtube.svg'); }
.service-icon--twitter { background-image: url('../img/icons/twitter.svg'); }
.service-icon--facebook { background-image: url('../img/icons/facebook.svg'); }
.service-icon--telegram { background-image: url('../img/icons/telegram.svg'); }
.service-icon--reddit { background-image: url('../img/icons/reddit.svg'); }
```

## Solution Options

### Option 1: Use Free Icon Libraries (Recommended)
Replace copyrighted SVG images with free icon libraries like Font Awesome or use CSS-based icons.

**Steps:**
1. Font Awesome is already loaded in the HTML (`<link>` tag exists for FA 6.0.0)
2. Replace the `<div class="service-icon service-icon--instagram"></div>` elements with Font Awesome icons:

```html
<!-- Instagram -->
<div class="service-icon">
    <i class="fab fa-instagram"></i>
</div>

<!-- TikTok -->
<div class="service-icon">
    <i class="fab fa-tiktok"></i>
</div>

<!-- YouTube -->
<div class="service-icon">
    <i class="fab fa-youtube"></i>
</div>

<!-- Twitter/X -->
<div class="service-icon">
    <i class="fab fa-twitter"></i>
</div>

<!-- Facebook -->
<div class="service-icon">
    <i class="fab fa-facebook"></i>
</div>

<!-- Telegram -->
<div class="service-icon">
    <i class="fab fa-telegram"></i>
</div>

<!-- Reddit -->
<div class="service-icon">
    <i class="fab fa-reddit"></i>
</div>
```

3. Update CSS to style the icons:
```css
.service-icon {
    width: 72px;
    height: 72px;
    margin: 0 auto var(--spacing-md);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 12px 30px rgba(17, 24, 39, 0.35);
}

.service-icon i {
    font-size: 36px;
    color: var(--primary-pink);
}

/* Remove background-image rules */
/* Delete lines 502-509 in style.css */
```

### Option 2: Create Custom Non-Copyrighted Icons
1. Create simple, original SVG icons using free tools like:
   - [Figma](https://figma.com) (free)
   - [SVG Creator](https://svgcreator.com)
   - [Inkscape](https://inkscape.org) (free, open-source)

2. Save them in the `img/icons/` directory
3. Ensure they're committed to git and deployed to Netlify

### Option 3: Use Public Domain Icons
1. Download free icons from:
   - [Heroicons](https://heroicons.com) - MIT License
   - [Feather Icons](https://feathericons.com) - MIT License
   - [Ionicons](https://ionic.io/ionicons) - MIT License
   - [Bootstrap Icons](https://icons.getbootstrap.com) - MIT License

2. Place icons in `img/icons/` directory
3. Update git repository and redeploy

## Recommended Immediate Fix
Use **Option 1** (Font Awesome) since the library is already loaded. This requires:
- Editing `index.html` to replace `<div class="service-icon service-icon--*"></div>` with Font Awesome `<i>` tags
- Updating `css/style.css` to remove background-image rules and add icon font sizing

## Files to Modify
1. `index.html` - Lines ~110-150 (Popular Services section)
2. `css/style.css` - Lines ~487-509 (Service icon styles)

## Testing After Fix
1. Deploy to Netlify: `netlify deploy --prod`
2. Visit https://botzzz773.pro
3. Scroll to "Popular Services" section
4. Verify all 7 social media icons are visible

## Copyright Considerations
- Do not use trademarked logos without permission
- Font Awesome icons are licensed under CC BY 4.0 (safe to use)
- Create original designs or use public domain/MIT licensed icons
- Attribute sources if required by license

## Priority
🔴 **High** - Affects homepage user experience and brand perception
