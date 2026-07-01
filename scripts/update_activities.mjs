import { createClient } from '@supabase/supabase-js';

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const eventId = '9d282cb7-6c10-438c-912b-ff70df8e6af1';
const activityData = [
    { name: 'Live IT 100 Mural', count: 46 },
    { name: 'Club 100', count: 121 },
    { name: 'Pitchaton', count: 177 },
    { name: 'Movie Sessions', count: 588 },
    { name: 'Sip & Paint Sessions', count: 212 },
    { name: 'Craft to Cash Workshop', count: 65 },
    { name: 'E-sport VR', count: 26 },
    { name: 'E-Sport FA26', count: 35 },
    { name: 'E-sport Racing', count: 99 },
    { name: 'E-Sport Dancing', count: 10 },
    { name: 'Board Games', count: 52 },
    { name: 'Table Games', count: 42 },
    { name: "Creator's Circle", count: 190 },
    { name: 'Beauty Station', count: 199 },
    { name: 'Confession Booth', count: 74 },
    { name: 'Podcast Station', count: 62 },
    { name: 'Market 100', count: 2 },
    { name: 'Fashion Runway', count: 3 }
];

try {
    // Sign in
    const { data: auth } = await client.auth.signInWithPassword({
        email: 'delightdesign.org@gmail.com',
        password: 'KGdelight@1'
    });

    // Get all activities for this event
    const { data: acts } = await client.from('activities')
        .select('id, name')
        .eq('event_id', eventId);

    console.log(`Found ${acts?.length} activities in database\n`);

    let updated = 0;
    for (const a of activityData) {
        const match = acts?.find(x => x.name?.toLowerCase().trim() === a.name.toLowerCase().trim());
        if (match) {
            const { error } = await client.from('activities')
                .update({ manual_count: a.count })
                .eq('id', match.id);
            if (!error) {
                console.log(`✓ ${a.name}: ${a.count}`);
                updated++;
            } else {
                console.log(`✗ Error updating ${a.name}: ${error.message}`);
            }
        } else {
            console.log(`⚠ Not found: ${a.name}`);
        }
    }

    console.log(`\nDone! Updated ${updated}/${activityData.length} activities`);
    const total = activityData.reduce((sum, x) => sum + x.count, 0);
    console.log(`Total experiences: ${total}`);
    process.exit(0);
} catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
}
