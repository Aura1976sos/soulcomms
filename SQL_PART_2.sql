-- PART 2: RLS POLICIES & FUNCTIONS
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

    UPDATE event_access_tokens
    SET 
        last_used_at = NOW(),
        usage_count = usage_count + 1
    WHERE id = v_token_record.id;

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

CREATE OR REPLACE FUNCTION generate_event_access_token()
RETURNS VARCHAR AS $$
BEGIN
    RETURN substring(encode(gen_random_bytes(24), 'hex'), 1, 32);
END;
$$ LANGUAGE plpgsql;

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
