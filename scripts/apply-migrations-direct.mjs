import pgPromise from 'pg-promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Direct PostgreSQL connection
const pgp = pgPromise();

// Use your Supabase credentials
const db = pgp({
    host: 'db.spb-t4n599sao4ett36b.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.SUPABASE_DB_PASSWORD || 'entercloud123!',
    ssl: true,
    rejectUnauthorized: false
});

async function applyMigrations() {
    try {
        console.log('📖 Reading migration file...');
        const sqlPath = path.join(__dirname, '..', 'combined_migrations.sql');
        const sql = fs.readFileSync(sqlPath, 'utf-8');

        console.log('🚀 Applying migrations to database...\n');

        // Execute the SQL
        const result = await db.query(sql);

        console.log('✅ Migrations applied successfully!');
        console.log(result);

        await pgp.end();

    } catch (error) {
        console.error('❌ Error:', error.message);
        await pgp.end();
        process.exit(1);
    }
}

applyMigrations();
