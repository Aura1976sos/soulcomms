import { supabase } from '@/integrations/supabase/client';

export interface GuestAccessSlug {
    id: string;
    event_id: string;
    slug: string;
    created_at: string;
    created_by: string;
    is_active: boolean;
}

/**
 * Generate a URL-friendly slug from event name and code
 */
export function generateSlug(eventName: string, eventCode?: string): string {
    let base = eventName;
    if (eventCode) {
        base = `${eventName}-${eventCode}`;
    }

    return base
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/[^\w\-]/g, '')        // Remove special characters
        .replace(/\-+/g, '-')           // Replace multiple hyphens with single
        .replace(/^\-+|\-+$/g, '');     // Remove leading/trailing hyphens
}

/**
 * Create a guest access slug for an event
 */
export async function createGuestAccessSlug(
    eventId: string,
    eventName: string,
    eventCode?: string
): Promise<{ slug: string; url: string } | null> {
    try {
        const slug = generateSlug(eventName, eventCode);

        // Try to create in database first (when migrations are applied)
        const { data, error } = await supabase
            .from('guest_access_slugs')
            .insert({
                event_id: eventId,
                slug: slug,
                is_active: true,
            })
            .select('slug')
            .single();

        if (!error && data) {
            return {
                slug: data.slug,
                url: `/event/${data.slug}`,
            };
        }

        // Fallback: Use slug without database persistence
        console.warn('Database slug storage not available, using fallback');
        return {
            slug,
            url: `/event/${slug}`,
        };
    } catch (error) {
        console.error('Error creating guest access slug:', error);
        // Still return a valid slug
        const slug = generateSlug(eventName, eventCode);
        return {
            slug,
            url: `/event/${slug}`,
        };
    }
}

/**
 * Validate guest access slug and get event details
 */
export async function validateGuestSlug(
    slug: string
): Promise<{ event_id: string; event_name: string; is_valid: boolean } | null> {
    try {
        // Try database first
        const { data, error } = await supabase
            .from('guest_access_slugs')
            .select('event_id, is_active')
            .eq('slug', slug)
            .eq('is_active', true)
            .single();

        if (!error && data) {
            // Get event details
            const { data: event } = await supabase
                .from('events')
                .select('id, name')
                .eq('id', data.event_id)
                .single();

            if (event) {
                return {
                    event_id: event.id,
                    event_name: event.name,
                    is_valid: true,
                };
            }
        }
    } catch (error) {
        console.warn('Database slug lookup failed, checking local events');
    }

    // Fallback: Check if slug matches any event (by matching generated slugs)
    try {
        const { data: events } = await supabase
            .from('events')
            .select('id, name, code')
            .limit(100);

        if (events) {
            for (const event of events) {
                const generatedSlug = generateSlug(event.name, event.code);
                if (generatedSlug === slug) {
                    return {
                        event_id: event.id,
                        event_name: event.name,
                        is_valid: true,
                    };
                }
            }
        }
    } catch (error) {
        console.error('Error validating slug:', error);
    }

    return null;
}

/**
 * Generate the full shareable URL for guest access
 */
export function generateGuestShareUrl(slug: string): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/event/${slug}`;
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
