import { createClient } from '@supabase/supabase-js';

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const eventId = '9d282cb7-6c10-438c-912b-ff70df8e6af1';

// Check all activities with detail
const { data } = await client.from('activities')
    .select('id, name, manual_count')
    .eq('event_id', eventId);

console.log('All Activities with IDs:');
console.log('========================');
data?.forEach(a => console.log(`[${a.id.substring(0, 8)}] ${a.name}: ${a.manual_count || 'NULL'}`));

// Find duplicates
const withNull = data?.filter(a => a.manual_count === null);
console.log(`\nActivities with NULL manual_count: ${withNull?.length}`);
withNull?.forEach(a => console.log(`  - ${a.name} (ID: ${a.id.substring(0, 8)})`));
