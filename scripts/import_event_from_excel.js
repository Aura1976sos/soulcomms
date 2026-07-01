import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://spb-t4n599sao4ett36b.supabase.opentrust.net";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || null;
const SUPABASE_KEY = SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi10NG41OTlzYW80ZXR0MzZiIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODA1Mjg5MDEsImV4cCI6MjA5NjEwNDkwMX0._aoeJF8XQvS8e5wzj1zJa0wV8oaA2FauCsnnCYTjXQs";
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_AUTH_TOKEN || process.env.SUPABASE_SESSION_ACCESS_TOKEN || null;
const SUPABASE_EMAIL = process.env.SUPABASE_EMAIL || null;
const SUPABASE_PASSWORD = process.env.SUPABASE_PASSWORD || null;

let authenticatedToken = null;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureAuthenticatedSession() {
    if (authenticatedToken) return authenticatedToken;

    if (SUPABASE_EMAIL && SUPABASE_PASSWORD) {
        const { data: { session }, error } = await supabase.auth.signInWithPassword({ email: SUPABASE_EMAIL, password: SUPABASE_PASSWORD });
        if (error) throw error;
        if (session) {
            authenticatedToken = session.access_token;
            supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
            return session;
        }
    }

    if (SUPABASE_ACCESS_TOKEN) {
        const normalizedToken = SUPABASE_ACCESS_TOKEN.startsWith("Bearer ") ? SUPABASE_ACCESS_TOKEN.slice(7) : SUPABASE_ACCESS_TOKEN;
        authenticatedToken = normalizedToken;
        supabase.auth.setSession({ access_token: normalizedToken, refresh_token: "" });
    }

    return null;
}

function parseArgs() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const getValue = (flag) => {
        const direct = args.find((arg) => arg.startsWith(flag + "="));
        if (direct) return direct.split("=").slice(1).join("=");

        const index = args.findIndex((arg) => arg === flag);
        if (index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")) {
            return args[index + 1];
        }
        return null;
    };

    const positionalArgs = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--dry-run") continue;
        if (arg === "--event-name" || arg === "--event-code" || arg === "--start-code") {
            index += 1;
            continue;
        }
        if (arg.startsWith("--")) continue;
        positionalArgs.push(arg);
    }

    return {
        dryRun,
        filePath: positionalArgs[0] || process.env.MIGRATION_FILE || process.env.FILE_PATH || null,
        eventName: getValue("--event-name") || process.env.TARGET_EVENT_NAME || null,
        eventCode: getValue("--event-code") || process.env.TARGET_EVENT_CODE || null,
        startCode: Number(getValue("--start-code") || process.env.START_CODE || "10001"),
    };
}

function normalizeText(value) {
    return String(value ?? "").trim();
}

