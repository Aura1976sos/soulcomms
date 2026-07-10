import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_ROLES = [
  "admin", "event_admin", "checkin_officer",
  "activity_coordinator", "crew_manager", "sp_manager", "viewer",
];

function extractToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  return auth.replace(/^Bearer\s+/i, "").trim();
}

function getErrMsg(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

async function insertStaffProfileCompat(
  supabaseAdmin: ReturnType<typeof createClient>,
  payload: { id: string; name: string; role: string; phone?: string | null; assigned_event_id?: string | null }
) {
  // Preferred insert (current schema)
  const firstInsert = {
    id: payload.id,
    name: payload.name,
    role: payload.role,
    phone: payload.phone || null,
    status: "active",
    assigned_event_id: payload.assigned_event_id || null,
  };

  const { error: firstErr } = await supabaseAdmin.from("staff_profiles").insert(firstInsert);
  if (!firstErr) return null;

  const firstMsg = getErrMsg(firstErr);
  const missingColumn = /column .* does not exist/i.test(firstMsg);
  if (!missingColumn) return firstErr;

  // Legacy fallback (older schema without status / assigned_event_id / phone)
  const fallbackInsert = {
    id: payload.id,
    name: payload.name,
    role: payload.role,
  };
  const { error: fallbackErr } = await supabaseAdmin.from("staff_profiles").insert(fallbackInsert);
  return fallbackErr ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Require an authenticated admin caller (same guard model as manage-staff)
    const token = extractToken(req);
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized: no token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized: invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile, error: callerProfileErr } = await supabaseAdmin
      .from("staff_profiles")
      .select("id, role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (callerProfileErr || !callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { email, password, name, role, phone, assigned_event_id } = body;

    if (!email || !password || !name || !role) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!VALID_ROLES.includes(role)) {
      return new Response(JSON.stringify({ error: "Invalid role: " + role }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      return new Response(JSON.stringify({ error: authError.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create staff profile
    const profileError = await insertStaffProfileCompat(supabaseAdmin, {
      id: authData.user.id,
      name,
      role,
      phone: phone || null,
      assigned_event_id: assigned_event_id || null,
    });

    if (profileError) {
      // Clean up auth user if profile creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      const profileMsg = getErrMsg(profileError);
      const roleConstraint = /staff_profiles_role_check|check constraint|invalid input value for/i.test(profileMsg);
      const hint = roleConstraint
        ? " The staff role constraint in your database may be outdated. Apply the latest staff role migration and retry."
        : "";
      return new Response(JSON.stringify({ error: profileMsg + hint }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Write audit log
    await supabaseAdmin.from("staff_audit_logs").insert({
      staff_id: authData.user.id,
      staff_name: name,
      action: "account_created",
      details: { email, role, created_by: userData.user.id },
    });

    return new Response(
      JSON.stringify({ success: true, userId: authData.user.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
