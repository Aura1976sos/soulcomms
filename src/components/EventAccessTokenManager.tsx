import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    createEventAccessToken,
    getEventAccessTokens,
    revokeEventAccessToken,
    generateShareableUrl,
    copyToClipboard,
    EventAccessToken,
} from '@/lib/eventAccessTokens';
import { Copy, Trash2, Plus, Clock, Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

interface EventAccessTokenManagerProps {
    eventId: string;
    eventName: string;
}

export function EventAccessTokenManager({ eventId, eventName }: EventAccessTokenManagerProps) {
    const [tokens, setTokens] = useState<EventAccessToken[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [open, setOpen] = useState(false);
    const { toast } = useToast();

    const loadTokens = async () => {
        setLoading(true);
        try {
            const data = await getEventAccessTokens(eventId);
            setTokens(data);
        } catch (error) {
            console.error('Failed to load tokens:', error);
            toast({
                title: 'Error',
                description: 'Failed to load access tokens',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) {
            loadTokens();
        }
    }, [open]);

    const handleCreateToken = async () => {
        setCreating(true);
        try {
            const result = await createEventAccessToken(
                eventId,
                24,
                `Token for ${eventName}`
            );

            if (result) {
                const shareUrl = generateShareableUrl(eventId, result.token);
                toast({
                    title: 'Success',
                    description: 'Access token created successfully',
                });

                // Copy URL to clipboard automatically
                await copyToClipboard(shareUrl);
                toast({
                    title: 'Copied',
                    description: 'Shareable link copied to clipboard',
                });

                await loadTokens();
            } else {
                toast({
                    title: 'Error',
                    description: 'Failed to create access token - database function may not be deployed yet',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Failed to create token:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to create access token',
                variant: 'destructive',
            });
        } finally {
            setCreating(false);
        }
    };

    const handleRevokeToken = async (token: string) => {
        try {
            const success = await revokeEventAccessToken(token);
            if (success) {
                toast({
                    title: 'Success',
                    description: 'Token revoked successfully',
                });
                await loadTokens();
            } else {
                toast({
                    title: 'Error',
                    description: 'Failed to revoke token',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Failed to revoke token:', error);
            toast({
                title: 'Error',
                description: 'Failed to revoke token',
                variant: 'destructive',
            });
        }
    };

    const handleCopyUrl = async (token: string) => {
        const url = generateShareableUrl(eventId, token);
        const success = await copyToClipboard(url);
        if (success) {
            toast({
                title: 'Copied',
                description: 'Shareable link copied to clipboard',
            });
        } else {
            toast({
                title: 'Error',
                description: 'Failed to copy link',
                variant: 'destructive',
            });
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <Plus className="w-4 h-4" />
                    Manage Access
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-96 overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Event Access Tokens</DialogTitle>
                    <DialogDescription>
                        Create and manage shareable links for {eventName}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <Button
                        onClick={handleCreateToken}
                        disabled={creating}
                        className="w-full gap-2"
                    >
                        <Plus className="w-4 h-4" />
                        {creating ? 'Creating...' : 'Create New Access Link'}
                    </Button>

                    {loading ? (
                        <p className="text-sm text-slate-400">Loading tokens...</p>
                    ) : tokens.length === 0 ? (
                        <p className="text-sm text-slate-400">No active access tokens</p>
                    ) : (
                        <div className="space-y-3">
                            {tokens.map((token) => (
                                <Card key={token.id} className="bg-slate-800 border-slate-700">
                                    <CardContent className="pt-4">
                                        <div className="space-y-3">
                                            {/* Token preview (first 8 + last 8 chars) */}
                                            <div className="flex items-center justify-between">
                                                <div className="font-mono text-sm text-slate-300">
                                                    {token.token.slice(0, 8)}...{token.token.slice(-8)}
                                                </div>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleCopyUrl(token.token)}
                                                    className="gap-2"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                    Copy Link
                                                </Button>
                                            </div>

                                            {/* Token stats */}
                                            <div className="grid grid-cols-3 gap-2 text-xs text-slate-400">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="w-3 h-3" />
                                                    Created{' '}
                                                    {formatDistanceToNow(new Date(token.created_at), {
                                                        addSuffix: true,
                                                    })}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Users className="w-3 h-3" />
                                                    {token.usage_count} uses
                                                </div>
                                                <div>
                                                    {token.last_used_at
                                                        ? `Last used ${formatDistanceToNow(new Date(token.last_used_at), { addSuffix: true })}`
                                                        : 'Not yet used'}
                                                </div>
                                            </div>

                                            {/* Expires info */}
                                            <div className="text-xs text-slate-400">
                                                Expires{' '}
                                                {formatDistanceToNow(new Date(token.expires_at), {
                                                    addSuffix: true,
                                                })}
                                            </div>

                                            {/* Revoke button */}
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRevokeToken(token.token)}
                                                className="w-full gap-2 text-red-400 hover:text-red-300 hover:bg-red-950"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Revoke
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
