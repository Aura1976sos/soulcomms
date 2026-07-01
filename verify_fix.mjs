import { createClient } from '@supabase/supabase-js';

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const eventId = '9d282cb7-6c10-438c-912b-ff70df8e6af1';

// Sign in first
console.log('Authenticating...');
const { data: auth } = await client.auth.signInWithPassword({
    email: 'delightdesign.org@gmail.com',
    password: 'KGdelight@1'
});

console.log('Auth session set\n');

// Now update with authenticated client
const updates = [
    { name: 'Movie', count: 588 },
    { name: 'Craft to Cash', count: 65 },
    { name: 'Sip & Paint', count: 212 }
];

for (const u of updates) {
    const { error } = await client.from('activities')
        .update({ manual_count: u.count })
        .eq('name', u.name)
        .eq('event_id', eventId);

    if (!error) {
        console.log(`✓ Updated "${u.name}": ${u.count}`);
    } else {
        console.log(`✗ Error: ${error.message}`);
    }
}

// Verify with fresh query
const { data } = await client.from('activities')
    .select('name, manual_count')
    .eq('event_id', eventId)
    .in('name', ['Movie', 'Craft to Cash', 'Sip & Paint']);

console.log('\nVerification:');
data?.forEach(a => console.log(`${a.name}: ${a.manual_count}`));