function normalizeName(value) {
    return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugify(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}

function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function getSheet(workbook, names) {
    const lowerNames = workbook.SheetNames.map((sheetName) => sheetName.toLowerCase());
    for (const name of names) {
        const index = lowerNames.findIndex((sheetName) => sheetName.includes(name.toLowerCase()));
        if (index >= 0) return workbook.Sheets[workbook.SheetNames[index]];
    }
    return workbook.Sheets[workbook.SheetNames[0]];
}

function parseWorkbook(filePath) {
    const workbook = XLSX.readFile(filePath);
    const overviewSheet = getSheet(workbook, ["overview"]);
    const activitiesSheet = getSheet(workbook, ["18 activities", "activities"]);
    const checkInSheet = getSheet(workbook, ["check-in log", "checkin log", "check-in", "checkin"]);
    const rawSheet = getSheet(workbook, ["raw records", "records", "raw"]);

    const overviewRows = XLSX.utils.sheet_to_json(overviewSheet, { defval: "", blankrows: false, raw: false });
    const activitiesRows = XLSX.utils.sheet_to_json(activitiesSheet, { defval: "", blankrows: false, raw: false });
    const checkInRows = XLSX.utils.sheet_to_json(checkInSheet, { defval: "", blankrows: false, raw: false });
    const rawRows = XLSX.utils.sheet_to_json(rawSheet, { defval: "", blankrows: false, raw: false });

    const overview = {};
    for (const row of overviewRows) {
        const metric = normalizeText(row.Metric || row.metric || row["Metric"] || row["metric"]);
        const value = normalizeText(row.Value || row.value || row["Value"] || row["value"]);
        if (metric) overview[metric.toLowerCase().replace(/[^a-z0-9]+/g, "_")] = value;
    }

    const activities = activitiesRows
        .map((row) => ({
            name: normalizeText(row.Activity || row.activity || row.Name || row.name),
            group: normalizeText(row.Group || row.group || row.Category || row.category),
            totalRecords: Number(normalizeText(row["Total Records"] || row.total_records || row["Total records"] || row.totalRecords || 0)) || 0,
            uniqueParticipants: Number(normalizeText(row["Unique Participants"] || row.unique_participants || row["Unique participants"] || row.uniqueParticipants || 0)) || 0,
            sessionsMerged: Number(normalizeText(row["Sessions Merged"] || row.sessions_merged || row["Sessions merged"] || row.sessionsMerged || 1)) || 1,
        }))
        .filter((activity) => activity.name);

    const checkIns = checkInRows
        .map((row) => ({
            participant: normalizeText(row.Participant || row.participant || row.Name || row.name),
            checkedInAt: normalizeText(row["Checked In At"] || row.checked_in_at || row["Checked in at"] || row.checkedInAt),
            checkedInBy: normalizeText(row["Checked In By"] || row.checked_in_by || row["Checked in by"] || row.checkedInBy),
            notes: normalizeText(row.Notes || row.notes || row.Note || row.note),
        }))
        .filter((entry) => entry.participant);

    const rawRecords = rawRows
        .map((row) => ({
            participant: normalizeText(row.Participant || row.participant || row.Name || row.name),
            consolidatedActivity: normalizeText(row["Consolidated Activity"] || row.consolidated_activity || row["Consolidated activity"] || row.consolidatedActivity),
            rawActivity: normalizeText(row["Raw Activity"] || row.raw_activity || row["Raw activity"] || row.rawActivity),
            group: normalizeText(row.Group || row.group),
            recordedAt: normalizeText(row["Recorded At"] || row.recorded_at || row["Recorded at"] || row.recordedAt),
            recordedBy: normalizeText(row["Recorded By"] || row.recorded_by || row["Recorded by"] || row.recordedBy),
            notes: normalizeText(row.Notes || row.notes || row.Note || row.note),
        }))
        .filter((entry) => entry.participant || entry.consolidatedActivity);

    return { overview, activities, checkIns, rawRecords };
}

async function ensureEvent(targetName, targetCode, dryRun) {
    const fallbackName = targetName || "The Gathering on 100 - Enugu";
    const fallbackCode = targetCode || "TG100E";

    if (dryRun) {
        return { id: "dry-run-event-id", name: fallbackName, code: fallbackCode };
    }

    let query = supabase.from("events").select("id, name, code");
    if (targetCode) {
        query = query.eq("code", targetCode);
    } else if (targetName) {
        query = query.ilike("name", `%${targetName}%`);
    }

    const { data: events, error } = await query.limit(1);
    if (error) throw error;
    const existing = events?.[0];
    if (existing) return existing;

    const insertPayload = {
        name: fallbackName,
        code: fallbackCode,
        status: "active",
        venue: null,
        description: null,
        date: new Date().toISOString().slice(0, 10),
    };

    const { data, error: insertError } = await supabase.from("events").insert(insertPayload).select("id,name,code").single();
    if (insertError) {
        if (insertError.message?.includes("row-level security") || insertError.code === "42501") {
            throw new Error(`Supabase rejected the event insert because of row-level security. Provide a service-role key via SUPABASE_SERVICE_ROLE_KEY. Original error: ${insertError.message}`);
        }
        throw insertError;
    }
    return data;
}

async function fetchExistingState(eventId) {
    const [{ data: activitiesData }, { data: participantsData }, { data: sessionsData }] = await Promise.all([
        supabase.from("activities").select("id, name").eq("event_id", eventId),
        supabase.from("participants").select("id, name, code").eq("event_id", eventId),
        supabase.from("activity_sessions").select("id, activity_id").eq("event_id", eventId),
    ]);

    const existingActivities = new Map((activitiesData || []).map((activity) => [normalizeName(activity.name), activity]));
    const existingParticipants = new Map((participantsData || []).map((participant) => [normalizeName(participant.name), participant]));
    const existingSessions = new Map((sessionsData || []).map((session) => [session.activity_id, session]));

    return { existingActivities, existingParticipants, existingSessions };
}

async function upsertParticipants(participants, eventId, dryRun, startCode) {
    if (!participants.length) return { inserted: 0, updated: 0, skipped: 0 };

    const participantNames = [...new Set(participants.map((entry) => normalizeName(entry.name)).filter(Boolean))];
    const existingState = dryRun ? null : await fetchExistingState(eventId);
    const existingParticipants = dryRun ? new Map() : existingState.existingParticipants;

    const participantEntries = [];
    let nextCode = startCode;
    for (const name of participantNames) {
        const existing = existingParticipants.get(name);
        if (existing) {
            participantEntries.push({ name: existing.name, id: existing.id, code: existing.code, isExisting: true });
            continue;
        }

        const participantName = participants.find((entry) => normalizeName(entry.name) === name)?.name || name;
        participantEntries.push({ name: participantName, id: null, code: String(nextCode++), isExisting: false });
    }

    if (dryRun) {
        return { inserted: participantEntries.filter((entry) => !entry.isExisting).length, updated: 0, skipped: participantEntries.filter((entry) => entry.isExisting).length };
    }

    const toInsert = participantEntries.filter((entry) => !entry.isExisting);
    if (toInsert.length) {
        const payload = toInsert.map((entry) => ({
            code: entry.code,
            name: entry.name,
            event_id: eventId,
            is_checked_in: false,
            checked_in_at: null,
            source: "CSV Import",
        }));

        const { error } = await supabase.from("participants").insert(payload);
        if (error) {
            if (error.message?.includes("row-level security") || error.code === "42501") {
                throw new Error(`Supabase rejected the participant insert because of row-level security. Provide a service-role key via SUPABASE_SERVICE_ROLE_KEY. Original error: ${error.message}`);
            }
            throw error;
        }
    }

    const participantReference = new Map();
    const allParticipants = await supabase.from("participants").select("id, name, code").eq("event_id", eventId);
    for (const row of allParticipants.data || []) {
        participantReference.set(normalizeName(row.name), row);
    }

    const participantMap = new Map();
    for (const entry of participantEntries) {
        if (entry.isExisting) {
            participantMap.set(normalizeName(entry.name), { id: entry.id, code: entry.code, name: entry.name });
        } else {
            const created = participantReference.get(normalizeName(entry.name));
            if (created) participantMap.set(normalizeName(entry.name), created);
        }
    }

    return { inserted: toInsert.length, updated: 0, skipped: participantEntries.filter((entry) => entry.isExisting).length, participantMap };
}

async function upsertActivities(activities, eventId, dryRun) {
    if (!activities.length) return { inserted: 0, activityMap: new Map() };

    const activityMap = new Map();
    if (dryRun) {
        for (const activity of activities) {
            activityMap.set(normalizeName(activity.name), { name: activity.name, id: `dry-run-${slugify(activity.name)}` });
        }
        return { inserted: activities.length, activityMap };
    }

    const existingState = await fetchExistingState(eventId);
    const existingActivities = existingState.existingActivities;
    const toInsert = [];
    for (const activity of activities) {
        const key = normalizeName(activity.name);
        if (existingActivities.has(key)) {
            activityMap.set(key, existingActivities.get(key));
            continue;
        }

        toInsert.push({
            name: activity.name,
            code: slugify(activity.name) || `activity-${Date.now()}-${toInsert.length + 1}`,
            event_id: eventId,
            category: activity.group || "General",
            manual_count: activity.uniqueParticipants || activity.totalRecords || 0,
            status: "active",
            is_single_session: false,
            description: `${activity.group || "General"} activity imported from workbook`,
        });
    }

    if (toInsert.length) {
        const { data, error } = await supabase.from("activities").insert(toInsert).select("id, name");
        if (error) {
            if (error.message?.includes("row-level security") || error.code === "42501") {
                throw new Error(`Supabase rejected the activity insert because of row-level security. Provide a service-role key via SUPABASE_SERVICE_ROLE_KEY. Original error: ${error.message}`);
            }
            throw error;
        }
        for (const row of data || []) {
            activityMap.set(normalizeName(row.name), row);
        }
    }

    return { inserted: toInsert.length, activityMap };
}

async function upsertSessions(activities, activityMap, eventId, dryRun, eventDate) {
    if (!activities.length) return { inserted: 0, sessionMap: new Map() };

    const sessionMap = new Map();
    if (dryRun) {
        for (const activity of activities) {
            const key = normalizeName(activity.name);
            const activityId = activityMap.get(key)?.id || `dry-run-${key}`;
            sessionMap.set(key, { id: `dry-run-session-${key}`, activity_id: activityId });
        }
        return { inserted: activities.length, sessionMap };
    }

    const existingSessions = await supabase.from("activity_sessions").select("id, activity_id").eq("event_id", eventId);
    const existingSessionByActivity = new Map((existingSessions.data || []).map((session) => [session.activity_id, session]));

    const toInsert = [];
    for (const activity of activities) {
        const activityId = activityMap.get(normalizeName(activity.name))?.id;
        if (!activityId) continue;
        if (existingSessionByActivity.has(activityId)) {
            sessionMap.set(normalizeName(activity.name), existingSessionByActivity.get(activityId));
            continue;
        }

        toInsert.push({
            activity_id: activityId,
            event_id: eventId,
            session_date: eventDate,
            start_time: "00:00:00",
            end_time: "23:59:00",
            status: "completed",
            location: null,
            capacity: null,
        });
    }

    if (toInsert.length) {
        const { data, error } = await supabase.from("activity_sessions").insert(toInsert).select("id, activity_id");
        if (error) {
            if (error.message?.includes("row-level security") || error.code === "42501") {
                throw new Error(`Supabase rejected the session insert because of row-level security. Provide a service-role key via SUPABASE_SERVICE_ROLE_KEY. Original error: ${error.message}`);
            }
            throw error;
        }
        for (const row of data || []) {
            const matchingActivity = activities.find((activity) => normalizeName(activity.name) === normalizeName(activityMap.get(normalizeName(activity.name))?.name || ""));
            if (matchingActivity) sessionMap.set(normalizeName(matchingActivity.name), row);
        }
    }

    return { inserted: toInsert.length, sessionMap };
}

async function importCheckIns(checkIns, eventId, participantMap, dryRun) {
    if (!checkIns.length) return { inserted: 0 };

    // Fetch all participants directly to ensure we have the latest data
    let allParticipants = [];
    if (!dryRun) {
        const { data } = await supabase.from("participants").select("id, name, code").eq("event_id", eventId);
        allParticipants = data || [];
    }

    // Build lookup map from fetched participants
    const dbParticipantMap = new Map();
    for (const p of allParticipants) {
        dbParticipantMap.set(normalizeName(p.name), p);
    }

    // Merge with passed participantMap
    const mergedMap = new Map([...participantMap, ...dbParticipantMap]);

    const toInsert = [];
    const skipped = [];
    for (const entry of checkIns) {
        const participant = mergedMap.get(normalizeName(entry.participant));
        if (!participant) {
            skipped.push(entry.participant);
            continue;
        }
        const parsedDate = parseDate(entry.checkedInAt);
        if (!parsedDate) continue;
        toInsert.push({
            event_id: eventId,
            record_code: participant.code,
            record_id: participant.id,
            record_name: participant.name,
            record_type: "participant",
            original_check_in_method: entry.checkedInBy || "staff",
            original_checked_in_at: parsedDate.toISOString(),
            reason: entry.notes || null,
        });
    }

    if (skipped.length > 0) {
        console.log(`  Warning: ${skipped.length} check-ins could not find matching participants (first 5: ${skipped.slice(0, 5).join(", ")})`);
    }

    if (dryRun) return { inserted: toInsert.length };
    if (!toInsert.length) {
        console.log(`  No check-in records to insert`);
        return { inserted: 0 };
    }

    console.log(`  Inserting ${toInsert.length} check-in records with first record:`, JSON.stringify(toInsert[0]));
    const { error, data, status } = await supabase.from("checkin_history").insert(toInsert);

    console.log(`  Insert response - status: ${status}, data: ${data ? 'received' : 'null'}, error: ${error ? error.message : 'none'}`);
    if (error) {
        console.error(`  INSERT ERROR:`, JSON.stringify(error));
        if (error.message?.includes("row-level security") || error.code === "42501") {
            throw new Error(`Supabase rejected the check-in insert because of row-level security. Provide a service-role key via SUPABASE_SERVICE_ROLE_KEY. Original error: ${error.message}`);
        }
        throw error;
    }

    // Verify the insert actually persisted
    const { count: verifyCount, error: verifyError } = await supabase.from("checkin_history").select('*', { count: 'exact' }).eq('event_id', eventId);
    console.log(`  ✓ Successfully inserted ${toInsert.length} check-in records. Verification count: ${verifyCount}`);
}

async function importActivityLogs(rawRecords, activityMap, sessionMap, participantMap, eventId, dryRun) {
    if (!rawRecords.length) return { inserted: 0 };

    const toInsert = [];
    for (const record of rawRecords) {
        const participant = participantMap.get(normalizeName(record.participant));
        const activity = activityMap.get(normalizeName(record.consolidatedActivity || record.rawActivity));
        if (!participant || !activity) continue;
        const session = sessionMap.get(normalizeName(record.consolidatedActivity || record.rawActivity));
        const parsedDate = parseDate(record.recordedAt);
        if (!parsedDate) continue;
        toInsert.push({
            event_id: eventId,
            activity_id: activity.id,
            participant_code: participant.code,
            participant_id: participant.id,
            recorded_at: parsedDate.toISOString(),
            recorded_by: null,
            experience: record.rawActivity || record.consolidatedActivity || "Imported from workbook",
        });
    }

    if (dryRun) return { inserted: toInsert.length };
    if (!toInsert.length) return { inserted: 0 };

    for (let index = 0; index < toInsert.length; index += 200) {
        const chunk = toInsert.slice(index, index + 200);
        const { error } = await supabase.from("activity_logs").insert(chunk);
        if (error) {
            if (error.message?.includes("row-level security") || error.code === "42501") {
                throw new Error(`Supabase rejected the activity log insert because of row-level security. Provide a service-role key via SUPABASE_SERVICE_ROLE_KEY. Original error: ${error.message}`);
            }
            throw error;
        }
    }

    return { inserted: toInsert.length };
}

async function importSessionParticipations(rawRecords, activityMap, sessionMap, participantMap, eventId, dryRun) {
    if (!rawRecords.length) return { inserted: 0 };

    const toInsert = [];
    let counter = 1;
    for (const record of rawRecords) {
        const participant = participantMap.get(normalizeName(record.participant));
        const activity = activityMap.get(normalizeName(record.consolidatedActivity || record.rawActivity));
        const session = sessionMap.get(normalizeName(record.consolidatedActivity || record.rawActivity));
        if (!participant || !activity || !session) continue;
        const key = `${session.id}:${participant.id}`;
        if (toInsert.some((entry) => entry.session_id === session.id && entry.participant_id === participant.id)) continue;

        toInsert.push({
            session_id: session.id,
            activity_id: activity.id,
            event_id: eventId,
            participant_id: participant.id,
            participant_code: participant.code,
            participant_name: participant.name,
            participation_code: `SP-${String(counter++).padStart(5, "0")}`,
            status: "verified",
            generated_at: parseDate(record.recordedAt)?.toISOString() || null,
        });
    }

    if (dryRun) return { inserted: toInsert.length };
    if (!toInsert.length) return { inserted: 0 };

    for (let index = 0; index < toInsert.length; index += 200) {
        const chunk = toInsert.slice(index, index + 200);
        const { error } = await supabase.from("session_participations").insert(chunk);
        if (error) {
            if (error.message?.includes("row-level security") || error.code === "42501") {
                throw new Error(`Supabase rejected the session participation insert because of row-level security. Provide a service-role key via SUPABASE_SERVICE_ROLE_KEY. Original error: ${error.message}`);
            }
            throw error;
        }
    }

    return { inserted: toInsert.length };
}

async function main() {
    const options = parseArgs();
    await ensureAuthenticatedSession();
    const fallbackFile = path.resolve(process.cwd(), "public", "The Gathering on 100 - Enugu-event-report (2).xlsx");
    const resolvedFile = options.filePath ? path.resolve(process.cwd(), options.filePath) : fallbackFile;

    if (!fs.existsSync(resolvedFile)) {
        console.error("Import file not found:", resolvedFile);
        process.exit(1);
    }

    const workbookData = parseWorkbook(resolvedFile);
    console.log(`Loaded workbook: ${resolvedFile}`);
    console.log(`Overview: ${JSON.stringify(workbookData.overview)}`);
    console.log(`Activities: ${workbookData.activities.length}`);
    console.log(`Check-ins: ${workbookData.checkIns.length}`);
    console.log(`Raw records: ${workbookData.rawRecords.length}`);

    const eventName = options.eventName || workbookData.overview.event || "The Gathering on 100 - Enugu";
    const eventCode = options.eventCode || workbookData.overview.event_code || "TG100E";
    const targetEvent = await ensureEvent(eventName, eventCode, options.dryRun);
    console.log(`Target event: ${targetEvent.name} (${targetEvent.code || targetEvent.id})`);

    const participantNames = Array.from(
        new Set([
            ...(workbookData.checkIns || []).map((entry) => entry.participant),
            ...(workbookData.rawRecords || []).map((entry) => entry.participant),
        ].filter(Boolean))
    );
    const participantResult = await upsertParticipants(participantNames.map((name) => ({ name })), targetEvent.id, options.dryRun, options.startCode);
    console.log(`Participants: inserted=${participantResult.inserted}, skipped=${participantResult.skipped}, updated=${participantResult.updated}`);

    const activityResult = await upsertActivities(workbookData.activities, targetEvent.id, options.dryRun);
    console.log(`Activities: inserted=${activityResult.inserted}`);

    const eventDate = workbookData.checkIns?.[0]?.checkedInAt ? parseDate(workbookData.checkIns[0].checkedInAt)?.toISOString().slice(0, 10) : null;
    const sessionResult = await upsertSessions(workbookData.activities, activityResult.activityMap, targetEvent.id, options.dryRun, eventDate);
    console.log(`Sessions: inserted=${sessionResult.inserted}`);

    const checkInResult = await importCheckIns(workbookData.checkIns, targetEvent.id, participantResult.participantMap || new Map(), options.dryRun);
    console.log(`Check-in history entries: ${checkInResult.inserted}`);

    const activityLogResult = await importActivityLogs(workbookData.rawRecords, activityResult.activityMap, sessionResult.sessionMap, participantResult.participantMap || new Map(), targetEvent.id, options.dryRun);
    console.log(`Activity logs: ${activityLogResult.inserted}`);

    const sessionParticipationResult = await importSessionParticipations(workbookData.rawRecords, activityResult.activityMap, sessionResult.sessionMap, participantResult.participantMap || new Map(), targetEvent.id, options.dryRun);
    console.log(`Session participations: ${sessionParticipationResult.inserted}`);

    if (options.dryRun) {
        console.log("Dry run completed — no data was inserted");
    } else {
        console.log("Migration completed");
    }
}

main().catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
});
