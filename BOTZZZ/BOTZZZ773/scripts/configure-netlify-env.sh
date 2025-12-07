#!/bin/bash
# Netlify Environment Configuration Script
# Configures all required environment variables for BOTZZZ773

set -e

echo "🚀 BOTZZZ773 Netlify Environment Configuration"
echo "================================================"
echo ""

# Check if netlify CLI is installed
if ! command -v netlify &> /dev/null; then
    echo "❌ Netlify CLI is not installed."
    echo "Install it with: npm install -g netlify-cli"
    exit 1
fi

# Check if logged in
if ! netlify status &> /dev/null; then
    echo "🔐 Please log in to Netlify first..."
    netlify login
fi

# Link to site if not already linked
if ! netlify status &> /dev/null; then
    echo "🔗 Linking to Netlify site..."
    netlify link
fi

echo ""
echo "📋 Current environment variables will be configured:"
echo ""
echo "Core Configuration:"
echo "  ✓ JWT_SECRET"
echo "  ✓ SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
echo "  ✓ SITE_URL, FRONTEND_URL"
echo "  ✓ ADMIN_EMAIL, G_ADMIN_EMAIL"
echo ""
echo "Payment Gateways:"
echo "  ✓ HELEKET_MERCHANT_ID, HELEKET_API_KEY"
echo "  ✓ CRYPTOMUS_MERCHANT_ID, CRYPTOMUS_API_KEY"
echo "  ✓ PAYEER_MERCHANT_ID, PAYEER_SECRET_KEY, PAYEER_ACCOUNT"
echo ""
echo "SMTP Configuration:"
echo "  ✓ SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS"
echo ""
echo "Optional:"
echo "  ✓ APP_NAME"
echo "  ✓ MIN_DEPOSIT_AMOUNT"
echo "  ✓ HELEKET_API_BASE"
echo ""

read -p "Continue with configuration? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Configuration cancelled."
    exit 0
fi

echo ""
echo "🔧 Setting environment variables..."
echo ""

# Helper function to set env var
set_env() {
    local key=$1
    local value=$2
    local scope=${3:-"all"}
    
    if [ -z "$value" ]; then
        echo "⚠️  Skipping $key (no value provided)"
        return
    fi
    
    echo "Setting $key..."
    if [ "$scope" = "all" ]; then
        netlify env:set "$key" "$value" --silent 2>/dev/null || echo "  ⚠️  Failed to set $key"
    else
        netlify env:set "$key" "$value" --context="$scope" --silent 2>/dev/null || echo "  ⚠️  Failed to set $key for $scope"
    fi
}

# Read from existing Netlify env or prompt
echo "Reading existing environment variables..."
echo ""

# Core variables
read -p "JWT_SECRET (press Enter to keep existing): " JWT_SECRET
read -p "SUPABASE_URL (press Enter to keep existing): " SUPABASE_URL
read -p "SUPABASE_ANON_KEY (press Enter to keep existing): " SUPABASE_ANON_KEY
read -p "SUPABASE_SERVICE_ROLE_KEY (press Enter to keep existing): " SUPABASE_SERVICE_ROLE_KEY
read -p "SITE_URL [https://www.botzzz773.pro]: " SITE_URL
SITE_URL=${SITE_URL:-"https://www.botzzz773.pro"}
read -p "FRONTEND_URL [same as SITE_URL]: " FRONTEND_URL
FRONTEND_URL=${FRONTEND_URL:-"$SITE_URL"}
read -p "ADMIN_EMAIL: " ADMIN_EMAIL
read -p "G_ADMIN_EMAIL [same as ADMIN_EMAIL]: " G_ADMIN_EMAIL
G_ADMIN_EMAIL=${G_ADMIN_EMAIL:-"$ADMIN_EMAIL"}

echo ""
echo "Payment Gateway Configuration:"
echo ""

