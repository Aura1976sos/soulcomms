import { createClient } from "@supabase/supabase-js";

const ACTIVITY_NAME = "Live It Murah";
const EVENT_NAME = "The Gathering 100 - MTN Live It 100 KANO";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://spb-t4n599sao4ett36b.supabase.opentrust.net";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const codes = [
    "04422", "14508", "31448", "3799", "45311", "46856", "46904", "52885", "63633", "67034",
    "68373", "68374", "68375", "68376", "68377", "68378", "68379", "68380", "68381", "68382",
    "68383", "68384", "68385", "68386", "68387", "68388", "68389", "68390", "68391", "68392",
    "68393", "68394", "68395", "68396", "68397", "68398", "71851", "72812", "88386", "9161633063",
    "9161633065", "9161633075", "9161633076", "9161633080", "9161633087", "9161633094", "9161633099",
    "9161633101", "9161633104", "9161633105"
];

if (!SERVICE_KEY) {
    console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is required for REST fallback script.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const normalizedCodes = [...new Set(codes.map(c => c.replace(/^#/, "").trim()).filter(Boolean))];

async function main() {
    const fixedTs = new Date().toISOString();

    const { data: eventRow, error: eventErr } = await supabase
        .from("events")
        .select("id")
        .eq("name", EVENT_NAME)
        .limit(1)
        .maybeSingle();
    if (eventErr) throw eventErr;
    if (!eventRow) throw new Error(`Event not found: ${EVENT_NAME}`);

    const { data: activityRow, error: activityErr } = await supabase
        .from("activities")
        .select("id,event_id,code,points_value")
        .eq("event_id", eventRow.id)
        .ilike("name", ACTIVITY_NAME)
        .limit(1)
        .maybeSingle();
    if (activityErr) throw activityErr;
    if (!activityRow) throw new Error(`Activity not found: ${ACTIVITY_NAME}`);

    const { data: participants, error: pErr } = await supabase
        .from("participants")
        .select("id,code,is_checked_in")
        .eq("event_id", eventRow.id)
        .eq("is_checked_in", true)
        .in("code", normalizedCodes);
    if (pErr) throw pErr;

    const matched = participants ?? [];
    const matchedIds = matched.map(p => p.id);

    let existing = [];
    if (matchedIds.length > 0) {
        const { data: existingRows, error: eErr } = await supabase
            .from("activity_logs")
            .select("participant_id")
            .eq("activity_id", activityRow.id)
            .in("participant_id", matchedIds);
        if (eErr) throw eErr;
        existing = existingRows ?? [];
    }

    const existingSet = new Set(existing.map(r => r.participant_id));
    const toInsert = matched
        .filter(p => !existingSet.has(p.id))
        .map(p => ({
            participant_id: p.id,
            participant_code: p.code,
            experience: activityRow.code,
            activity_id: activityRow.id,
            event_id: activityRow.event_id,
            points_awarded: activityRow.points_value ?? 0,
            recorded_at: fixedTs,
            recorded_by: null,
        }));

    let insertedCount = 0;
    if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from("activity_logs").insert(toInsert);
        if (insErr) throw insErr;
        insertedCount = toInsert.length;
    }

    const matchedCodeSet = new Set(matched.map(p => String(p.code).replace(/^#/, "")));
    const notMatchedCodes = normalizedCodes.filter(c => !matchedCodeSet.has(c));

    console.log("Live It Murah REST one-off completed");
    console.log("Timestamp used:", fixedTs);
    console.log("Requested codes:", normalizedCodes.length);
    console.log("Matched checked-in:", matched.length);
    console.log("Already had Live It Murah:", existing.length);
    console.log("Inserted now:", insertedCount);
    console.log("Not matched by code (or not checked-in in this event):", notMatchedCodes.length);
    if (notMatchedCodes.length > 0) {
        console.log("Not matched codes:", notMatchedCodes.join(", "));
    }
}

main().catch((err) => {
    console.error("ERROR:", err.message || err);
    process.exit(1);
});
