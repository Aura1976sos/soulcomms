import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    createGuestAccessSlug,
    generateGuestShareUrl,
    copyToClipboard,
} from '@/lib/guestAccess';
import { Copy, Plus, Link } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface EventAccessTokenManagerProps {
    eventId: string;
    eventName: string;
    eventCode?: string;
}

export function EventAccessTokenManager({
    eventId,
    eventName,
    eventCode
}: EventAccessTokenManagerProps) {
    const [slug, setSlug] = useState<string | null>(null);
    const [shareUrl, setShareUrl] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const { toast } = useToast();

    const handleCreateSlug = async () => {
        setLoading(true);
        try {
            const result = await createGuestAccessSlug(eventId, eventName, eventCode);

            if (result) {
                setSlug(result.slug);
                const url = generateGuestShareUrl(result.slug);
                setShareUrl(url);

                toast({
                    title: 'Success',
                    description: 'Guest access link created!',
                });

                // Copy URL to clipboard automatically
                await copyToClipboard(url);
                toast({
                    title: 'Copied',
                    description: 'Shareable link copied to clipboard',
                });
            } else {
                throw new Error('Failed to create access link');
            }
        } catch (error) {
            console.error('Error creating access link:', error);
            toast({
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to create guest access link',
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleCopyUrl = async () => {
        if (shareUrl) {
            const success = await copyToClipboard(shareUrl);
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
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2">
                    <Link className="w-4 h-4" />
                    Guest Access
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Guest Access Link</DialogTitle>
                    <DialogDescription>
                        Create a shareable link for guests to access {eventName}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {!slug ? (
                        <Button
                            onClick={handleCreateSlug}
                            disabled={loading}
                            className="w-full gap-2"
                        >
                            <Plus className="w-4 h-4" />
                            {loading ? 'Creating...' : 'Generate Guest Access Link'}
                        </Button>
                    ) : (
                        <div className="space-y-4 bg-slate-50 p-4 rounded-lg">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-slate-600">
                                    Shareable Link
                                </label>
                                <div className="flex items-center gap-2 bg-white p-3 rounded border border-slate-200">
                                    <code className="flex-1 text-sm font-mono text-slate-800 break-all">
                                        {shareUrl}
                                    </code>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleCopyUrl}
                                        className="gap-2"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm text-blue-900">
                                <strong>Share this link with guests:</strong> They can visit the link above and check in without creating an account.
                            </div>

                            <Button
                                onClick={handleCreateSlug}
                                variant="secondary"
                                disabled={loading}
                                className="w-full"
                            >
                                Generate New Link
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
