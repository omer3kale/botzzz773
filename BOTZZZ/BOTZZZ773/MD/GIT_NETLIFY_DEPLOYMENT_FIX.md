# Git & Netlify Deployment Fix Guide

## Current Problem

1. **Git Branch Conflict**: Local `master` and remote `origin/master` have diverged
2. **File Deletion Issues**: MD/ and img/icons/ directories failing to delete during pull
3. **Two Remotes**: `origin` (botzzz773) and `botzzz` (BOTZZZ) causing confusion

## Current State

```bash
# Remotes
origin: https://github.com/omer3kale/botzzz773.git
botzzz: https://github.com/omer3kale/BOTZZZ.git

# Branches
* master (local)
  dogubaba773 (local)
  remotes/origin/master
  remotes/origin/dogubaba773
```

## Quick Fix Steps

### Option 1: Force Push (if you own all changes)

```bash
# 1. Commit all current changes
git add services.html js/services.js css/style.css
git commit -m "Fix: Add Font Awesome icons and async filter timing"

# 2. Force push to origin
git push origin master --force

# Netlify will auto-deploy from GitHub
```

### Option 2: Clean Merge (safer)

```bash
# 1. Stash current changes
git stash

# 2. Pull remote changes with merge
git pull origin master --no-rebase

# 3. Manually delete conflicting directories
Remove-Item -Recurse -Force "MD" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "img/icons" -ErrorAction SilentlyContinue

# 4. Apply stashed changes
git stash pop

# 5. Add and commit
git add .
git commit -m "Fix: Services filter icons and async loading"

# 6. Push to origin
git push origin master
```

### Option 3: Fresh Start from dogubaba773 Branch

```bash
# 1. Switch to dogubaba773 branch
git checkout dogubaba773

# 2. Merge master changes
git merge master

# 3. Push to origin
git push origin dogubaba773

# 4. Make dogubaba773 the default branch on GitHub
# Then configure Netlify to deploy from dogubaba773
```

## Netlify Deployment

### Current Setup
- **Netlify auto-deploys** from GitHub repository `omer3kale/botzzz773`
- **Production branch**: Check Netlify dashboard (likely `master` or `dogubaba773`)
- **Build command**: `npm install`
- **Publish directory**: `.` (root)
- **Functions directory**: `netlify/functions`

### Check Netlify Settings

1. Go to Netlify Dashboard: https://app.netlify.com
2. Select your site
3. Navigate to **Site Settings** → **Build & Deploy**
4. Check **Production branch** setting
5. Verify **Deploy contexts** are correct

### Manual Deploy to Netlify (Bypass Git)

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Link to your site (one-time)
netlify link

# Deploy to production
netlify deploy --prod
```

### Automated Git → Netlify Flow

Netlify watches your GitHub repository. When you push:

```bash
git push origin master
# ↓
# GitHub receives push
# ↓
# Netlify detects change
# ↓
# Netlify runs build (npm install)
# ↓
# Netlify deploys from publish directory
# ↓
# Live site updated
```

## Recommended Solution

**Use dogubaba773 branch for production:**

```bash
# 1. Checkout dogubaba773
git checkout dogubaba773

# 2. Hard reset to current master
git reset --hard master

# 3. Force push to origin
git push origin dogubaba773 --force

# 4. Update Netlify to deploy from dogubaba773 branch
# (Do this in Netlify dashboard)

# 5. Future deployments
git checkout dogubaba773
# make changes
git add .
git commit -m "Your message"
git push origin dogubaba773
```

## File Deletion Issues Fix

If files won't delete during pull:

```powershell
# 0. Pause OneDrive sync for this folder (right-click OneDrive icon → Pause syncing)
# 1. Close VS Code/Explorer windows that are inside the repo
# 2. Clear read-only attributes that OneDrive sometimes adds
attrib -R "c:\Users\ÖmerÜckale\OneDrive - NEA X GmbH\Desktop\vs code files\BOTZZZ\BOTZZZ773\*" /S

# 3. Force remove locked directories in PowerShell

Remove-Item -Recurse -Force "c:\Users\ÖmerÜckale\OneDrive - NEA X GmbH\Desktop\vs code files\BOTZZZ\BOTZZZ773\MD" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "c:\Users\ÖmerÜckale\OneDrive - NEA X GmbH\Desktop\vs code files\BOTZZZ\BOTZZZ773\img\icons" -ErrorAction SilentlyContinue

# 4. Resume git operation once the folders are gone
git pull origin master
```

If PowerShell still asks "Should I try again?", answer **n**, run the `Remove-Item` commands above, then repeat the pull.

If Windows still refuses to delete, reboot or run the same commands from an elevated PowerShell window (`Run as administrator`).

## Dual Branch Deployment on Netlify (dogubaba773 + master)

You can serve both branches from the same Netlify site:

1. **Primary production** → `dogubaba773`
  - Netlify Dashboard → *Site settings* → **Build & deploy** → **Production branch** = `dogubaba773`
  - Custom domain `www.botzzz773.pro` points here.

2. **Secondary production / collaboration** → `master`
  - Enable **Branch Deploys** (same settings page) and add `master`.
  - Netlify creates `master--<site>.netlify.app`. Add a custom domain like `master.botzzz773.pro` under **Domain management** → **Add domain alias**.

3. **Workflow**
  - Long-term production work → push to `dogubaba773`.
  - Collaborative or preview work → push to `master`; teammates can test at `master.botzzz773.pro`.

4. **Optional split testing**
  - If you want both urls on the same root, use **Split Testing** to route part of traffic from `www` to the branch deploy. (Not recommended for production unless intentionally A/B testing.)

Remember: each branch deploy runs with the same build command (`npm install`) and publish directory. Adjust environment variables per branch in **Deploy contexts** if needed.

## Verify Deployment

After pushing:

1. Check GitHub repository to confirm changes
2. Go to Netlify dashboard → Deploys tab
3. Wait for build to complete (~30-60 seconds)
4. Click "Preview deploy" or visit your live URL
5. Test the services page filter buttons

## Current Changes Ready to Deploy

- `services.html` - Added Font Awesome CDN + inline icon elements
- `js/services.js` - Fixed async filter initialization timing
- `css/style.css` - Already has correct icon styles

---

**TL;DR**: Use `git push origin master --force` if you're sure about local changes, or switch to `dogubaba773` branch and configure Netlify to deploy from there.
