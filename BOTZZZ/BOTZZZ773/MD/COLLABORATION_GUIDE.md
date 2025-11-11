# 🤝 Collaboration Guide - BOTZZZ773

## Quick Start for Simultaneous Work

### Current Setup
- **Production Branch**: `master` (deployed to https://botzzz773.pro)
- **Development Branch**: `dogubaba773` (for your partner)
- **Repository**: https://github.com/omer3kale/botzzz773

---

## 👤 For You (Ömer)

### Working on Master Branch

```bash
# Make sure you're on master
git checkout master

# Always pull latest changes before starting work
git pull origin master

# Make your changes...

# Stage and commit
git add .
git commit -m "Brief description of changes"

# Push to master
git push origin master
```

**⚠️ Important**: Every push to `master` triggers automatic deployment to production at https://botzzz773.pro

---

## 👥 For Your Partner (Dogubaba)

### Initial Setup (First Time Only)

```bash
# Clone the repository
git clone https://github.com/omer3kale/botzzz773.git
cd botzzz773/BOTZZZ/BOTZZZ773

# Switch to development branch
git checkout dogubaba773
```

### Daily Workflow

```bash
# Make sure you're on your branch
git checkout dogubaba773

# Pull latest changes from master (stay in sync)
git pull origin master

# Make your changes...

# Stage and commit
git add .
git commit -m "Brief description of changes"

# Push to your branch
git push origin dogubaba773
```

### Merging Changes to Production

When ready to deploy your changes:

1. **Create Pull Request on GitHub**:
   - Go to: https://github.com/omer3kale/botzzz773/pull/new/dogubaba773
   - Review changes
   - Request review from Ömer

2. **Ömer reviews and merges**:
   - Review the PR on GitHub
   - Click "Merge pull request"
   - Automatic deployment to production

---

## 🔄 Staying in Sync

### If You're Working on Master
```bash
# Before starting new work
git checkout master
git pull origin master

# Periodically merge your changes into dogubaba773 branch
git checkout dogubaba773
git merge master
git push origin dogubaba773
```

### If Partner is Working on Dogubaba773
```bash
# Before starting new work
git checkout dogubaba773
git pull origin master  # Get latest from production
git pull origin dogubaba773  # Get partner's latest work

# Continue working...
```

---

## 📋 Current Environment Status

### ✅ Completed
- Custom domain: https://botzzz773.pro
- Netlify deployment configured
- Base directory: BOTZZZ/BOTZZZ773
- Both branches created and pushed

### ⚠️ **CRITICAL - Action Required**
**Environment variables need to be added to Netlify** to fix 502 error:

1. Go to: https://app.netlify.com/sites/87193a31-d011-4e63-8e32-e2af27ab3467/settings/env
2. Add these 4 variables (already displayed in your terminal):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT_SECRET`
3. Set scope to "All scopes"
4. Click "Save"
5. Trigger: "Deploys" → "Trigger deploy" → "Clear cache and deploy site"

---

## 🚨 Common Scenarios

### Scenario 1: Both Made Changes to Same File
If merge conflict occurs:
```bash
# Git will mark conflicts in files like:
# <<<<<<< HEAD
# Your changes
# =======
# Their changes
# >>>>>>> branch-name

# Edit the file to resolve conflicts
# Then:
git add .
git commit -m "Resolved merge conflict"
git push
```

### Scenario 2: Need to Test Changes Before Deploying
- Work on `dogubaba773` branch
- Test locally by opening HTML files in browser
- Only merge to `master` when ready for production

### Scenario 3: Emergency Hotfix Needed
```bash
# On master branch
git checkout master
git pull origin master

# Make urgent fix
# Commit and push - deploys immediately
git add .
git commit -m "HOTFIX: Description"
git push origin master

# Sync fix to development branch
git checkout dogubaba773
git merge master
git push origin dogubaba773
```

---

## 📝 Best Practices

1. **Commit Often**: Small, frequent commits are better than large ones
2. **Descriptive Messages**: Use clear commit messages (e.g., "Fix order price calculation" not "fix bug")
3. **Pull Before Push**: Always `git pull` before starting work to avoid conflicts
4. **Test Locally**: Test changes in browser before pushing
5. **Communicate**: Let each other know when working on same files

---

## 🛠️ Useful Commands

```bash
# See what changed
git status

# See commit history
git log --oneline -10

# See who's working on what
git branch -a

# Undo last commit (keeps changes)
git reset --soft HEAD~1

# Discard all local changes (CAREFUL!)
git reset --hard origin/master
```

---

## 📞 Support

- **GitHub Repository**: https://github.com/omer3kale/botzzz773
- **Live Site**: https://botzzz773.pro (after env vars fixed)
- **Netlify Dashboard**: https://app.netlify.com/sites/87193a31-d011-4e63-8e32-e2af27ab3467

---

## 🎯 Next Steps

1. **Add environment variables to Netlify** (see "Action Required" above)
2. **Share this guide** with your partner
3. **Your partner clones** repository and switches to `dogubaba773` branch
4. **Start working!** You on `master`, partner on `dogubaba773`
5. **Merge via Pull Requests** when partner's changes are ready for production

---

**Last Updated**: November 8, 2025  
**Created By**: GitHub Copilot Assistant
