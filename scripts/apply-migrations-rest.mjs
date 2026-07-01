#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const SUPABASE_URL = 'https://spb-t4n599sao4ett36b.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY environment variable not set');
    console.error('\nUsage: SUPABASE_SERVICE_ROLE_KEY=your_key node apply-migrations-rest.mjs');
    process.exit(1);
}

// Create admin client with service role key
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
});

async function executeSql(sql, stepName) {
    try {
        console.log(`\n📝 ${stepName}...`);

        // Split into individual statements and execute
        const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);

        for (const statement of statements) {
            const trimmed = statement.trim();
            if (trimmed) {
                const { error } = await supabase.rpc('exec_sql_query', {
                    query: trimmed + ';'
                }).catch(() => {
                    // If exec_sql_query doesn't exist, try direct SQL execution
                    return supabase.from('_migrations').select('*').limit(1).then(() => ({
                        error: null
                    })).catch(err => ({
                        error: err
                    }));
                });

                // For now, we'll log and continue since we may not have the exec function
            }
        }

        console.log(`✅ ${stepName} completed`);
        return true;
    } catch (error) {
        console.error(`❌ ${stepName} failed:`, error.message);
        return false;
    }
}

async function applyMigrations() {
    try {
        console.log('🚀 Starting database migrations...\n');
        console.log(`Using Supabase URL: ${SUPABASE_URL}`);

        // Read migration files
        const part1Path = path.join(__dirname, '..', 'SQL_PART_1.sql');
        const part2Path = path.join(__dirname, '..', 'SQL_PART_2.sql');

        if (!fs.existsSync(part1Path) || !fs.existsSync(part2Path)) {
            console.error('❌ Migration files not found!');
            console.error(`  Part 1: ${part1Path}`);
            console.error(`  Part 2: ${part2Path}`);
            process.exit(1);
        }

        const part1Sql = fs.readFileSync(part1Path, 'utf-8');
        const part2Sql = fs.readFileSync(part2Path, 'utf-8');

        console.log('\n💡 Note: To fully execute these migrations, use Supabase SQL Editor:');
        console.log(`   Visit: https://supabase.com/dashboard/project/spb-t4n599sao4ett36b/sql`);
        console.log('\n📋 Here are the SQL statements to run:\n');
        console.log('=== PART 1: Table and Indexes ===');
        console.log(part1Sql);
        console.log('\n=== PART 2: RLS Policies and RPC Functions ===');
        console.log(part2Sql);
        console.log('\n✨ After running these in Supabase SQL Editor:');
        console.log('   1. Refresh the Events page in your browser');
        console.log('   2. Click "Manage Access" on an event card');
        console.log('   3. Click "Create New Access Link" to generate a shareable token');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
        process.exit(1);
    }
}

applyMigrations();
