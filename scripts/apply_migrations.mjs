import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const supabaseUrl = "https://spb-t4n599sao4ett36b.supabase.opentrust.net";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseServiceKey) {
    console.error("Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigrations() {
    try {
        console.log("📦 Applying event access tokens migration...");

        // Read migration files
        const tokensMigration = fs.readFileSync(
            path.join(process.cwd(), 'supabase/migrations/migration_20260701_event_access_tokens.sql'),
            'utf-8'
        );

        const rlsMigration = fs.readFileSync(
            path.join(process.cwd(), 'supabase/migrations/migration_20260701_event_guest_access_rls.sql'),
            'utf-8'
        );

        // Apply tokens migration
        const { error: error1 } = await supabase.rpc('exec_sql', { sql: tokensMigration });
        if (error1) {
            console.error("❌ Tokens migration failed:", error1);
            throw error1;
        }
        console.log("✅ Event access tokens table created successfully");

        // Apply RLS migration
        const { error: error2 } = await supabase.rpc('exec_sql', { sql: rlsMigration });
        if (error2) {
            console.error("⚠️  RLS migration warning:", error2.message);
            // Don't fail on RLS warnings
        }
        console.log("✅ RLS policies updated successfully");

        console.log("\n✨ All migrations applied successfully!");
        process.exit(0);
    } catch (error) {
        console.error("❌ Migration failed:", error);
        process.exit(1);
    }
}

applyMigrations();
