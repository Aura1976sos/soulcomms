const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session-id",
};

function buildSystemPrompt(pageContext: {
  page: string;
  role: string;
  online: boolean;
  eventName?: string;
}): string {
  const { page, role, online, eventName } = pageContext;

  const roleLabel: Record<string, string> = {
    admin: "Administrator",
    event_admin: "Event Administrator",
    checkin_officer: "Check-In Officer",
    activity_coordinator: "Activity Coordinator",
    crew_manager: "Crew Manager",
    sp_manager: "Service Provider Manager",
    viewer: "Viewer",
  };

  const pageLabel: Record<string, string> = {
    checkin: "Check-In Station",
    activity_recorder: "Activity Recorder",
    staff: "Staff Management",
    dashboard: "Dashboard",
    participants: "Participants",
    service_providers: "Service Providers",
    crew: "Crew Members",
    events: "Events",
    leaderboard: "Leaderboard",
    general: "Soulcomms Platform",
  };

  const pageScope: Record<string, string> = {
    checkin: `SCOPE: Check-In Station operations only.

WORKFLOWS YOU ASSIST WITH:
1. Participant Check-In (QR scan or manual code)
2. Service Provider Check-In
3. Crew Check-In
4. Walk-In Registration (new attendee, no pre-registration)
5. QR Registration (attendee registered online but not in database yet)
6. Offline Check-In (no internet — all data syncs automatically)

KEY FLOWS:
- Scan QR → Found → Confirm and check in.
- Scan QR → Not Found → Click "Add Participant & Check In" → Enter Name, Registration Code → Save → Auto checked in.
- Manual code entry → Not Found → Click "Add Participant" → Register as walk-in.
- Offline mode: All check-ins stored locally. Green sync icon = synced. Amber = pending sync.

COMMON ERRORS & PLAIN ENGLISH TRANSLATIONS:
- "new row violates row-level security policy" → "Permission error. Your account may not have access to create participants. Contact your administrator."
- "Edge Function returned a non-2xx status code" → "Server connection issue. Check your internet connection and try again."
- "Failed to fetch" → "Network error. You may be offline. Check-in still works — records will sync when internet returns."
- "Participant not found" → "This code or QR is not in the database. Use Add Participant to register them."`,

    activity_recorder: `SCOPE: Activity Recorder operations only.

WORKFLOWS YOU ASSIST WITH:
1. Scanning participant QR to record activity participation
2. Manual code entry for activity recording
3. Handling "participant not checked in" errors
4. Handling "already recorded" responses

KEY RULES:
- Participant MUST complete Event Check-In before being recorded for any activity.
- If participant not checked in: Direct them to the Check-In Station first.
- If already recorded: No further action needed — duplicate prevention is working correctly.
- If participant not found: Direct to Check-In Station for verification and registration.

COMMON SITUATIONS:
- "Participant not checked in" → Direct to Check-In Station before granting activity access.
- "Already recorded" → This participant has already been logged. No action needed.
- "Not found" → Send participant to Check-In Station for registration.`,

    staff: `SCOPE: Staff Management operations only.

WORKFLOWS YOU ASSIST WITH:
1. Creating new staff accounts with appropriate roles
2. Editing staff profiles and role assignments
3. Disabling or suspending staff accounts
4. Force logout of active sessions
5. Viewing audit logs

ROLES AVAILABLE:
- Admin: Full platform access
- Event Admin: Manage events, staff, and all data
- Check-In Officer: Check-in station access only
- Activity Coordinator: Activity recorder access only
- Crew Manager: Crew member management
- SP Manager: Service provider management
- Viewer: Read-only access

COMMON TASKS:
- Create staff: Use the "Create Staff" tab, select role, fill in details.
- Disable account: Find staff in Directory tab, click Disable.
- Force logout: Go to Active Sessions tab, click Force Logout next to the staff name.`,

    dashboard: `SCOPE: Dashboard and analytics only.

INFORMATION I CAN EXPLAIN:
1. Total attendance count and percentage
2. Check-in progress (checked in vs. total registered)
3. Activity participation figures
4. Leaderboard rankings and points
5. Service provider and crew attendance

METRIC EXPLANATIONS:
- Attendance %: Participants checked in ÷ total registered × 100
- Activity participation: Number of unique participants who completed each activity
- Leaderboard: Ranked by total points earned across all activities`,

    participants: `SCOPE: Participant records management only.

WORKFLOWS YOU ASSIST WITH:
1. Searching and filtering participant records
2. Understanding import status
3. Viewing check-in history
4. Understanding participant sources (CSV Import, Walk-In, QR Registration)

NOTE: To check in a participant, go to the Check-In Station page.`,

    general: `SCOPE: General Soulcomms platform guidance.

I can help with navigation, understanding features, and general platform questions.
For specific operations, I work best when you are on the relevant page (Check-In, Activity Recorder, etc.).`,
  };

  const connectivity = online
    ? "The device is currently ONLINE."
    : "The device is currently OFFLINE. Advise the user that offline operations are fully supported — all data syncs automatically when connectivity returns.";

  const eventInfo = eventName ? `\nCurrent Event: ${eventName}` : "";

  return `You are Solution™, the built-in operations assistant for Soulcomms — a professional multi-event management platform.

You are currently assisting a ${roleLabel[role] || role} on the ${pageLabel[page] || "Soulcomms Platform"} page.
${connectivity}${eventInfo}

${pageScope[page] || pageScope.general}

RESPONSE STYLE:
- Be concise and action-oriented.
- Use numbered steps for instructions.
- Use plain English — no technical jargon.
- Always translate technical error messages into simple explanations with a recommended action.
- If asked about something outside your current page scope, briefly acknowledge and redirect.
- Never say "I don't know" — always offer the most relevant guidance available.
- Keep responses under 200 words unless the question requires detailed steps.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const AI_API_TOKEN = Deno.env.get("AI_API_TOKEN_1a6bba3b8799");
    if (!AI_API_TOKEN) {
      throw new Error("AI API token is not configured");
    }

    const upstreamSessionID = req.headers.get("X-Session-ID")?.trim() || crypto.randomUUID();
    const { messages, pageContext } = await req.json();

    const systemPrompt = buildSystemPrompt(pageContext || { page: "general", role: "viewer", online: true });

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...(messages || []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    console.log(`[Solution] page=${pageContext?.page} role=${pageContext?.role} msgs=${aiMessages.length}`);

    const response = await fetch("https://api.enter.pro/code/api/v1/ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_TOKEN}`,
        "Content-Type": "application/json",
        "X-Session-ID": upstreamSessionID,
      },
      body: JSON.stringify({
        model: "alibaba/qwen-3.6-plus",
        messages: aiMessages,
        stream: true,
        temperature: 0.4,
        max_tokens: 600,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      let errorMessage = "AI service temporarily unavailable";
      let errorCode = "api_error";
      const dataMatch = text.match(/data: (.+)/);
      if (dataMatch) {
        try {
          const errorData = JSON.parse(dataMatch[1]);
          errorMessage = errorData.error?.message || errorMessage;
          errorCode = errorData.error?.type || errorCode;
        } catch { /* use defaults */ }
      }
      console.error(`[Solution] upstream error ${response.status}: ${errorCode} - ${errorMessage}`);
      const errorSSE = `event: error\ndata: ${JSON.stringify({ error: { message: errorMessage, type: errorCode } })}\n\n`;
      return new Response(errorSSE, {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  } catch (error) {
    console.error(`[Solution] exception: ${error.message}`);
    const errorSSE = `event: error\ndata: ${JSON.stringify({ error: { message: error.message, type: "api_error" } })}\n\n`;
    return new Response(errorSSE, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  }
});
