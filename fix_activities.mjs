import { createClient } from '@supabase/supabase-js';

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

// Update the partial-name activities with correct counts
const updateMap = {
    'Movie': 588,
    'Craft to Cash': 65,
    'Sip & Paint': 212
};

console.log('Updating partial-name activities with correct counts...\n');

for (const [name, count] of Object.entries(updateMap)) {
    const { error } = await client.from('activities')
        .update({ manual_count: count })
        .eq('name', name)
        .eq('event_id', '9d282cb7-6c10-438c-912b-ff70df8e6af1');

    if (!error) {
        console.log(`✓ Updated "${name}": ${count}`);
    } else {
        console.log(`✗ Error updating "${name}": ${error.message}`);
    }
}

// Verify final state
const { data } = await client.from('activities')
    .select('name, manual_count')
    .eq('event_id', '9d282cb7-6c10-438c-912b-ff70df8e6af1')
    .order('name');

console.log('\n✓ Final Activity List:');
console.log('=====================');
data?.forEach(a => console.log(`${a.name}: ${a.manual_count}`));
const total = data?.reduce((sum, a) => sum + (a.manual_count || 0), 0);
console.log('=====================');
console.log(`Total Activities: ${data?.length}`);
console.log(`Total Experiences: ${total}`);
