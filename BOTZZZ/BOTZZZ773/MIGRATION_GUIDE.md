# Link Management System - Database Migration Guide

## Overview
This migration adds a Link Management System to prevent order conflicts when customers order multiple times for the same URL.

## Prerequisites
- Supabase Admin access
- Database connection established
- Backup of current database (recommended)

## Migration Files to Apply (In Order)

### 1. Main Link Management System
**File**: `20251121_link_management_system.sql`
**Purpose**: Creates core tables, functions, and triggers

### 2. Statistics Functions  
**File**: `20251121_link_management_stats.sql`
**Purpose**: Adds statistics and reporting functions

## Migration Steps

### Step 1: Connect to Supabase
```bash
# Using Supabase CLI
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# Or connect via SQL Editor in Supabase Dashboard
```

### Step 2: Apply Main Migration
```sql
-- Copy and paste the entire content of 20251121_link_management_system.sql
-- into your Supabase SQL Editor and execute
```

### Step 3: Apply Statistics Migration
```sql
-- Copy and paste the entire content of 20251121_link_management_stats.sql
-- into your Supabase SQL Editor and execute
```

### Step 4: Verify Migration Success
```sql
-- Check if tables were created
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'link_management';

-- Check if column was added
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'orders' AND column_name = 'link_id';

-- Check if functions were created
SELECT routine_name FROM information_schema.routines 
WHERE routine_name IN ('find_or_create_link', 'merge_link_orders', 'get_link_management_stats');

-- Test statistics function
SELECT get_link_management_stats();
```

## What This Migration Does

### Creates
1. **link_management table** - Tracks URLs and their associated orders
2. **orders.link_id column** - Links orders to URL tracking records
3. **Functions**:
   - `find_or_create_link()` - Manages URL tracking
   - `merge_link_orders()` - Combines duplicate orders
   - `detect_link_conflicts()` - Identifies conflicts
   - `get_link_management_stats()` - Provides statistics
4. **Triggers** - Automatically update statistics
5. **Indexes** - For performance optimization
6. **RLS Policies** - Security for admin access

### Migrates Existing Data
- Links existing orders to URL tracking records
- Maintains all current order data integrity
- No data loss or corruption

## Safety Features
- Uses `IF NOT EXISTS` clauses to prevent conflicts
- Maintains referential integrity
- Includes rollback-safe operations
- Preserves all existing functionality

## After Migration
Once migration is complete, you can:
1. Re-enable link management features in the code
2. Access the Link Management admin page
3. Use order conflict detection and resolution

## Rollback (If Needed)
```sql
-- Remove added column (will lose link tracking data)
ALTER TABLE orders DROP COLUMN IF EXISTS link_id;

-- Drop created tables
DROP TABLE IF EXISTS link_management CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS find_or_create_link(TEXT, UUID);
DROP FUNCTION IF EXISTS merge_link_orders(UUID);
DROP FUNCTION IF EXISTS detect_link_conflicts();
DROP FUNCTION IF EXISTS get_link_management_stats();
DROP FUNCTION IF EXISTS generate_url_hash(TEXT);
DROP FUNCTION IF EXISTS update_link_statistics();
```

## Support
If you encounter any issues during migration, the current system will continue to work normally as all new features are safely disabled until migration is complete.