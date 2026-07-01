import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  return auth.replace(/^Bearer\s+/i, "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  try {
    // ── Verify caller is admin via JWT ──────────────────────────────────────
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
    const callerId = userData.user.id;

    // Fetch caller profile using admin client (bypasses RLS, uses exact ID)
    const { data: callerProfile, error: profileErr } = await supabaseAdmin
      .from("staff_profiles")
      .select("id, name, role")
      .eq("id", callerId)
      .maybeSingle();

    if (profileErr || !callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { action, userId, ...payload } = body;

    console.log(`manage-staff: action=${action} caller=${callerProfile.name}`);

    // ── list_staff ────────────────────────────────────────────────────────────
    if (action === "list_staff") {
      const { data: authList, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      if (listErr) throw new Error("Failed to list users: " + listErr.message);

      const { data: profiles } = await supabaseAdmin
        .from("staff_profiles")
        .select("id, name, role, phone, status, assigned_event_id, last_seen_at, created_at");

      const profileMap: Record<string, Record<string, unknown>> = {};
      (profiles ?? []).forEach((p: Record<string, unknown>) => {
        profileMap[p.id as string] = p;
      });

      const merged = (authList?.users ?? []).map(u => ({
        id: u.id,
        email: u.email,
        last_sign_in_at: u.last_sign_in_at,
        created_at: u.created_at,
        banned_until: u.banned_until,
        ...(profileMap[u.id] ?? {}),
      }));

      return new Response(JSON.stringify({ users: merged }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── update_profile ────────────────────────────────────────────────────────
    if (action === "update_profile") {
      const { name, phone, role, status, assigned_event_id, email } = payload;

      if (email) {
        const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { email });
        if (emailErr) throw new Error("Email update failed: " + emailErr.message);
      }

      const updates: Record<string, unknown> = {};
      if (name !== undefined)              updates.name = name;
      if (phone !== undefined)             updates.phone = phone || null;
      if (role !== undefined)              updates.role = role;
      if (status !== undefined)            updates.status = status;
      if (assigned_event_id !== undefined) updates.assigned_event_id = assigned_event_id || null;

      const { error: upErr } = await supabaseAdmin.from("staff_profiles").update(updates).eq("id", userId);
      if (upErr) throw new Error(upErr.message);

      await supabaseAdmin.from("staff_audit_logs").insert({
        staff_id: callerProfile.id,
        staff_name: callerProfile.name,
        action: "account_changed",
        details: { target_user_id: userId, changes: updates },
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── disable ───────────────────────────────────────────────────────────────
    if (action === "disable") {
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "876600h" });
      await supabaseAdmin.from("staff_profiles").update({ status: "disabled" }).eq("id", userId);
      await supabaseAdmin.from("staff_audit_logs").insert({
        staff_id: callerProfile.id, staff_name: callerProfile.name,
        action: "account_disabled", details: { target_user_id: userId },
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── enable ────────────────────────────────────────────────────────────────
    if (action === "enable") {
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "none" });
      await supabaseAdmin.from("staff_profiles").update({ status: "active" }).eq("id", userId);
      await supabaseAdmin.from("staff_audit_logs").insert({
        staff_id: callerProfile.id, staff_name: callerProfile.name,
        action: "account_enabled", details: { target_user_id: userId },
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── suspend ───────────────────────────────────────────────────────────────
    if (action === "suspend") {
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "876600h" });
      await supabaseAdmin.from("staff_profiles").update({ status: "suspended" }).eq("id", userId);
      await supabaseAdmin.from("staff_audit_logs").insert({
        staff_id: callerProfile.id, staff_name: callerProfile.name,
        action: "account_suspended", details: { target_user_id: userId },
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── force_logout ──────────────────────────────────────────────────────────
    if (action === "force_logout") {
      await supabaseAdmin.auth.admin.signOut(userId, "others");
      await supabaseAdmin.from("staff_audit_logs").insert({
        staff_id: callerProfile.id, staff_name: callerProfile.name,
        action: "force_logout", details: { target_user_id: userId },
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── logout_all ────────────────────────────────────────────────────────────
    // Force logout ALL users except the current admin
    if (action === "logout_all") {
      const { data: authList } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const others = (authList?.users ?? []).filter(u => u.id !== callerId);
      await Promise.allSettled(others.map(u => supabaseAdmin.auth.admin.signOut(u.id, "others")));
      await supabaseAdmin.from("staff_audit_logs").insert({
        staff_id: callerProfile.id, staff_name: callerProfile.name,
        action: "force_logout_all", details: { count: others.length },
      });
      return new Response(JSON.stringify({ success: true, count: others.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── delete ────────────────────────────────────────────────────────────────
    if (action === "delete") {
      await supabaseAdmin.from("staff_audit_logs").insert({
        staff_id: callerProfile.id, staff_name: callerProfile.name,
        action: "account_deleted", details: { target_user_id: userId, target_name: payload.name },
      });
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (delErr) throw new Error(delErr.message);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("manage-staff error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
