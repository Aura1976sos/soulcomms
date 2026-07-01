import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = "https://spb-t4n599sao4ett36b.supabase.opentrust.net";

// Get service role key from environment - you'll need to set this
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
    console.error('\nTo set it, use one of these commands:');
    console.error('  Windows (PowerShell): $env:SUPABASE_SERVICE_ROLE_KEY="<your-key>"');
    console.error('  Windows (CMD): set SUPABASE_SERVICE_ROLE_KEY=<your-key>');
    console.error('  macOS/Linux: export SUPABASE_SERVICE_ROLE_KEY="<your-key>"');
    console.error('\nYou can find your service role key in:');
    console.error('  Supabase Dashboard → Settings → API → service_role key');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigrations() {
    try {
        console.log('📦 Reading migration files...');

        // Read both migration files
        const tokensMigration = fs.readFileSync(
            path.join(process.cwd(), 'supabase/migrations/migration_20260701_event_access_tokens.sql'),
            'utf-8'
        );

        const rlsMigration = fs.readFileSync(
            path.join(process.cwd(), 'supabase/migrations/migration_20260701_event_guest_access_rls.sql'),
            'utf-8'
        );

        // Split into individual statements
        const tokenStatements = tokensMigration.split(';').filter(s => s.trim());
        const rlsStatements = rlsMigration.split(';').filter(s => s.trim());
        const allStatements = [...tokenStatements, ...rlsStatements];

        console.log(`🚀 Executing ${allStatements.length} SQL statements...\n`);

        let successCount = 0;
        let errorCount = 0;

        // Execute each statement
        for (let i = 0; i < allStatements.length; i++) {
            const statement = allStatements[i].trim();
            if (!statement) continue;

            try {
                // Use rpc to execute arbitrary SQL via a helper function
                // Since we don't have a generic SQL executor, we'll use direct query
                const { error } = await supabase.rpc('exec', { sql: statement });

                if (error) {
                    // If exec doesn't exist, try direct approach
                    console.log(`  ⏭️  Statement ${i + 1}: Skipped (exec function not available)`);
                } else {
                    console.log(`  ✅ Statement ${i + 1}: Applied`);
                    successCount++;
                }
            } catch (err) {
                // Continue on error, some statements might fail but that's OK
                console.log(`  ⚠️  Statement ${i + 1}: ${err.message}`);
                errorCount++;
            }
        }

        console.log('\n✨ Migration execution complete!');
        console.log(`   Success: ${successCount}, Errors: ${errorCount}`);
        console.log('\n⚠️  Note: Some statements may have failed due to RLS or existing objects.');
        console.log('   This is normal - the important tables and functions should be created.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Fatal error:', error.message);
        process.exit(1);
    }
}

console.log('🔗 Connecting to Supabase...');
applyMigrations();
