import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SecurePrintDialog } from '@/components/SecurePrintDialog';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api';
import { resolveBackendUrl } from '@/lib/backendUrl';
import { toast } from 'sonner';
import { safeToast } from '@/lib/safeToast';
import { useNavigate } from 'react-router-dom';

const BACKEND_URL = resolveBackendUrl();

interface AssignedDoc {
  id: string;
  documentId: string | null;
  documentTitle: string;
  sessionToken: string | null;
  assignedPrints?: number;
  usedPrints?: number;
  remainingPrints?: number;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
  stage?: 'pending' | 'rendering' | 'merging' | 'completed' | 'failed';
  totalPages?: number;
  completedPages?: number;
}
const normalizeAssignedDoc = (raw: any): AssignedDoc => {
  const status = raw?.status as AssignedDoc['status'] | undefined;
  const stage = (raw?.stage as AssignedDoc['stage'] | undefined) ?? (status === 'completed' ? 'completed' : undefined);

  const totalPagesRaw = raw?.totalPages ?? raw?.totalPage;
  const totalPages = typeof totalPagesRaw === 'number' ? totalPagesRaw : undefined;

  const completedPagesRaw = raw?.completedPages ?? raw?.completedPage;
  const completedPages = typeof completedPagesRaw === 'number' ? completedPagesRaw : undefined;

  return {
    id: raw?.id,
    documentId: raw?.documentId ?? null,
    documentTitle: raw?.documentTitle ?? 'Untitled Document',
    sessionToken: raw?.sessionToken ?? null,
    assignedPrints: typeof raw?.assignedPrints === 'number' ? raw.assignedPrints : (typeof raw?.assignedQuota === 'number' ? raw.assignedQuota : undefined),
    usedPrints: typeof raw?.usedPrints === 'number' ? raw.usedPrints : undefined,
    remainingPrints: typeof raw?.remainingPrints === 'number' ? raw.remainingPrints : undefined,
    status,
    stage,
    totalPages,
    completedPages,
  };
};

