import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { validateGuestSlug } from '@/lib/guestAccess';
import { useGuest } from '@/contexts/GuestContext';
import { Card } from '@/components/ui/card';
import { AlertCircle, CheckCircle, Loader } from 'lucide-react';

export default function EventSlugJoin() {
    const { slug } = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { setGuestSession } = useGuest();
    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        const validateAndJoin = async () => {
            if (!slug) {
                setStatus('error');
                setErrorMessage('Invalid link');
                return;
            }

            try {
                const result = await validateGuestSlug(slug);

                if (result && result.is_valid) {
                    // Create guest session
                    setGuestSession({
                        eventId: result.event_id,
                        eventName: result.event_name,
                        accessToken: slug,
                        accessedAt: new Date(),
                        expiresAt: new Date(Date.now() + 24 * 3600000),
                        isValid: true,
                    });

                    setStatus('success');

                    // Redirect after 2 seconds
                    setTimeout(() => {
                        navigate('/dashboard');
                    }, 2000);
                } else {
                    setStatus('error');
                    setErrorMessage('Invalid or expired access link');
                }
            } catch (error) {
                console.error('Error validating slug:', error);
                setStatus('error');
                setErrorMessage('Failed to validate access link');
            }
        };

        validateAndJoin();
    }, [slug, navigate, setGuestSession]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <div className="p-8 space-y-6 text-center">
                    {status === 'loading' && (
                        <>
                            <Loader className="w-12 h-12 mx-auto text-blue-500 animate-spin" />
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Validating Access</h1>
                                <p className="text-slate-600 mt-2">Please wait...</p>
                            </div>
                        </>
                    )}

                    {status === 'success' && (
                        <>
                            <CheckCircle className="w-12 h-12 mx-auto text-green-500" />
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Welcome!</h1>
                                <p className="text-slate-600 mt-2">Access granted. Redirecting...</p>
                            </div>
                        </>
                    )}

                    {status === 'error' && (
                        <>
                            <AlertCircle className="w-12 h-12 mx-auto text-red-500" />
                            <div>
                                <h1 className="text-2xl font-bold text-slate-900">Access Denied</h1>
                                <p className="text-slate-600 mt-2">{errorMessage}</p>
                                <p className="text-sm text-slate-500 mt-4">
                                    Please check your access link and try again.
                                </p>
                            </div>
                        </>
                    )}
                </div>
            </Card>
        </div>
    );
}
