const { createClient } = require('@supabase/supabase-js');

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

(async () => {
    // Sign in first
    const { data: auth } = await client.auth.signInWithPassword({
        email: 'delightdesign.org@gmail.com',
        password: 'KGdelight@1'
    });

    const eventId = '9d282cb7-6c10-438c-912b-ff70df8e6af1';
    const activityData = [
        { name: 'Live IT 100 Mural', group: 'General', count: 46 },
        { name: 'Club 100', group: 'General', count: 121 },
        { name: 'Pitchaton', group: 'Business', count: 177 },
        { name: 'Movie Sessions', group: 'Movie Sessions', count: 588 },
        { name: 'Sip & Paint Sessions', group: 'Sip & Paint Sessions', count: 212 },
        { name: 'Craft to Cash Workshop', group: 'Craft to Cash Workshop', count: 65 },
        { name: 'E-sport VR', group: 'Sports & Gaming', count: 26 },
        { name: 'E-Sport FA26', group: 'Sports & Gaming', count: 35 },
        { name: 'E-sport Racing', group: 'Sports & Gaming', count: 99 },
        { name: 'E-Sport Dancing', group: 'Sports & Gaming', count: 10 },
        { name: 'Board Games', group: 'Sports & Gaming', count: 52 },
        { name: 'Table Games', group: 'Sports & Gaming', count: 42 },
        { name: 'Creator\'s Circle', group: 'Creative & Leisure', count: 190 },
        { name: 'Beauty Station', group: 'Creative & Leisure', count: 199 },
        { name: 'Confession Booth', group: 'Creative & Leisure', count: 74 },
        { name: 'Podcast Station', group: 'Creative & Leisure', count: 62 },
        { name: 'Market 100', group: 'Creative & Leisure', count: 2 },
        { name: 'Fashion Runway', group: 'Creative & Leisure', count: 3 }
    ];

    // Get all activities for this event
    const { data: activities } = await client.from('activities')
        .select('id, name, code')
        .eq('event_id', eventId);

    console.log(`Found ${activities?.length} activities in database`);

    let updated = 0;
    for (const act of activityData) {
        // Find matching activity by name (case insensitive)
        const match = activities?.find(a => a.name?.toLowerCase().trim() === act.name.toLowerCase().trim());
        if (match) {
            const { error } = await client.from('activities')
                .update({ manual_count: act.count })
                .eq('id', match.id);
            if (error) {
                console.error(`Error updating ${act.name}:`, error.message);
            } else {
                console.log(`✓ ${act.name}: ${act.count}`);
                updated++;
            }
        } else {
            console.log(`⚠ Activity not found: ${act.name}`);
        }
    }

    console.log(`\nUpdated ${updated}/${activityData.length} activities`);
    const total = activityData.reduce((sum, a) => sum + a.count, 0);
    console.log(`Total experiences: ${total}`);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
