import { supabase } from '@/integrations/supabase/client';

export interface ActivityParticipationTime {
    id: string;
    event_id: string;
    participant_id: string;
    activity_id: string;
    checkin_time: string;
    checkout_time: string | null;
    duration_minutes: number;
}

export interface ParticipantActivitySummary {
    activity_id: string;
    activity_name: string;
    total_visits: number;
    total_minutes: number;
    last_checkin: string;
    is_currently_active: boolean;
}

export interface ActivityTimeStatistics {
    total_participants: number;
    total_checkins: number;
    average_duration_minutes: number;
    min_duration_minutes: number;
    max_duration_minutes: number;
    total_time_hours: number;
}

/**
 * Record a participant checking into an activity
 * Automatically closes any previous activity checkout
 */
export async function recordActivityCheckin(
    eventId: string,
    participantId: string,
    activityId: string,
    checkinTime?: Date
) {
    try {
        const { data, error } = await supabase.rpc('handle_activity_checkin', {
            p_event_id: eventId,
            p_participant_id: participantId,
            p_activity_id: activityId,
            p_checkin_time: checkinTime?.toISOString() || new Date().toISOString(),
        });

        if (error) throw error;

        return {
            success: true,
            participationId: data?.[0]?.participation_id,
            previousActivityId: data?.[0]?.previous_activity_id,
            previousDurationMinutes: data?.[0]?.previous_duration_minutes,
            message: data?.[0]?.message,
        };
    } catch (err) {
        console.error('Error recording activity checkin:', err);
        return {
            success: false,
            participationId: null,
            previousActivityId: null,
            previousDurationMinutes: 0,
            message: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

/**
 * Manually checkout from an activity
 */
export async function recordActivityCheckout(
    participationId: string,
    checkoutTime?: Date
) {
    try {
        const { data, error } = await supabase.rpc('handle_activity_checkout', {
            p_participation_id: participationId,
            p_checkout_time: checkoutTime?.toISOString() || new Date().toISOString(),
        });

        if (error) throw error;

        return {
            success: data?.[0]?.success,
            durationMinutes: data?.[0]?.duration_minutes,
            message: data?.[0]?.message,
        };
    } catch (err) {
        console.error('Error recording activity checkout:', err);
        return {
            success: false,
            durationMinutes: 0,
            message: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

/**
 * Get a participant's activity summary for an event
 */
export async function getParticipantActivitySummary(
    eventId: string,
    participantId: string
): Promise<ParticipantActivitySummary[]> {
    try {
        const { data, error } = await supabase.rpc('get_participant_activity_summary', {
            p_event_id: eventId,
            p_participant_id: participantId,
        });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Error fetching participant activity summary:', err);
        return [];
    }
}

/**
 * Get time statistics for an activity
 */
export async function getActivityTimeStatistics(
    eventId: string,
    activityId: string
): Promise<ActivityTimeStatistics | null> {
    try {
        const { data, error } = await supabase.rpc('get_activity_time_statistics', {
            p_event_id: eventId,
            p_activity_id: activityId,
        });

        if (error) throw error;
        return data?.[0] || null;
    } catch (err) {
        console.error('Error fetching activity time statistics:', err);
        return null;
    }
}

/**
 * Get all participation records for an event
 */
export async function getParticipationRecords(
    eventId: string,
    filters?: {
        participantId?: string;
        activityId?: string;
        fromDate?: Date;
        toDate?: Date;
    }
): Promise<ActivityParticipationTime[]> {
    try {
        let query = supabase
            .from('activity_participation_time')
            .select('*')
            .eq('event_id', eventId);

        if (filters?.participantId) {
            query = query.eq('participant_id', filters.participantId);
        }
        if (filters?.activityId) {
            query = query.eq('activity_id', filters.activityId);
        }
        if (filters?.fromDate) {
            query = query.gte('checkin_time', filters.fromDate.toISOString());
        }
        if (filters?.toDate) {
            query = query.lte('checkin_time', filters.toDate.toISOString());
        }

        const { data, error } = await query.order('checkin_time', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Error fetching participation records:', err);
        return [];
    }
}

/**
 * Get current active activities for all participants in an event
 */
export async function getActiveParticipations(
    eventId: string
): Promise<ActivityParticipationTime[]> {
    try {
        const { data, error } = await supabase
            .from('activity_participation_time')
            .select('*')
            .eq('event_id', eventId)
            .is('checkout_time', null)
            .order('checkin_time', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Error fetching active participations:', err);
        return [];
    }
}

/**
 * Format duration in minutes to readable string
 */
export function formatDuration(minutes: number): string {
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;

    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
}