# Heleket
read -p "HELEKET_MERCHANT_ID: " HELEKET_MERCHANT_ID
read -p "HELEKET_API_KEY: " HELEKET_API_KEY
read -p "HELEKET_API_BASE [https://api.heleket.com]: " HELEKET_API_BASE
HELEKET_API_BASE=${HELEKET_API_BASE:-"https://api.heleket.com"}

# Cryptomus
read -p "CRYPTOMUS_MERCHANT_ID: " CRYPTOMUS_MERCHANT_ID
read -p "CRYPTOMUS_API_KEY: " CRYPTOMUS_API_KEY

# Payeer
read -p "PAYEER_MERCHANT_ID: " PAYEER_MERCHANT_ID
read -p "PAYEER_SECRET_KEY: " PAYEER_SECRET_KEY
read -p "PAYEER_ACCOUNT: " PAYEER_ACCOUNT

echo ""
echo "SMTP Configuration:"
echo ""
read -p "SMTP_HOST [smtp.gmail.com]: " SMTP_HOST
SMTP_HOST=${SMTP_HOST:-"smtp.gmail.com"}
read -p "SMTP_PORT [587]: " SMTP_PORT
SMTP_PORT=${SMTP_PORT:-"587"}
read -p "SMTP_USER: " SMTP_USER
read -p "SMTP_PASS: " SMTP_PASS

echo ""
echo "Optional Configuration:"
echo ""
read -p "APP_NAME [BOTZZZ773]: " APP_NAME
APP_NAME=${APP_NAME:-"BOTZZZ773"}
read -p "MIN_DEPOSIT_AMOUNT [1]: " MIN_DEPOSIT_AMOUNT
MIN_DEPOSIT_AMOUNT=${MIN_DEPOSIT_AMOUNT:-"1"}

echo ""
echo "📝 Applying configuration to all deploy contexts..."
echo ""

# Set core variables
set_env "JWT_SECRET" "$JWT_SECRET"
set_env "SUPABASE_URL" "$SUPABASE_URL"
set_env "SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY"
set_env "SUPABASE_SERVICE_ROLE_KEY" "$SUPABASE_SERVICE_ROLE_KEY"
set_env "SITE_URL" "$SITE_URL"
set_env "FRONTEND_URL" "$FRONTEND_URL"
set_env "ADMIN_EMAIL" "$ADMIN_EMAIL"
set_env "G_ADMIN_EMAIL" "$G_ADMIN_EMAIL"

# Payment gateways
set_env "HELEKET_MERCHANT_ID" "$HELEKET_MERCHANT_ID"
set_env "HELEKET_API_KEY" "$HELEKET_API_KEY"
set_env "HELEKET_API_BASE" "$HELEKET_API_BASE"
set_env "CRYPTOMUS_MERCHANT_ID" "$CRYPTOMUS_MERCHANT_ID"
set_env "CRYPTOMUS_API_KEY" "$CRYPTOMUS_API_KEY"
set_env "PAYEER_MERCHANT_ID" "$PAYEER_MERCHANT_ID"
set_env "PAYEER_SECRET_KEY" "$PAYEER_SECRET_KEY"
set_env "PAYEER_ACCOUNT" "$PAYEER_ACCOUNT"

# SMTP
set_env "SMTP_HOST" "$SMTP_HOST"
set_env "SMTP_PORT" "$SMTP_PORT"
set_env "SMTP_USER" "$SMTP_USER"
set_env "SMTP_PASS" "$SMTP_PASS"

# Optional
set_env "APP_NAME" "$APP_NAME"
set_env "MIN_DEPOSIT_AMOUNT" "$MIN_DEPOSIT_AMOUNT"

echo ""
echo "✅ Configuration complete!"
echo ""
echo "📊 Verifying environment variables..."
netlify env:list

echo ""
echo "🎉 All done! Your Netlify environment is configured."
echo ""
echo "Next steps:"
echo "  1. Verify the variables above are correct"
echo "  2. Trigger a new deployment: git push origin master"
echo "  3. Test payment gateways in production"
echo ""
