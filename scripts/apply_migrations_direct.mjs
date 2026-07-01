import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

// Supabase connection details
const connectionString = 'postgresql://postgres:[PASSWORD]@db.spb-t4n599sao4ett36b.supabase.co:5432/postgres';

// For security, read from environment variable
const dbUrl = process.env.DATABASE_URL || connectionString;

if (dbUrl.includes('[PASSWORD]')) {
    console.error('❌ Error: DATABASE_URL not set');
    console.error('Set the DATABASE_URL environment variable to your Supabase connection string');
    console.error('Format: postgresql://postgres:[PASSWORD]@db.spb-t4n599sao4ett36b.supabase.co:5432/postgres');
    process.exit(1);
}

const client = new Client({ connectionString: dbUrl });

async function applyMigrations() {
    try {
        console.log('🔗 Connecting to database...');
        await client.connect();
        console.log('✅ Connected!');

        // Read combined migration file
        const sql = fs.readFileSync(
            path.join(process.cwd(), 'combined_migrations.sql'),
            'utf-8'
        );

        console.log('🚀 Applying migrations...');

        // Execute the SQL
        await client.query(sql);

        console.log('✅ Migrations applied successfully!');
        console.log('\n📊 Created:');
        console.log('  ✓ event_access_tokens table');
        console.log('  ✓ RLS policies for guest access');
        console.log('  ✓ Token generation functions');
        console.log('  ✓ Token validation functions');
        console.log('  ✓ Token revocation functions');

        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

applyMigrations();