const Printing = () => {
  const navigate = useNavigate();
  const { token, user, signOut } = useAuth();

  const isDesktopApp = typeof window !== 'undefined' && !!(window as any).securePrintHub;

  const [connectivityState, setConnectivityState] = useState<string>('UNKNOWN');

  const [assignedDocs, setAssignedDocs] = useState<AssignedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [activePrintId, setActivePrintId] = useState<string | null>(null);
  const [isDownloadingAgent, setIsDownloadingAgent] = useState(false);

  const [showPrintDialog, setShowPrintDialog] = useState(false);
  const [dialogDoc, setDialogDoc] = useState<AssignedDoc | null>(null);
  const [printers, setPrinters] = useState<any[]>([]);
  const [isLoadingPrinters, setIsLoadingPrinters] = useState(false);

  const sortedDocs = useMemo(() => {
    return assignedDocs.slice().sort((a, b) => String(a.documentTitle).localeCompare(String(b.documentTitle)));
  }, [assignedDocs]);

  const refreshPrinters = useCallback(async () => {
    if (!isDesktopApp) return;
    try {
      setIsLoadingPrinters(true);
      const list = await (window as any).securePrintHub?.getPrintersDetailed?.();
      setPrinters(Array.isArray(list) ? list : []);
    } catch {
      setPrinters([]);
    } finally {
      setIsLoadingPrinters(false);
    }
  }, [isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) return;

    refreshPrinters();

    try {
      (window as any).securePrintHub?.getConnectivityState?.().then((res: any) => {
        const state = typeof res?.state === 'string' ? res.state : 'UNKNOWN';
        setConnectivityState(state);
      });
    } catch {
      setConnectivityState('UNKNOWN');
    }

    let cleanupConnectivity = () => {};
    try {
      cleanupConnectivity =
        (window as any).securePrintHub?.onConnectivityChanged?.((s: any) => {
          const state = typeof s?.state === 'string' ? s.state : 'UNKNOWN';
          setConnectivityState(state);
        }) || (() => {});
    } catch {
      cleanupConnectivity = () => {};
    }

    let cleanupPrinters = () => {};
    try {
      cleanupPrinters =
        (window as any).securePrintHub?.onPrintersChanged?.((list: any) => {
          setPrinters(Array.isArray(list) ? list : []);
        }) || (() => {});
    } catch {
      cleanupPrinters = () => {};
    }

    return () => {
      cleanupConnectivity();
      cleanupPrinters();
    };
  }, [isDesktopApp, refreshPrinters]);

  const hasOnlinePrinter = useMemo(() => {
    return Array.isArray(printers) && printers.some((p) => p && p.isOnline === true);
  }, [printers]);

  const hasAnyPrinters = useMemo(() => {
    return Array.isArray(printers) && printers.length > 0;
  }, [printers]);

  const isConnectivityOnline = String(connectivityState || '').toUpperCase() === 'ONLINE';
  const isPrintReady = isDesktopApp && hasOnlinePrinter && isConnectivityOnline;

  const printDisableReason = useMemo(() => {
    if (!isDesktopApp) return 'Secure printing requires the desktop app';
    if (!isConnectivityOnline) return 'Backend connection offline — check internet or server';
    if (!hasAnyPrinters) return 'No printers found — install/add a printer in Windows';
    if (!hasOnlinePrinter) return 'Printer offline — connect printer properly';
    return null;
  }, [hasAnyPrinters, hasOnlinePrinter, isConnectivityOnline, isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) return;

    const onMouseUp = (e: MouseEvent) => {
      // 3/4 are browser back/forward buttons on many mice
      if (e.button === 3) {
        e.preventDefault();
        navigate(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        navigate(1);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      }
    };

    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isDesktopApp, navigate]);

  useEffect(() => {
    if (!isDesktopApp) return;
    try {
      if (typeof token === 'string' && token.trim()) {
        (window as any).securePrintHub?.setJwt?.(token.trim());
      }
    } catch {
      // ignore
    }
  }, [isDesktopApp, token]);

  const loadAssigned = useCallback(async () => {
    if (authFailed) {
      return;
    }

    if (!isDesktopApp) {
      setAssignedDocs([]);
      setError('Secure printing is available only inside the SecurePrintHub Desktop App.');
      setLoading(false);
      return;
    }
    if (!token) {
      setError('Not authenticated');
      setLoading(false);
      return;
    }

    if (!BACKEND_URL || !String(BACKEND_URL).trim()) {
      setError('Backend URL not configured');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`${String(BACKEND_URL).replace(/\/$/, '')}/api/docs/assigned`, {
        headers: {
          'Content-Type': 'application/json',
          ...(typeof token === 'string' && token.trim().length > 0
            ? { Authorization: `Bearer ${token}` }
            : {}),
        },
      });

      const data = await res.json().catch(() => null);

      if (res.status === 401) {
        setAuthFailed(true);
        setAssignedDocs([]);
        setError('Session expired - please log in again');
        try {
          await signOut();
        } finally {
          navigate('/login', { replace: true });
        }
        return;
      }

      if (!res.ok) {
        const msg = typeof (data as any)?.message === 'string' ? (data as any).message : 'Failed to load documents';
        throw new Error(msg);
      }

      const list = Array.isArray(data) ? data.map(normalizeAssignedDoc) : [];
      setAssignedDocs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [authFailed, isDesktopApp, navigate, signOut, token]);

  useEffect(() => {
    if (authFailed) return;
    loadAssigned();
  }, [authFailed, loadAssigned]);

  const requestPrint = useCallback(async (doc: AssignedDoc) => {
    if (!isDesktopApp) {
      safeToast('Secure printing requires the desktop app');
      return;
    }
    if (!isPrintReady) {
      safeToast(printDisableReason || 'No connected printer detected');
      return;
    }
    if (!doc.sessionToken) {
      safeToast('Document not ready for printing');
      return;
    }
    setDialogDoc(doc);
    setShowPrintDialog(true);
  }, [isDesktopApp, isPrintReady, printDisableReason]);

  const confirmPrint = useCallback(async (options: {
    printerName: string;
    copies: number;
    pageRange: string;
    orientation: 'portrait' | 'landscape';
    colorMode: 'color' | 'grayscale';
  }) => {
    if (!isDesktopApp) {
      safeToast('Secure printing requires the desktop app');
      return;
    }
    if (!isPrintReady) {
      safeToast(printDisableReason || 'No connected printer detected');
      return;
    }
    if (!dialogDoc?.sessionToken) {
      safeToast('Document not ready for printing');
      return;
    }
    try {
      setActivePrintId(dialogDoc.id);
      const res = await (window as any).securePrintHub.requestPrint({
        sessionToken: dialogDoc.sessionToken,
        printerName: options.printerName,
        copies: options.copies,
        pageRange: options.pageRange,
        orientation: options.orientation,
        colorMode: options.colorMode,
      });
      if (!res || res.success !== true) {
        const msg = typeof res?.error === 'string' ? res.error : 'Print request failed';
        throw new Error(msg);
      }
      toast.success('Print requested');
      setShowPrintDialog(false);
      setDialogDoc(null);
      loadAssigned();
    } catch (e) {
      safeToast(e instanceof Error ? e.message : 'Print request failed');
    } finally {
      setActivePrintId(null);
    }
  }, [dialogDoc, isDesktopApp, isPrintReady, loadAssigned, printDisableReason]);

  const handleDownloadAgent = useCallback(async () => {
    try {
      setIsDownloadingAgent(true);
      const res = await api.get('/api/print-agent/download?format=json');
      const url = typeof res.data?.url === 'string' ? res.data.url : null;
      if (!url) {
        const msg = typeof res.data?.message === 'string' ? res.data.message : 'Download unavailable';
        throw new Error(msg);
      }

      toast.success('Download started');
      if (isDesktopApp && typeof (window as any).securePrintHub?.openExternal === 'function') {
        await (window as any).securePrintHub.openExternal(url);
      } else {
        window.location.href = url;
      }
    } catch (e) {
      const backendMsg = (e as any)?.response?.data?.message;
      safeToast(
        typeof backendMsg === 'string' && backendMsg.trim().length > 0
          ? backendMsg
          : e instanceof Error
            ? e.message
            : 'Failed to download desktop app'
      );
    } finally {
      setIsDownloadingAgent(false);
    }
  }, [isDesktopApp]);

  const handleLogout = useCallback(async () => {
    try {
      await signOut();
    } finally {
      navigate('/login', { replace: true });
    }
  }, [navigate, signOut]);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">Printing</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={loadAssigned} disabled={loading || authFailed}>
              Refresh
            </Button>
            <Button variant="outline" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>

        {user?.role === 'ADMIN' ? (
          <div className="rounded-lg border border-border p-4 bg-muted/20 text-sm text-muted-foreground">
            Admin accounts don’t print from the web. Use the Upload tools for admin workflows.
          </div>
        ) : !isDesktopApp ? (
          <div className="rounded-lg border border-border p-4 bg-muted/20 text-sm text-muted-foreground flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <div>
              <div className="font-medium text-foreground">Desktop App Required</div>
              <div>Secure printing is available only inside the SecurePrintHub Desktop App.</div>
            </div>
          </div>
        ) : null}

        {!isDesktopApp && user?.role !== 'ADMIN' ? (
          <div className="rounded-lg border border-border p-4 bg-card/50 text-sm">
            <div className="font-medium text-foreground mb-1">Download Desktop App</div>
            <div className="text-xs text-muted-foreground mb-3">
              Install the SecurePrintHub Desktop App to request secure prints.
            </div>
            <Button onClick={handleDownloadAgent} disabled={isDownloadingAgent} className="gap-2">
              {isDownloadingAgent ? 'Preparing download…' : 'Download for Windows (.exe)'}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : isDesktopApp && !isPrintReady ? (
          <div className="text-sm text-muted-foreground">{printDisableReason || 'No connected printer detected'}</div>
        ) : sortedDocs.length === 0 ? (
          <div className="text-sm text-muted-foreground space-y-1">
            <div>No documents assigned.</div>
            {user?.role === 'USER' && user?.email ? (
              <div className="text-xs">
                Logged in as: <span className="font-medium">{user.email}</span>
              </div>
            ) : null}
            {user?.role === 'USER' ? (
              <div className="text-xs">
                Ask an admin to assign a document to this email (Upload → enter email → upload).
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {sortedDocs.map((doc) => (
              <div key={doc.id} className="border border-border rounded-lg p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{doc.documentTitle}</div>
                  <div className="text-xs text-muted-foreground">
                    {doc.stage ? `Stage: ${doc.stage}` : doc.status ? `Status: ${doc.status}` : '—'}
                  </div>
                  {typeof doc.assignedPrints === 'number' &&
                  typeof doc.usedPrints === 'number' &&
                  typeof doc.remainingPrints === 'number' ? (
                    <div className="text-xs text-muted-foreground">
                      Prints: {doc.usedPrints} / {doc.assignedPrints} used ({doc.remainingPrints} remaining)
                    </div>
                  ) : null}
                </div>
                <Button
                  onClick={() => requestPrint(doc)}
                  disabled={
                    !isDesktopApp ||
                    !isPrintReady ||
                    !doc.sessionToken ||
                    activePrintId === doc.id ||
                    (typeof doc.remainingPrints === 'number' ? doc.remainingPrints === 0 : false)
                  }
                  className="gap-2"
                >
                  <Printer className="h-4 w-4" />
                  {activePrintId === doc.id ? 'Printing…' : 'Request Print'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {isDesktopApp ? (
          <SecurePrintDialog
            open={showPrintDialog}
            onOpenChange={(open) => {
              setShowPrintDialog(open);
              if (!open) setDialogDoc(null);
            }}
            onConfirmPrint={confirmPrint}
            documentTitle={dialogDoc?.documentTitle || 'Untitled Document'}
            isPrinting={!!activePrintId}
            printers={printers}
            isLoadingPrinters={isLoadingPrinters}
            onRefreshPrinters={refreshPrinters}
          />
        ) : null}
      </div>
    </div>
  );
};

export default Printing;
