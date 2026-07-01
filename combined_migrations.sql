-- Create event_access_tokens table for shareable event links
CREATE TABLE IF NOT EXISTS event_access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    token VARCHAR(32) NOT NULL UNIQUE, -- Random secure token
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    usage_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_ip VARCHAR(45), -- IPv4 or IPv6
    description TEXT
);

-- Indexes for fast lookups
CREATE INDEX idx_event_access_tokens_event_id ON event_access_tokens(event_id);
CREATE INDEX idx_event_access_tokens_token ON event_access_tokens(token);
CREATE INDEX idx_event_access_tokens_expires_at ON event_access_tokens(expires_at);

-- Enable RLS
ALTER TABLE event_access_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Admins can view tokens for their events
CREATE POLICY "Admins can view event access tokens"
    ON event_access_tokens
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM staff_profiles
            WHERE staff_profiles.user_id = auth.uid()
            AND staff_profiles.event_id = event_access_tokens.event_id
            AND staff_profiles.role IN ('admin', 'superadmin')
        )
    );

-- Admins can create tokens for their events
CREATE POLICY "Admins can create event access tokens"
    ON event_access_tokens
    FOR INSERT
    WITH CHECK (
        created_by = auth.uid()
        AND EXISTS (
            SELECT 1 FROM staff_profiles
            WHERE staff_profiles.user_id = auth.uid()
            AND staff_profiles.event_id = event_access_tokens.event_id
            AND staff_profiles.role IN ('admin', 'superadmin')
        )
    );

-- Admins can revoke tokens
CREATE POLICY "Admins can revoke event access tokens"
    ON event_access_tokens
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM staff_profiles
            WHERE staff_profiles.user_id = auth.uid()
            AND staff_profiles.event_id = event_access_tokens.event_id
            AND staff_profiles.role IN ('admin', 'superadmin')
        )
    );

-- Public function to validate token and return event info
CREATE OR REPLACE FUNCTION validate_event_access_token(p_token VARCHAR(32))
RETURNS TABLE (
    event_id UUID,
    event_name VARCHAR,
    is_valid BOOLEAN,
    error_message VARCHAR
) AS $$
DECLARE
    v_token_record RECORD;
BEGIN
    SELECT * INTO v_token_record
    FROM event_access_tokens
    WHERE token = p_token
    LIMIT 1;

    IF v_token_record IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::VARCHAR, FALSE, 'Token not found'::VARCHAR;
        RETURN;
    END IF;

    IF v_token_record.revoked_at IS NOT NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::VARCHAR, FALSE, 'Token has been revoked'::VARCHAR;
        RETURN;
    END IF;

    IF NOT v_token_record.is_active THEN
        RETURN QUERY SELECT NULL::UUID, NULL::VARCHAR, FALSE, 'Token is inactive'::VARCHAR;
        RETURN;
    END IF;

    IF NOW() > v_token_record.expires_at THEN
        RETURN QUERY SELECT NULL::UUID, NULL::VARCHAR, FALSE, 'Token has expired'::VARCHAR;
        RETURN;
    END IF;

    -- Token is valid, update usage stats
    UPDATE event_access_tokens
    SET 
        last_used_at = NOW(),
        usage_count = usage_count + 1
    WHERE id = v_token_record.id;

    -- Return event info
    RETURN QUERY
    SELECT 
        v_token_record.event_id,
        e.name::VARCHAR,
        TRUE,
        NULL::VARCHAR
    FROM events e
    WHERE e.id = v_token_record.event_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate a random token
CREATE OR REPLACE FUNCTION generate_event_access_token()
RETURNS VARCHAR AS $$
BEGIN
    RETURN substring(encode(gen_random_bytes(24), 'hex'), 1, 32);
END;
$$ LANGUAGE plpgsql;

-- Function to create a new access token for an event
CREATE OR REPLACE FUNCTION create_event_access_token(
    p_event_id UUID,
    p_duration_hours INT DEFAULT 24,
    p_description TEXT DEFAULT NULL
)
RETURNS TABLE (
    token VARCHAR,
    expires_at TIMESTAMP WITH TIME ZONE,
    join_url VARCHAR
) AS $$
DECLARE
    v_token VARCHAR;
    v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
    -- Verify user is admin for this event
    IF NOT EXISTS (
        SELECT 1 FROM staff_profiles
        WHERE user_id = auth.uid()
        AND event_id = p_event_id
        AND role IN ('admin', 'superadmin')
    ) THEN
        RAISE EXCEPTION 'Not authorized to create tokens for this event';
    END IF;

    v_token := generate_event_access_token();
    v_expires_at := NOW() + (p_duration_hours || ' hours')::INTERVAL;

    INSERT INTO event_access_tokens (
        event_id,
        token,
        created_by,
        expires_at,
        description
    ) VALUES (
        p_event_id,
        v_token,
        auth.uid(),
        v_expires_at,
        p_description
    );

    RETURN QUERY SELECT 
        v_token::VARCHAR,
        v_expires_at,
        ('/event/' || p_event_id::TEXT || '/join/' || v_token)::VARCHAR;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to revoke a token
CREATE OR REPLACE FUNCTION revoke_event_access_token(p_token VARCHAR(32))
RETURNS TABLE (
    success BOOLEAN,
    message VARCHAR
) AS $$
DECLARE
    v_token_record RECORD;
BEGIN
    SELECT * INTO v_token_record
    FROM event_access_tokens
    WHERE token = p_token;

    IF v_token_record IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Token not found'::VARCHAR;
        RETURN;
    END IF;

    -- Verify user is admin for this event
    IF NOT EXISTS (
        SELECT 1 FROM staff_profiles
        WHERE user_id = auth.uid()
        AND event_id = v_token_record.event_id
        AND role IN ('admin', 'superadmin')
    ) THEN
        RETURN QUERY SELECT FALSE, 'Not authorized'::VARCHAR;
        RETURN;
    END IF;

    UPDATE event_access_tokens
    SET 
        revoked_at = NOW(),
        revoked_by = auth.uid(),
        is_active = FALSE
    WHERE token = p_token;

    RETURN QUERY SELECT TRUE, 'Token revoked successfully'::VARCHAR;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for active tokens per event
CREATE OR REPLACE VIEW v_active_event_access_tokens AS
SELECT 
    id,
    event_id,
    token,
    created_at,
    expires_at,
    last_used_at,
    usage_count,
    is_active,
    (NOW() < expires_at AND is_active AND revoked_at IS NULL) AS is_currently_valid,
    description
FROM event_access_tokens
WHERE is_active = TRUE AND revoked_at IS NULL;


-- ===== GUEST ACCESS RLS POLICIES =====
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

