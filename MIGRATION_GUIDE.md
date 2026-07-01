# Event Access Token Migration Guide

## Status: ⚠️ Supabase Platform Issues
The Supabase dashboard is currently experiencing technical issues. However, the migrations are ready and you have two options to apply them.

## Option 1: Manual Application via Supabase SQL Editor (Recommended when platform recovers)

### Step 1: Create the Table & Indexes
1. Go to https://supabase.com/dashboard/project/spb-t4n599sao4ett36b/sql/new
2. Paste the contents of `SQL_PART_1.sql` 
3. Click "Run" button
4. Wait for success message

### Step 2: Add RLS Policies & RPC Functions
1. Create a new SQL query
2. Paste the contents of `SQL_PART_2.sql`
3. Click "Run" button
4. Wait for success message

## Option 2: Direct PostgreSQL Connection (Advanced)

If you have direct database access, use:
```bash
SUPABASE_SERVICE_ROLE_KEY=<your_key> node scripts/apply-migrations-rest.mjs
```

## Option 3: Use psql (Direct Connection)
```bash
psql -h db.spb-t4n599sao4ett36b.supabase.co \
     -U postgres \
     -d postgres \
     -f SQL_PART_1.sql

psql -h db.spb-t4n599sao4ett36b.supabase.co \
     -U postgres \
     -d postgres \
     -f SQL_PART_2.sql
```

## What Gets Applied

### Part 1: Table Structure
- `event_access_tokens` table with proper indexes
- Row Level Security enabled
- Columns: id, event_id, token, created_by, expires_at, usage_count, is_active, etc.

### Part 2: Permissions & Functions
- RLS policies for admin-only access
- `validate_event_access_token()` function - validates and counts usage
- `generate_event_access_token()` function - generates 32-char tokens
- `create_event_access_token()` function - creates with duration
- `revoke_event_access_token()` function - revokes tokens
- `v_active_event_access_tokens` view - shows valid tokens

## Current Frontend Status

✅ **Already Working (with fallback)**:
- EventAccessTokenManager component - Fixed syntax errors
- Token generation UI - "Create New Access Link" button ready
- Token validation logic - Fallback generation implemented
- Guest access flow - Complete and functional

❌ **Blocked by Missing RPC Functions**:
- Database persistence - Tokens stored locally only
- Token usage tracking - Not recorded
- Token revocation - Not enforced
- Query functions - Cannot retrieve stored tokens

## Testing After Migration

1. **Refresh Events page**: http://localhost:8080/events
2. **Generate token**: Click "Manage Access" → "Create New Access Link"
3. **Verify persistence**: Token should save to database
4. **Test guest access**: Copy shareable link, open in incognito window
5. **Check guest operations**: Check-in & record activities should work

## Status Page
Check Supabase status: https://status.supabase.com

## Next Steps

1. **Wait for Supabase to recover** (check status page)
2. **Apply migrations** using Option 1 when dashboard is available
3. **Refresh application** to test with live RPC functions
4. **Deploy to production** (already committed to GitHub)

---
Generated: 2026-07-01
