import { useEffect, useRef, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { safeToast } from '@/lib/safeToast';

interface SeriesGeneratorProps {
  sourceDocumentId: string | null;
  sourceDocumentTitle: string | null;
}

export const SeriesGenerator = ({ sourceDocumentId, sourceDocumentTitle }: SeriesGeneratorProps) => {
  const [email, setEmail] = useState(() => {
    try {
      return sessionStorage.getItem('batchSeriesTargetEmail') || '';
    } catch {
      return '';
    }
  });
  const [startPage, setStartPage] = useState('');
  const [endPage, setEndPage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleAssign = async () => {
    const trimmedEmail = email.trim();
    const start = Number(startPage);
    const end = Number(endPage);

    if (!sourceDocumentId || !sourceDocumentId.trim()) return;

    if (!trimmedEmail) {
      safeToast('Email is required');
      return;
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end <= 0 || end < start) {
      safeToast('Invalid page range');
      return;
    }

    try {
      if (isMountedRef.current) setIsSubmitting(true);
      const res = await api.post('/api/admin/assign-batch-range', {
        email: trimmedEmail,
        documentId: sourceDocumentId,
        startPage: start,
        endPage: end,
      });

      if (!res.data || res.data.success !== true) {
        const msg = typeof (res.data as any)?.message === 'string' ? (res.data as any).message : 'Batch assignment failed';
        throw new Error(msg);
      }

      if (isMountedRef.current) toast.success('Batch assigned');
    } catch (e) {
      const backendMsg = (e as any)?.response?.data?.message;
      if (isMountedRef.current) {
        safeToast(
          typeof backendMsg === 'string' && backendMsg.trim().length > 0
            ? backendMsg
            : e instanceof Error
              ? e.message
              : 'Batch assignment failed'
        );
      }
    } finally {
      if (isMountedRef.current) setIsSubmitting(false);
    }
  };

  const hasSourcePdf = typeof sourceDocumentId === 'string' && sourceDocumentId.trim().length > 0;

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          Batch Series Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          {hasSourcePdf ? (
            <div className="text-sm text-muted-foreground">
              Selected PDF: {sourceDocumentTitle || 'Uploaded PDF'}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Upload a PDF first</div>
          )}

          <Input
            placeholder="User Email"
            value={email}
            onChange={(e) => {
              const next = e.target.value;
              setEmail(next);
              try {
                sessionStorage.setItem('batchSeriesTargetEmail', next);
              } catch {
                // ignore
              }
            }}
            inputMode="email"
            type="email"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="Start Number"
              value={startPage}
              onChange={(e) => setStartPage(e.target.value)}
              inputMode="numeric"
            />
            <Input
              placeholder="End Number"
              value={endPage}
              onChange={(e) => setEndPage(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <Button
            onClick={handleAssign}
            disabled={isSubmitting || !hasSourcePdf}
            className="w-full"
          >
            {isSubmitting ? 'Assigning...' : 'Assign Batch'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
