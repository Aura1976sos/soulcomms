import { createClient } from '@supabase/supabase-js';

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';
const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

const eventId = '9d282cb7-6c10-438c-912b-ff70df8e6af1'; // TG100E

// Hourly check-in data
const hourlyData = [
    { hour: 8, count: 1 },      // 8AM
    { hour: 10, count: 3 },     // 10AM
    { hour: 11, count: 36 },    // 11AM
    { hour: 12, count: 75 },    // 12PM
    { hour: 13, count: 66 },    // 1PM
    { hour: 14, count: 93 },    // 2PM
    { hour: 15, count: 121 },   // 3PM
    { hour: 16, count: 144 },   // 4PM (PEAK)
    { hour: 17, count: 88 },    // 5PM
    { hour: 18, count: 128 },   // 6PM
    { hour: 19, count: 138 },   // 7PM
    { hour: 20, count: 124 },   // 8PM
    { hour: 21, count: 73 },    // 9PM
    { hour: 22, count: 74 },    // 10PM
    { hour: 23, count: 32 },    // 11PM
    { hour: 0, count: 17 },     // 12AM
    { hour: 1, count: 10 },     // 1AM
    { hour: 2, count: 6 },      // 2AM
    { hour: 3, count: 1 },      // 3AM
];

try {
    // Sign in
    const { data: auth } = await client.auth.signInWithPassword({
        email: 'delightdesign.org@gmail.com',
        password: 'KGdelight@1'
    });

    console.log('Authentication successful\n');

    // Delete existing data for this event
    await client.from('check_in_hourly_analytics')
        .delete()
        .eq('event_id', eventId);

    console.log('Cleared existing hourly data\n');

    // Insert hourly check-in data
    const { data, error } = await client.from('check_in_hourly_analytics')
        .insert(hourlyData.map(d => ({
            event_id: eventId,
            hour: d.hour,
            check_in_count: d.count
        })))
        .select();

    if (error) {
        console.error('Error inserting hourly data:', error.message);
        process.exit(1);
    }

    console.log(`✓ Inserted ${data.length} hourly records\n`);

    // Calculate and display statistics
    const totalCheckIns = hourlyData.reduce((sum, d) => sum + d.count, 0);
    const peakHour = hourlyData.reduce((max, d) => d.count > max.count ? d : max);
    const avgPerHour = (totalCheckIns / hourlyData.length).toFixed(1);

    console.log('Check-In Summary:');
    console.log(`├─ Total Check-Ins: ${totalCheckIns}`);
    console.log(`├─ Peak Hour: ${peakHour.hour}:00 (${peakHour.count} check-ins)`);
    console.log(`├─ Hours with Activity: ${hourlyData.length}`);
    console.log(`└─ Average per Hour: ${avgPerHour}\n`);

    // Display hourly breakdown
    console.log('Hourly Breakdown:');
    const formatHour = (h) => {
        if (h === 0) return '12AM';
        if (h < 12) return `${h}AM`;
        if (h === 12) return '12PM';
        return `${h - 12}PM`;
    };

    hourlyData.forEach(d => {
        const bar = '█'.repeat(Math.ceil(d.count / 5));
        console.log(`  ${formatHour(d.hour).padEnd(5)} │ ${bar} ${d.count}`);
    });

    console.log('\nMigration completed successfully!');
    process.exit(0);
} catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
}
