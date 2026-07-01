-- Update RLS policies to allow guest access for operational features
-- Guests can perform check-ins and activity logging via the app

-- Helper function to check if request is from valid guest access token
-- This will be called by RLS policies to allow guest operations
CREATE OR REPLACE FUNCTION is_valid_guest_access(p_event_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- For now, we allow guest access via app-level validation
  -- The app validates the token and sets a custom claim or header
  -- This is a placeholder that can be enhanced with JWT claim verification
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Update check_ins RLS to allow inserts (check-in operations)
-- Guests can check in participants to activities
DROP POLICY IF EXISTS "Users can insert check_ins for their event" ON check_ins;

CREATE POLICY "Users and guests can insert check_ins"
ON check_ins
FOR INSERT
WITH CHECK (
  -- Authenticated admin users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = check_ins.event_id
    AND staff_profiles.role IN ('admin', 'checkin_officer')
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Update activity_logs RLS to allow inserts (activity recording)
DROP POLICY IF EXISTS "Users can insert activity logs" ON activity_logs;

CREATE POLICY "Users and guests can insert activity logs"
ON activity_logs
FOR INSERT
WITH CHECK (
  -- Authenticated admin users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = activity_logs.event_id
    AND staff_profiles.role IN ('admin', 'activity_coordinator')
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Allow guests to read participants for their event
DROP POLICY IF EXISTS "Users can view participants for their events" ON participants;

CREATE POLICY "Authenticated and guest users can view participants"
ON participants
FOR SELECT
USING (
  -- Authenticated users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = participants.event_id
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Allow guests to read activities for their event
DROP POLICY IF EXISTS "Anyone can view activities" ON activities;

CREATE POLICY "Authenticated and guest users can view activities"
ON activities
FOR SELECT
USING (
  -- Authenticated users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = activities.event_id
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Allow guests to read events
DROP POLICY IF EXISTS "Admins can view events" ON events;

CREATE POLICY "Authenticated and guest users can view events"
ON events
FOR SELECT
USING (
  -- Authenticated users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = events.id
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Allow guests to view activity logs (read-only)
-- This supports the analytics view for guests
CREATE POLICY IF NOT EXISTS "Authenticated and guest users can view activity logs"
ON activity_logs
FOR SELECT
USING (
  -- Authenticated users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = activity_logs.event_id
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Allow guests to view check-ins
-- This supports viewing check-in history
CREATE POLICY IF NOT EXISTS "Authenticated and guest users can view check-ins"
ON check_ins
FOR SELECT
USING (
  -- Authenticated users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = check_ins.event_id
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Allow authenticated users and guests to read messages for communications
CREATE POLICY IF NOT EXISTS "Authenticated and guest users can view comm messages"
ON comm_messages
FOR SELECT
USING (
  -- Authenticated users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = comm_messages.event_id
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);

-- Allow authenticated users and guests to insert messages for communications
CREATE POLICY IF NOT EXISTS "Authenticated and guest users can insert comm messages"
ON comm_messages
FOR INSERT
WITH CHECK (
  -- Authenticated users
  EXISTS (
    SELECT 1 FROM staff_profiles
    WHERE staff_profiles.user_id = auth.uid()
    AND staff_profiles.event_id = comm_messages.event_id
  )
  OR
  -- Guest users (validated at app level)
  auth.uid() IS NULL
);
