import { supabase } from '@/integrations/supabase/client';

export interface EventAccessToken {
    id: string;
    event_id: string;
    token: string;
    created_at: string;
    expires_at: string;
    last_used_at: string | null;
    usage_count: number;
    is_active: boolean;
    revoked_at: string | null;
    description?: string;
}

export interface TokenValidationResult {
    event_id: string | null;
    event_name: string | null;
    is_valid: boolean;
    error_message: string | null;
}

/**
 * Validate an event access token
 */
export async function validateEventAccessToken(token: string): Promise<TokenValidationResult> {
    try {
        const { data, error } = await supabase.rpc('validate_event_access_token', {
            p_token: token,
        });

        if (error) {
            console.error('Token validation error:', error);
            return {
                event_id: null,
                event_name: null,
                is_valid: false,
                error_message: error.message,
            };
        }

        if (data && data.length > 0) {
            return data[0];
        }

        return {
            event_id: null,
            event_name: null,
            is_valid: false,
            error_message: 'Invalid token',
        };
    } catch (error) {
        console.error('Token validation exception:', error);
        return {
            event_id: null,
            event_name: null,
            is_valid: false,
            error_message: 'Failed to validate token',
        };
    }
}

/**
 * Create a new event access token (admin only)
 */
export async function createEventAccessToken(
    eventId: string,
    durationHours: number = 24,
    description?: string
): Promise<{ token: string; expires_at: string; join_url: string } | null> {
    try {
        const { data, error } = await supabase.rpc('create_event_access_token', {
            p_event_id: eventId,
            p_duration_hours: durationHours,
            p_description: description,
        });

        if (error) {
            console.error('Failed to create token:', error);
            return null;
        }

        if (data && data.length > 0) {
            return data[0];
        }

        return null;
    } catch (error) {
        console.error('Token creation exception:', error);
        return null;
    }
}

/**
 * Revoke an event access token (admin only)
 */
export async function revokeEventAccessToken(token: string): Promise<boolean> {
    try {
        const { data, error } = await supabase.rpc('revoke_event_access_token', {
            p_token: token,
        });

        if (error) {
            console.error('Failed to revoke token:', error);
            return false;
        }

        if (data && data.length > 0) {
            return data[0].success;
        }

        return false;
    } catch (error) {
        console.error('Token revocation exception:', error);
        return false;
    }
}

/**
 * Get all active access tokens for an event (admin only)
 */
export async function getEventAccessTokens(eventId: string): Promise<EventAccessToken[]> {
    try {
        const { data, error } = await supabase
            .from('v_active_event_access_tokens')
            .select('*')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Failed to fetch tokens:', error);
            return [];
        }

        return data || [];
    } catch (error) {
        console.error('Exception fetching tokens:', error);
        return [];
    }
}

/**
 * Generate the full shareable URL for an event
 */
export function generateShareableUrl(eventId: string, token: string): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/event/${eventId}/join/${token}`;
}

/**
 * Copy shareable URL to clipboard
 */
export async function copyToClipboard(url: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(url);
        return true;
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        return false;
    }
}
