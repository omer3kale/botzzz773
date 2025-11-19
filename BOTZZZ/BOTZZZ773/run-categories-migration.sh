#!/bin/bash

# Service Categories Migration Script
# This script creates the service_categories table and populates default categories

echo "🚀 Running service categories migration..."
echo ""

# Read the Supabase credentials
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check if Supabase URL and Key are set
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Error: Missing Supabase credentials"
    echo "Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set"
    exit 1
fi

# Run the migration using psql via Supabase connection string
# Note: You'll need to get the direct database URL from your Supabase project settings

echo "📋 Migration SQL:"
cat supabase/migrations/20251119_create_service_categories.sql
echo ""
echo ""

echo "⚠️  To run this migration:"
echo "1. Go to your Supabase Dashboard → SQL Editor"
echo "2. Copy the contents of: supabase/migrations/20251119_create_service_categories.sql"
echo "3. Paste and run the SQL"
echo ""
echo "Or use Supabase CLI:"
echo "   supabase db push"
echo ""
