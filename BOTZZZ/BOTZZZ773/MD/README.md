# BOTZZZ773 - SMM Reseller Panel

Premium SMM services website built with speed in mind! 🚀

## Features
- ⚡ Lightning-fast static site
- 🎨 Inter Miami FC colors (Black & Neon Pink)
- 📱 Fully responsive design
- 🔥 Modern UI/UX
- 💰 Price calculator
- 📧 Contact forms
- 🌐 Ready for Netlify deployment

## Quick Start

### Local Development
1. Open `index.html` in your browser
2. That's it! No build process needed.

### Deploy to Netlify

#### Option 1: Drag & Drop (FASTEST - 30 seconds!)
1. Go to https://app.netlify.com/drop
2. Drag the entire `BOTZZZ773` folder
3. Your site is LIVE! 🎉

#### Option 2: GitHub + Netlify (Recommended for updates)
1. Create a new repository on GitHub
2. Push this code to GitHub
3. Go to Netlify > "Add new site" > "Import an existing project"
4. Connect your GitHub repo
5. Deploy!

#### Option 3: Netlify CLI
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Deploy
netlify deploy --prod
```

## File Structure
```
BOTZZZ773/
├── index.html          # Home page
├── services.html       # Services catalog
├── order.html          # Order form
├── contact.html        # Contact page
├── css/
│   └── style.css       # All styles
├── js/
│   ├── main.js         # Main functionality
│   ├── services.js     # Services page logic
│   ├── order.js        # Order form logic
│   └── contact.js      # Contact form logic
├── netlify.toml        # Netlify configuration
└── README.md           # This file
```

## Color Palette
- Primary Pink: `#FF1494`
- Secondary Pink: `#FF69B4`
- Background: `#000000`
- Text: `#FFFFFF`

## Technologies
- Pure HTML5
- CSS3 (CSS Variables, Grid, Flexbox)
- Vanilla JavaScript (ES6+)
- Google Fonts (Inter)

## Customization

### Update Prices
Edit the `prices` object in `js/main.js`:
```javascript
const prices = {
    'instagram-followers': 1.81,
    'instagram-likes': 0.11,
    // ... add more
};
```

### Add More Services
Edit `services.html` and add new service rows following the existing pattern.

### Change Colors
Update CSS variables in `css/style.css`:
```css
:root {
    --primary-pink: #FF1494;
    --secondary-pink: #FF69B4;
    --bg-black: #000000;
}
```

## Next Steps (Optional)
- [ ] Connect to Supabase for order management
- [ ] Add payment gateway integration
- [ ] Set up email notifications
- [ ] Add user dashboard
- [ ] Integrate analytics

## Support
For questions or issues, check the code comments or contact support.

---
Built with ⚡ speed and 💖 for BOTZZZ773

**Time to Deploy: ~2 minutes** 🚀
