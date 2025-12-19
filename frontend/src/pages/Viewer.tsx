import { useState, useEffect, useCallback } from 'react';

import { useLocation, Navigate, Link, useNavigate } from 'react-router-dom';

import { Shield, ArrowLeft, AlertCircle, Printer } from 'lucide-react';
import { TicketEditor } from '@/components/editor/TicketEditor';
import { PDFCanvasViewer } from '@/components/editor/PDFCanvasViewer';

import { Button } from '@/components/ui/button';

import { safeToast } from '@/lib/safeToast';
import { useAuth } from '@/hooks/useAuth';
import { BACKEND_URL } from '@/lib/backendUrl';

const Viewer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionToken, documentTitle, remainingPrints: initialPrints, maxPrints, documentType = 'pdf', documentId } = location.state || {};
  const { token, user } = useAuth();

  const isDesktopApp = typeof window !== 'undefined' && !!(window as any).securePrintHub;

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [resolvedDocType, setResolvedDocType] = useState<'pdf' | 'svg'>(() => (documentType === 'svg' ? 'svg' : 'pdf'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remainingPrints, setRemainingPrints] = useState(initialPrints || 0);
  const [isPrinting, setIsPrinting] = useState(false);

  // Web app must never render PDFs. Printing for USER happens via /printing (Electron controller).
  useEffect(() => {
    if (!isDesktopApp && user?.role !== 'ADMIN') {
      navigate('/login', { replace: true });
    }
  }, [isDesktopApp, navigate, user?.role]);

  if (!isDesktopApp && user?.role !== 'ADMIN') {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Redirecting…</p>
      </div>
    );
  }

  if (user?.role === 'USER') {
    return <Navigate to="/printing" replace />;
  }

  // Redirect if no session token provided
  if (!sessionToken) {
    return <Navigate to={user?.role === 'ADMIN' ? '/upload' : '/printing'} replace />;
  }

  // Fetch PDF through backend secure-render endpoint (Electron only)
  useEffect(() => {
    const fetchSecurePDF = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!BACKEND_URL || !String(BACKEND_URL).trim()) {
          throw new Error('Backend URL not configured');
        }

        const res = await fetch(`${BACKEND_URL}/api/docs/secure-render`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ sessionToken }),
        });

        if (!res.ok) {
          let message = 'Failed to load document';
          try {
            const data = await res.json();
            if (data && data.message) message = data.message;
          } catch {
            // ignore JSON parse errors for non-JSON responses
          }
          throw new Error(message);
        }

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        const isSvg = contentType.includes('image/svg+xml');
        setResolvedDocType(isSvg ? 'svg' : 'pdf');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPdfUrl(url);

      } catch (err) {
        console.error('Error fetching PDF:', err);
        setError(err instanceof Error ? err.message : 'Failed to load document');
      } finally {
        setLoading(false);
      }
    };

    fetchSecurePDF();

    // Cleanup blob URL on unmount
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [sessionToken, token]);

  // Block default browser shortcuts for save / print so user sirf hamara flow use kare
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;

      const key = e.key.toLowerCase();
      if (key === 's' || key === 'p') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (user?.role !== 'USER') return;
    if (!isDesktopApp) return;
    try {
      if (typeof token === 'string' && token.trim()) {
        (window as any).securePrintHub?.setJwt?.(token.trim());
      }
    } catch {
      // ignore
    }
  }, [isDesktopApp, token, user?.role]);

  const handlePrintClick = () => {
    void handleConfirmPrint();
  };

  const handleConfirmPrint = useCallback(async () => {
    if (remainingPrints <= 0) {
      safeToast('Print limit exceeded');
      return;
    }

    setIsPrinting(true);

    try {
      if (!isDesktopApp) {
        safeToast('Secure printing requires the desktop app');
        return;
      }

      const res = await (window as any).securePrintHub?.requestPrint?.({ sessionToken });
      if (!res || res.success !== true) {
        const msg = typeof res?.error === 'string' ? res.error : 'Print request failed';
        throw new Error(msg);
      }

      setRemainingPrints((prev) => (prev > 0 ? prev - 1 : 0));
    } catch (err) {
      console.error('Print error:', err);
      safeToast(err instanceof Error ? err.message : 'Print failed');
    } finally {
      setIsPrinting(false);
    }
  }, [isDesktopApp, remainingPrints, sessionToken]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center animate-fade-in">
          <div className="mb-4 h-12 w-12 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-muted-foreground">Loading secure document...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center animate-fade-in max-w-md">
          <div className="mb-4 h-12 w-12 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-destructive mb-4">{error}</p>
          <Link 
            to="/upload" 
            className="text-primary hover:underline"
          >
            Return to Upload
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen flex flex-col bg-background overflow-hidden"
      // Disable right-click so user context menu se save / print na kare
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Compact Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50 flex-shrink-0">
        <Link 
          to="/upload" 
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </Link>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-xs text-muted-foreground truncate max-w-[220px]">
              {documentTitle}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-primary">
              <Shield className="h-4 w-4" />
              <span className="text-xs font-medium">Protected</span>
            </div>
            {user?.role === 'ADMIN' ? (
              <Button
                size="sm"
                variant="default"
                className="gap-2"
                disabled={remainingPrints <= 0}
                onClick={handlePrintClick}
              >
                <Printer className="h-4 w-4" />
                {remainingPrints > 0 ? 'Print' : 'No Prints Left'}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="default"
                className="gap-2"
                disabled={!isDesktopApp}
                onClick={() => {
                  if (!isDesktopApp) {
                    safeToast('Secure printing requires the desktop app');
                    return;
                  }
                  (window as any).securePrintHub?.requestPrint?.({ sessionToken });
                }}
              >
                <Printer className="h-4 w-4" />
                Request Print
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main content: editor only for admin, pure viewer for regular users */}
      <div className="flex-1 overflow-hidden flex flex-row">
        <div className="flex-1 overflow-hidden">
          {user?.role === 'ADMIN' ? (
            <TicketEditor pdfUrl={pdfUrl} fileType={resolvedDocType} documentId={documentId} />
          ) : (
            <div className="h-full w-full bg-muted/10 flex items-center justify-center overflow-auto">
              <div className="w-full h-full max-w-6xl space-y-4 p-6">
                {!isDesktopApp ? (
                  <div className="rounded-lg border border-border p-4 bg-muted/20 text-sm text-muted-foreground">
                    Secure printing requires the desktop app.
                  </div>
                ) : null}

                <PDFCanvasViewer
                  pdfUrl={pdfUrl}
                  fileType={resolvedDocType}
                  onPdfRendered={() => {}}
                  onRegionDetected={() => {}}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Custom Print Dialog */}
      {user?.role === 'ADMIN' ? (
        <div className="hidden" />
      ) : null}
    </div>
  );
};

export default Viewer;