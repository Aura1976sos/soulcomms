const { createClient } = require('@supabase/supabase-js');

const url = 'https://spb-t4n599sao4ett36b.supabase.opentrust.net';
const anonKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs';

(async () => {
    const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: { session }, error } = await supabase.auth.signInWithPassword({
        email: 'delightdesign.org@gmail.com',
        password: 'KGdelight@1',
    });

    console.log(JSON.stringify({ error, hasSession: !!session, hasAccessToken: !!session?.access_token }, null, 2));
    if (session?.access_token) {
        console.log('ACCESS_TOKEN=' + session.access_token);
    }
})();
