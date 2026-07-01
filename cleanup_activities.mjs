import { createClient } from '@supabase/supabase-js';

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const eventId = '9d282cb7-6c10-438c-912b-ff70df8e6af1';

// Delete duplicate entries with NULL counts
const toDelete = ['Craft to Cash', 'Movie', 'Sip & Paint'];

for (const name of toDelete) {
    const { error } = await client.from('activities')
        .delete()
        .eq('event_id', eventId)
        .eq('name', name);

    if (!error) {
        console.log(`✓ Deleted duplicate: "${name}"`);
    } else {
        console.log(`✗ Error deleting "${name}": ${error.message}`);
    }
}

// Verify cleanup
const { data } = await client.from('activities')
    .select('name, manual_count')
    .eq('event_id', eventId)
    .order('name');

console.log('\nCleaned Activity Counts:');
console.log('========================');
data?.forEach(a => console.log(`${a.name}: ${a.manual_count || 'NULL'}`));
const total = data?.reduce((sum, a) => sum + (a.manual_count || 0), 0);
console.log('========================');
console.log(`Total Activities: ${data?.length}`);
console.log(`Total Experiences: ${total}`);
