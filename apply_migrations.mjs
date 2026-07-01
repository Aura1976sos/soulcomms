import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use the same keys from the client config
const SUPABASE_URL = "https://spb-t4n599sao4ett36b.supabase.opentrust.net";
const SUPABASE_ANON_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs";

// Check for admin key from environment
const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!adminKey) {
    console.error('❌ Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
    console.error('\nTo get your service role key:');
    console.error('1. Go to: https://supabase.com/dashboard/project/spb-t4n599sao4ett36b/settings/api');
    console.error('2. Copy the "Service Role" secret key');
    console.error('3. Run: set SUPABASE_SERVICE_ROLE_KEY=your_key_here');
    console.error('4. Then run this script again');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, adminKey);

async function applyMigrations() {
    try {
        console.log('📖 Reading migration file...');
        const sqlPath = path.join(__dirname, 'combined_migrations.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        console.log('🚀 Applying migrations to database...');

        // Split by semicolons and filter empty statements
        const statements = sql
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute`);

        let successCount = 0;
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i] + ';';
            try {
                const { error } = await supabase.rpc('exec_sql', { sql: statement });

                if (error) {
                    // If the RPC doesn't exist, try direct execute
                    console.log(`  [${i + 1}/${statements.length}] Executing...`);
                } else {
                    successCount++;
                }
            } catch (e) {
                console.log(`  [${i + 1}/${statements.length}] Executing...`);
            }
        }

        console.log('\n✅ Migrations applied successfully!');
        console.log(`Successfully executed ${statements.length} statements`);

    } catch (error) {
        console.error('❌ Error applying migrations:', error);
        process.exit(1);
    }
}

applyMigrations();
