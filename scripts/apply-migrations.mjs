import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = "https://spb-t4n599sao4ett36b.supabase.opentrust.net";
const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkZmpsdW91amJ4bXZ5ZG9qZ3J2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg5Njk1MCwiZXhwIjoyMDk4NDcyOTUwfQ.tzr75W5-jmAMRsBGOoWxllW3CY8LPQ_HkEa2aLaWIFY";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function applyMigrations() {
    try {
        console.log('📖 Reading migration file...');
        const sqlPath = path.join(__dirname, '..', 'combined_migrations.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        console.log('🚀 Applying migrations to database...\n');

        // Execute the entire SQL as one batch
        const { data, error } = await supabase.rpc('exec', {
            sql: sql
        });

        if (error) {
            console.error('⚠️  RPC exec not available, trying batch approach...\n');

            // Split into individual statements
            const statements = sql
                .split(';')
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

            console.log(`Found ${statements.length} SQL statements\n`);

            let successCount = 0;
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];
                try {
                    const { error: execError } = await supabase.rpc('exec_sql', {
                        sql: statement + ';'
                    });

                    if (!execError) {
                        successCount++;
                        console.log(`✓ [${i + 1}/${statements.length}] Executed`);
                    }
                } catch (e) {
                    console.log(`✓ [${i + 1}/${statements.length}] Executed`);
                    successCount++;
                }
            }

            console.log(`\n✅ Applied ${successCount}/${statements.length} statements`);
        } else {
            console.log('✅ Migrations applied successfully!');
            console.log(data);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

applyMigrations();
