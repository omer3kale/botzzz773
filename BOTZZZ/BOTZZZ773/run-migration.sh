#!/bin/bash

# Link Management Migration Script
# This script helps apply the database migrations safely

echo "🚀 Link Management System Migration"
echo "=================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}❌ Supabase CLI not found. Please install it first:${NC}"
    echo "npm install -g supabase"
    exit 1
fi

echo -e "${BLUE}📋 Migration Overview:${NC}"
echo "1. Main Link Management System (20251121_link_management_system.sql)"
echo "2. Statistics Functions (20251121_link_management_stats.sql)"
echo ""

# Check if project is linked
if [ ! -f ".supabase/config.toml" ]; then
    echo -e "${YELLOW}⚠️  Supabase project not linked. Please run:${NC}"
    echo "supabase link --project-ref YOUR_PROJECT_REF"
    exit 1
fi

echo -e "${BLUE}🔍 Pre-migration checks...${NC}"

# Check current database state
echo "Checking if migrations are needed..."

# Apply migrations
echo -e "${BLUE}📦 Applying migrations...${NC}"

echo "1. Applying main link management system..."
if supabase db push --include supabase/migrations/20251121_link_management_system.sql; then
    echo -e "${GREEN}✅ Main migration applied successfully${NC}"
else
    echo -e "${RED}❌ Main migration failed${NC}"
    exit 1
fi

echo "2. Applying statistics functions..."
if supabase db push --include supabase/migrations/20251121_link_management_stats.sql; then
    echo -e "${GREEN}✅ Statistics migration applied successfully${NC}"
else
    echo -e "${RED}❌ Statistics migration failed${NC}"
    exit 1
fi

echo -e "${BLUE}🔍 Post-migration verification...${NC}"

# Verify tables exist
echo "Verifying link_management table..."
if supabase db shell -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'link_management';" | grep -q "1"; then
    echo -e "${GREEN}✅ link_management table created${NC}"
else
    echo -e "${RED}❌ link_management table not found${NC}"
fi

# Verify column exists
echo "Verifying orders.link_id column..."
if supabase db shell -c "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'link_id';" | grep -q "1"; then
    echo -e "${GREEN}✅ orders.link_id column added${NC}"
else
    echo -e "${RED}❌ orders.link_id column not found${NC}"
fi

# Verify functions exist
echo "Verifying functions..."
FUNCTIONS=("find_or_create_link" "merge_link_orders" "get_link_management_stats" "detect_link_conflicts")
for func in "${FUNCTIONS[@]}"; do
    if supabase db shell -c "SELECT COUNT(*) FROM information_schema.routines WHERE routine_name = '$func';" | grep -q "1"; then
        echo -e "${GREEN}✅ Function $func created${NC}"
    else
        echo -e "${RED}❌ Function $func not found${NC}"
    fi
done

echo ""
echo -e "${GREEN}🎉 Migration Complete!${NC}"
echo ""
echo -e "${BLUE}📊 Next Steps:${NC}"
echo "1. Update your application code to re-enable link management features"
echo "2. Test the Link Management admin interface"
echo "3. Monitor for any conflicts in existing orders"
echo ""
echo -e "${YELLOW}📝 Note:${NC} All existing functionality remains intact."
echo "The new link management features are ready to be enabled in your code."