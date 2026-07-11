import pgPromise from "pg-promise";

const ACTIVITY_NAME = "Live It 100 Murah";
const EVENT_NAME = "The Gathering 100 - MTN Live It 100 KANO";

const codes = [
    "04422", "14508", "31448", "3799", "45311", "46856", "46904", "52885", "63633", "67034",
    "68373", "68374", "68375", "68376", "68377", "68378", "68379", "68380", "68381", "68382",
    "68383", "68384", "68385", "68386", "68387", "68388", "68389", "68390", "68391", "68392",
    "68393", "68394", "68395", "68396", "68397", "68398", "71851", "72812", "88386", "9161633063",
    "9161633065", "9161633075", "9161633076", "9161633080", "9161633087", "9161633094", "9161633099",
    "9161633101", "9161633104", "9161633105"
];

const normalizedCodes = [...new Set(codes.map(c => c.replace(/^#/, "").trim()).filter(Boolean))];

const pgp = pgPromise();
const db = pgp({
    host: "db.spb-t4n599sao4ett36b.supabase.co",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: process.env.SUPABASE_DB_PASSWORD || "entercloud123!",
    ssl: { rejectUnauthorized: false },
});

async function main() {
    const fixedTs = new Date().toISOString();

    const activity = await db.oneOrNone(
        `
    select
      a.id,
      a.event_id,
      a.code,
      coalesce(a.points_value, 0) as points_value
    from activities a
    join events e on e.id = a.event_id
    where lower(trim(a.name)) = lower(trim($1))
      and e.name = $2
    limit 1
    `,
        [ACTIVITY_NAME, EVENT_NAME]
    );

    if (!activity) {
        throw new Error(`Activity '${ACTIVITY_NAME}' for event '${EVENT_NAME}' not found.`);
    }

    const matchedParticipants = await db.any(
        `
    select
      p.id,
      p.code,
      regexp_replace(p.code, '^#', '') as code_norm
    from participants p
    where p.event_id = $1
      and coalesce(p.is_checked_in, false) = true
      and regexp_replace(p.code, '^#', '') = any($2::text[])
    `,
        [activity.event_id, normalizedCodes]
    );

    const matchedIds = matchedParticipants.map(p => p.id);

    let existingIds = [];
    if (matchedIds.length > 0) {
        existingIds = await db.map(
            `
      select participant_id
      from activity_logs
      where activity_id = $1
        and participant_id = any($2::uuid[])
      `,
            [activity.id, matchedIds],
            r => r.participant_id
        );
    }

    const existingSet = new Set(existingIds);
    const eligibleIds = matchedIds.filter(id => !existingSet.has(id));

    let inserted = [];
    if (eligibleIds.length > 0) {
        inserted = await db.any(
            `
      insert into activity_logs (
        participant_id,
        participant_code,
        experience,
        activity_id,
        event_id,
        points_awarded,
        recorded_at,
        recorded_by
      )
      select
        p.id,
        p.code,
        $3,
        $1,
        $4,
        $5,
        $6,
        null
      from participants p
      where p.id = any($2::uuid[])
      returning participant_code
      `,
            [activity.id, eligibleIds, activity.code, activity.event_id, activity.points_value, fixedTs]
        );
    }

    const matchedCodeSet = new Set(matchedParticipants.map(p => String(p.code_norm)));
    const notMatchedCodes = normalizedCodes.filter(c => !matchedCodeSet.has(c));

    console.log("Live It Murah one-off insert completed");
    console.log("Event:", EVENT_NAME);
    console.log("Activity:", ACTIVITY_NAME, `(${activity.id})`);
    console.log("Timestamp used:", fixedTs);
    console.log("Requested codes:", normalizedCodes.length);
    console.log("Matched checked-in:", matchedParticipants.length);
    console.log("Already had Live It Murah:", existingIds.length);
    console.log("Inserted now:", inserted.length);
    console.log("Not matched by code (or not checked-in in this event):", notMatchedCodes.length);

    if (notMatchedCodes.length > 0) {
        console.log("Not matched codes:", notMatchedCodes.join(", "));
    }
}

main()
    .catch((err) => {
        console.error("ERROR:", err.message || err);
        process.exitCode = 1;
    })
    .finally(() => {
        pgp.end();
    });
