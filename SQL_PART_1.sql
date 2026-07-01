-- PART 1: TABLE & INDEXES
CREATE TABLE IF NOT EXISTS event_access_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    token VARCHAR(32) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    usage_count INT DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_ip VARCHAR(45),
    description TEXT
);

CREATE INDEX idx_event_access_tokens_event_id ON event_access_tokens(event_id);
CREATE INDEX idx_event_access_tokens_token ON event_access_tokens(token);
CREATE INDEX idx_event_access_tokens_expires_at ON event_access_tokens(expires_at);

ALTER TABLE event_access_tokens ENABLE ROW LEVEL SECURITY;
