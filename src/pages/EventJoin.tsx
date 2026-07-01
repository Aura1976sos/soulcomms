import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { validateEventAccessToken } from '@/lib/eventAccessTokens';
import { useGuest } from '@/contexts/GuestContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, Loader } from 'lucide-react';

interface JoinParams {
    eventId?: string;
    token?: string;
}

export default function EventJoin() {
    const navigate = useNavigate();
    const { eventId, token } = useParams<JoinParams>();
    const { setGuestSession } = useGuest();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [message, setMessage] = useState('Validating your access...');
    const [eventName, setEventName] = useState('');

    useEffect(() => {
        async function validateAndJoin() {
            if (!eventId || !token) {
                setStatus('error');
                setMessage('Invalid access link');
                return;
            }

            try {
                const result = await validateEventAccessToken(token);

                if (!result.is_valid) {
                    setStatus('error');
                    setMessage(result.error_message || 'Invalid or expired access link');
                    return;
                }

                if (!result.event_id || !result.event_name) {
                    setStatus('error');
                    setMessage('Event not found');
                    return;
                }

                // Verify event ID matches
                if (result.event_id !== eventId) {
                    setStatus('error');
                    setMessage('Event ID mismatch');
                    return;
                }

                setEventName(result.event_name);

                // Create guest session
                const expiresAt = new Date();
                expiresAt.setHours(expiresAt.getHours() + 24);

                setGuestSession({
                    eventId,
                    eventName: result.event_name,
                    accessToken: token,
                    accessedAt: new Date(),
                    expiresAt,
                    isValid: true,
                });

                setStatus('success');
                setMessage('Access granted! Redirecting...');

                // Redirect to dashboard after 2 seconds
                setTimeout(() => {
                    navigate('/dashboard', { replace: true });
                }, 2000);
            } catch (error) {
                console.error('Join error:', error);
                setStatus('error');
                setMessage('Failed to validate access');
            }
        }

        validateAndJoin();
    }, [eventId, token, setGuestSession, navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
            <Card className="w-full max-w-md bg-slate-800 border-slate-700">
                <CardHeader>
                    <CardTitle className="text-center text-white">Event Access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {status === 'loading' && (
                        <div className="flex flex-col items-center space-y-4">
                            <Loader className="w-12 h-12 text-blue-500 animate-spin" />
                            <p className="text-center text-slate-300">{message}</p>
                        </div>
                    )}

                    {status === 'success' && (
                        <div className="flex flex-col items-center space-y-4">
                            <CheckCircle className="w-12 h-12 text-green-500" />
                            <div className="text-center">
                                <p className="font-semibold text-white">{eventName}</p>
                                <p className="text-sm text-slate-300 mt-2">{message}</p>
                            </div>
                        </div>
                    )}

                    {status === 'error' && (
                        <div className="flex flex-col items-center space-y-4">
                            <AlertCircle className="w-12 h-12 text-red-500" />
                            <div className="text-center">
                                <p className="font-semibold text-white">Access Denied</p>
                                <p className="text-sm text-slate-300 mt-2">{message}</p>
                            </div>
                            <Button
                                onClick={() => navigate('/login')}
                                className="w-full bg-blue-600 hover:bg-blue-700"
                            >
                                Try Login Instead
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
