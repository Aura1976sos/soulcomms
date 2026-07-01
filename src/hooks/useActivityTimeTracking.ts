import { useState, useCallback } from 'react';
import {
    recordActivityCheckin,
    recordActivityCheckout,
    getParticipantActivitySummary,
    getActivityTimeStatistics,
    getParticipationRecords,
    getActiveParticipations,
    type ActivityParticipationTime,
    type ParticipantActivitySummary,
    type ActivityTimeStatistics,
} from '@/lib/activityTimeTracking';

interface UseActivityTimeTrackingOptions {
    eventId: string;
    participantId?: string;
    activityId?: string;
}

export function useActivityTimeTracking({
    eventId,
    participantId,
    activityId,
}: UseActivityTimeTrackingOptions) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Record a participant checking into an activity
    const checkin = useCallback(
        async (pId: string, aId: string) => {
            setLoading(true);
            setError(null);
            try {
                const result = await recordActivityCheckin(eventId, pId, aId);
                if (!result.success) {
                    setError(result.message);
                }
                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                setError(message);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        [eventId]
    );

    // Record a participant checking out from an activity
    const checkout = useCallback(
        async (participationId: string) => {
            setLoading(true);
            setError(null);
            try {
                const result = await recordActivityCheckout(participationId);
                if (!result.success) {
                    setError(result.message);
                }
                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                setError(message);
                throw err;
            } finally {
                setLoading(false);
            }
        },
        []
    );

    // Get summary of activities for a participant
    const getParticipantSummary = useCallback(
        async (pId?: string): Promise<ParticipantActivitySummary[]> => {
            setLoading(true);
            setError(null);
            try {
                const result = await getParticipantActivitySummary(eventId, pId || participantId!);
                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                setError(message);
                return [];
            } finally {
                setLoading(false);
            }
        },
        [eventId, participantId]
    );

    // Get time statistics for an activity
    const getActivityStats = useCallback(
        async (aId?: string): Promise<ActivityTimeStatistics | null> => {
            setLoading(true);
            setError(null);
            try {
                const result = await getActivityTimeStatistics(eventId, aId || activityId!);
                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                setError(message);
                return null;
            } finally {
                setLoading(false);
            }
        },
        [eventId, activityId]
    );

    // Get all participation records for the event
    const getRecords = useCallback(
        async (filters?: {
            participantId?: string;
            activityId?: string;
            fromDate?: Date;
            toDate?: Date;
        }): Promise<ActivityParticipationTime[]> => {
            setLoading(true);
            setError(null);
            try {
                const result = await getParticipationRecords(eventId, filters);
                return result;
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                setError(message);
                return [];
            } finally {
                setLoading(false);
            }
        },
        [eventId]
    );

    // Get currently active participations
    const getActive = useCallback(async (): Promise<ActivityParticipationTime[]> => {
        setLoading(true);
        setError(null);
        try {
            const result = await getActiveParticipations(eventId);
            return result;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(message);
            return [];
        } finally {
            setLoading(false);
        }
    }, [eventId]);

    return {
        loading,
        error,
        checkin,
        checkout,
        getParticipantSummary,
        getActivityStats,
        getRecords,
        getActive,
    };
}
