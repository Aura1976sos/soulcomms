import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';

export interface GuestSession {
    eventId: string;
    eventName: string;
    accessToken: string;
    accessedAt: Date;
    expiresAt: Date;
    isValid: boolean;
}

interface GuestContextType {
    guestSession: GuestSession | null;
    setGuestSession: (session: GuestSession | null) => void;
    isGuestMode: boolean;
    clearGuestSession: () => void;
}

const GuestContext = createContext<GuestContextType | undefined>(undefined);

export function GuestProvider({ children }: { children: React.ReactNode }) {
    const [guestSession, setGuestSession] = useState<GuestSession | null>(null);
    const { user, loading: authLoading } = useAuth();

    // Load guest session from localStorage on mount
    useEffect(() => {
        // Only load guest session if user is not authenticated
        // If user is authenticated, guest mode should be disabled
        if (authLoading) return; // Wait for auth to load

        if (user) {
            // User is authenticated - clear guest session
            localStorage.removeItem('guest_session');
            setGuestSession(null);
            return;
        }

        // User is not authenticated - load guest session if available
        const stored = localStorage.getItem('guest_session');
        if (stored) {
            try {
                const session = JSON.parse(stored);
                // Check if session is still valid
                if (new Date(session.expiresAt) > new Date()) {
                    setGuestSession(session);
                } else {
                    localStorage.removeItem('guest_session');
                }
            } catch (error) {
                console.error('Failed to parse guest session:', error);
                localStorage.removeItem('guest_session');
            }
        }
    }, [user, authLoading]);

    // Persist guest session to localStorage
    const handleSetGuestSession = (session: GuestSession | null) => {
        if (session) {
            localStorage.setItem('guest_session', JSON.stringify(session));
            setGuestSession(session);
        } else {
            localStorage.removeItem('guest_session');
            setGuestSession(null);
        }
    };

    const clearGuestSession = () => {
        localStorage.removeItem('guest_session');
        setGuestSession(null);
    };

    return (
        <GuestContext.Provider
            value={{
                guestSession,
                setGuestSession: handleSetGuestSession,
                isGuestMode: guestSession !== null && !user,
                clearGuestSession,
            }}
        >
            {children}
        </GuestContext.Provider>
    );
}

export function useGuest() {
    const context = useContext(GuestContext);
    if (context === undefined) {
        throw new Error('useGuest must be used within GuestProvider');
    }
    return context;
}
