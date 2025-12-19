import { useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import { Upload as UploadIcon, Layers, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { UploadZone } from '@/components/UploadZone';
import { toast } from 'sonner';
import { safeToast } from '@/lib/safeToast';
import { useAuth } from '@/hooks/useAuth';
import Navbar from '@/components/Navbar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

const Upload = () => {
  const navigate = useNavigate();
  const { user, token, loading } = useAuth();
  const isDesktopApp = typeof window !== 'undefined' && !!(window as any).securePrintHub;

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [searchEmail, setSearchEmail] = useState('');
  const [selectedAdminTarget, setSelectedAdminTarget] = useState<{ id: string; email: string } | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [sessions, setSessions] = useState<Array<{ _id: string; ip: string; userAgent: string; createdAt: string }>>([]);

  const [allUsers, setAllUsers] = useState<
    Array<{
      _id: string;
      email: string;
      role?: string;
      createdAt?: string;
      sessionCount?: number;
      distinctIpCount?: number;
    }>
  >([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const [ipOverview, setIpOverview] = useState<
    Array<{
      ip: string;
      sessionCount: number;
      lastSeen?: string;
      isBlocked?: boolean;
      blockedReason?: string | null;
    }>
  >([]);
  const [isLoadingIpOverview, setIsLoadingIpOverview] = useState(false);

  const [blockedIps, setBlockedIps] = useState<
    Array<{
      ip: string;
      reason?: string;
      isActive?: boolean;
      createdAt?: string;
      expiresAt?: string;
      blockedBy?: { email?: string };
    }>
  >([]);
  const [isLoadingBlockedIps, setIsLoadingBlockedIps] = useState(false);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !user || !token) return;

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', selectedFile.name);
      formData.append('totalPrints', '5');

      const res = await api.post('/api/docs/upload', formData);

      if (!res.data) {
        throw new Error('Upload failed');
      }

      const data = res.data;

      const uploadedIdRaw =
        (data as any)?.documentId ?? (data as any)?._id ?? (data as any)?.documentId?._id;
      const uploadedId = uploadedIdRaw ? String(uploadedIdRaw) : '';

      if (!uploadedId) {
        throw new Error('Upload failed: missing documentId');
      }

      const uploadedTitle = String(data.documentTitle || selectedFile.name || 'Uploaded Document');
      try {
        sessionStorage.setItem('lastUploadedDocumentId', uploadedId);
        sessionStorage.setItem('lastUploadedDocumentTitle', uploadedTitle);
      } catch {
        // ignore
      }

      if (isMountedRef.current) toast.success('Document uploaded securely');

      setSelectedFile(null);
      navigate('/viewer', {
        state: {
          sessionToken: (data as any)?.sessionToken,
          documentTitle: (data as any)?.documentTitle ?? uploadedTitle,
          remainingPrints: (data as any)?.remainingPrints,
          maxPrints: (data as any)?.maxPrints,
          documentType: (data as any)?.documentType,
          documentId: uploadedId,
        },
      });
    } catch (error) {
      console.error('Upload error:', error);
      if (isMountedRef.current) safeToast(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleLoadSessions = async () => {
    const q = searchEmail.trim();
    if (!q) {
      safeToast('Enter a user email first');
      return;
    }

    setIsLoadingSessions(true);
    try {
      const usersRes = await api.get('/api/admin/users', { params: { email: q } });
      const list = (usersRes.data as any)?.users || [];
      if (!Array.isArray(list) || list.length === 0) {
        safeToast('No users found for this email');
        setSelectedAdminTarget(null);
        setSessions([]);
        setIpOverview([]);
        return;
      }

      const target = list[0];
      const userId = String(target._id);
      setSelectedAdminTarget({ id: userId, email: String(target.email || q) });

      const res = await api.get(`/api/admin/users/${userId}/sessions`);
      setSessions(((res.data as any)?.sessions || []) as any);
    } catch (error) {
      console.error('Load sessions error:', error);
      safeToast(error instanceof Error ? error.message : 'Failed to load sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    if (!selectedAdminTarget) {
      safeToast('Load a user by email first');
      return;
    }

    setIsLoggingOutAll(true);
    try {
      const res = await api.post('/api/admin/logout-all', { userId: selectedAdminTarget.id });
      if (!(res.data as any)?.success) {
        const msg = (res.data as any)?.message || 'Failed to logout user from all devices';
        throw new Error(msg);
      }
      toast.success('User logged out from all devices');
      setSessions([]);
      setIpOverview([]);
    } catch (error) {
      console.error('Logout all devices error:', error);
      safeToast(error instanceof Error ? error.message : 'Failed to logout user');
    } finally {
      setIsLoggingOutAll(false);
    }
  };

  const handleLoadAllUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const res = await api.get('/api/admin/users/active-sessions');
      setAllUsers(((res.data as any)?.users || []) as any);
    } catch (error) {
      console.error('Load users error:', error);
      safeToast(error instanceof Error ? error.message : 'Failed to load users');
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const toggleSelectedUser = (id: string) => {
    setSelectedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBulkLogout = async () => {
    if (selectedUserIds.length === 0) {
      safeToast('Select at least one user');
      return;
    }

    try {
      for (const id of selectedUserIds) {
        const res = await api.post('/api/admin/logout-all', { userId: id });
        if (!(res.data as any)?.success) {
          const msg = (res.data as any)?.message || 'Failed to logout user';
          throw new Error(msg);
        }
      }
      toast.success('Selected users logged out from all devices');
      setSelectedUserIds([]);
      await handleLoadAllUsers();
    } catch (error) {
      console.error('Bulk logout error', error);
      safeToast(error instanceof Error ? error.message : 'Failed to logout selected users');
    }
  };

  const handleLoadIpOverview = async () => {
    if (!selectedAdminTarget) {
      safeToast('Select a user first');
      return;
    }

    setIsLoadingIpOverview(true);
    try {
      const res = await api.get(`/api/admin/users/${selectedAdminTarget.id}/ip-overview`);
      setIpOverview((((res.data as any)?.ips || []) as any) ?? []);
    } catch (error) {
      console.error('Load IP overview error:', error);
      safeToast(error instanceof Error ? error.message : 'Failed to load IP overview');
    } finally {
      setIsLoadingIpOverview(false);
    }
  };

  const handleBlockOtherIps = async () => {
    if (!selectedAdminTarget) {
      safeToast('Select a user first');
      return;
    }

    try {
      const res = await api.post(`/api/admin/users/${selectedAdminTarget.id}/block-other-ips`, {
        reason: 'Block all other IPs from admin panel',
      });
      if (!(res.data as any)?.success) {
        const msg = (res.data as any)?.message || 'Failed to block other IPs';
        throw new Error(msg);
      }
      toast.success('Other IPs blocked for this user');
      await handleLoadSessions();
      await handleLoadIpOverview();
    } catch (error) {
      console.error('Block other IPs error:', error);
      safeToast(error instanceof Error ? error.message : 'Failed to block other IPs');
    }
  };

  const handleLoadBlockedIps = async () => {
    setIsLoadingBlockedIps(true);
    try {
      const res = await api.get('/api/admin/blocked-ips');
      setBlockedIps((((res.data as any)?.ips || []) as any) ?? []);
    } catch (error) {
      console.error('Load blocked IPs error:', error);
      safeToast(error instanceof Error ? error.message : 'Failed to load blocked IPs');
    } finally {
      setIsLoadingBlockedIps(false);
    }
  };

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth', { state: { from: '/upload' } });
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <div className="container py-8">
        <h1 className="text-2xl font-semibold mb-8">Document Tools</h1>

        <Tabs
          defaultValue="upload"
          onValueChange={(v) => {
            if (v === 'batch') navigate('/batch-series');
          }}
          className="animate-fade-in"
          style={{ animationDelay: '0.1s' }}
        >
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="upload" className="gap-2">
              <UploadIcon className="h-4 w-4" />
              Secure Upload
            </TabsTrigger>
            <TabsTrigger
              value="batch"
              className="gap-2"
              onClick={() => {
                navigate('/batch-series');
              }}
            >
              <Layers className="h-4 w-4" />
              Batch Series
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-6">
          <UploadZone onFileSelect={handleFileSelect} isUploading={isUploading} />

          {selectedFile && !isUploading && (
            <div className="flex justify-center animate-fade-in">
              <Button
                size="lg"
                onClick={handleUpload}
                className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 h-14 px-8"
              >
                <UploadIcon className="h-5 w-5" />
                Upload & View Securely
              </Button>
            </div>
          )}
        </div>

        {user && user.role === 'ADMIN' && (
          <div className="mt-6 p-4 rounded-xl bg-card border border-border animate-fade-in" style={{ animationDelay: '0.25s' }}>
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Session Control (Admin)
            </h3>

            <p className="text-xs text-muted-foreground mb-3">
              View and control active sessions for a user. Search by email to see all logged-in devices.
            </p>
            {selectedAdminTarget && (
              <div className="text-xs text-muted-foreground mb-2">
                Selected user:&nbsp;
                <span className="font-medium text-foreground">{selectedAdminTarget.email}</span>
                &nbsp;(<code className="text-[10px]">{selectedAdminTarget.id}</code>)
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder="User email (e.g. user@example.com)"
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                className="sm:max-w-xs"
              />
              <Button
                variant="outline"
                onClick={handleLoadSessions}
                disabled={isLoadingSessions}
                className="w-full sm:w-auto"
              >
                {isLoadingSessions ? 'Loading sessions...' : 'View active sessions'}
              </Button>
              <Button
                variant="destructive"
                onClick={handleLogoutAllDevices}
                disabled={isLoggingOutAll}
                className="w-full sm:w-auto"
              >
                {isLoggingOutAll ? 'Logging out...' : 'Logout all devices'}
              </Button>
            </div>

            <div className="mt-4 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-foreground">Users with active sessions</h4>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleLoadAllUsers}
                    disabled={isLoadingUsers}
                  >
                    {isLoadingUsers ? 'Loading...' : 'Load all users'}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkLogout}
                    disabled={selectedUserIds.length === 0}
                  >
                    Logout selected
                  </Button>
                </div>
              </div>
              {allUsers.length > 0 && (
                <div className="max-h-64 overflow-y-auto border border-border/60 rounded-md">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b border-border">
                      <tr>
                        <th className="py-1 px-2 w-6 text-center">
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={
                              allUsers.filter((u) => u.role !== 'admin').length > 0 &&
                              allUsers
                                .filter((u) => u.role !== 'admin')
                                .every((u) => selectedUserIds.includes(u._id))
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              if (checked) {
                                setSelectedUserIds(
                                  allUsers
                                    .filter((u) => u.role !== 'admin')
                                    .map((u) => u._id)
                                );
                              } else {
                                setSelectedUserIds([]);
                              }
                            }}
                          />
                        </th>
                        <th className="text-left py-1 px-2">Email</th>
                        <th className="text-left py-1 px-2">Role</th>
                        <th className="text-left py-1 px-2">Active sessions</th>
                        <th className="text-left py-1 px-2">Distinct IPs</th>
                        <th className="text-left py-1 px-2">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allUsers
                        .filter((u) => u.role !== 'admin')
                        .map((u) => (
                          <tr
                            key={u._id}
                            className="border-b border-border/40 last:border-0 hover:bg-muted/30 cursor-pointer"
                            onClick={() => {
                              setSearchEmail(u.email);
                              setSelectedAdminTarget({ id: u._id, email: u.email });
                            }}
                          >
                            <td className="py-1 px-2 text-center">
                              <input
                                type="checkbox"
                                className="h-3 w-3"
                                checked={selectedUserIds.includes(u._id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleSelectedUser(u._id);
                                }}
                              />
                            </td>
                            <td className="py-1 px-2">{u.email}</td>
                            <td className="py-1 px-2">{u.role || 'user'}</td>
                            <td className="py-1 px-2">{u.sessionCount ?? 0}</td>
                            <td className="py-1 px-2">{u.distinctIpCount ?? 0}</td>
                            <td className="py-1 px-2">
                              {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '-'}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              {allUsers.length === 0 && !isLoadingUsers && (
                <p className="text-[11px] text-muted-foreground">
                  Users will appear here after you load them.
                </p>
              )}
            </div>

            {sessions.length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="text-muted-foreground border-b border-border">
                    <tr>
                      <th className="py-2 pr-2 text-left">IP address</th>
                      <th className="py-2 px-2 text-left">Browser / Device</th>
                      <th className="py-2 px-2 text-left">Login time</th>
                      <th className="py-2 pl-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s._id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-2 align-top font-mono text-[11px] sm:text-xs">{s.ip}</td>
                        <td className="py-2 px-2 align-top max-w-xs truncate" title={s.userAgent}>
                          {s.userAgent || 'Unknown'}
                        </td>
                        <td className="py-2 px-2 align-top whitespace-nowrap">
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 pl-2 align-top text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                await api.post(`/api/admin/sessions/${s._id}/logout`);
                                toast.success('Session logged out');
                                setSessions((prev) => prev.filter((x) => x._id !== s._id));
                              } catch (error) {
                                console.error('Logout session error:', error);
                                safeToast(error instanceof Error ? error.message : 'Failed to logout session');
                              }
                            }}
                          >
                            Logout
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              try {
                                await api.post(`/api/admin/sessions/${s._id}/block-ip`, {
                                  reason: 'Blocked from admin panel',
                                });
                                toast.success('IP blocked and sessions removed');
                                setSessions((prev) => prev.filter((x) => x.ip !== s.ip));
                              } catch (error) {
                                console.error('Block IP error:', error);
                                safeToast(error instanceof Error ? error.message : 'Failed to block IP');
                              }
                            }}
                          >
                            Block IP
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {selectedAdminTarget && (
              <div className="mt-6 border-t border-border pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-foreground">IP overview for selected user</h4>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleLoadIpOverview}
                      disabled={isLoadingIpOverview}
                    >
                      {isLoadingIpOverview ? 'Loading IPs...' : 'Load IP overview'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleBlockOtherIps}>
                      Block all other IPs
                    </Button>
                  </div>
                </div>
                {ipOverview.length > 0 && (
                  <div className="max-h-64 overflow-y-auto border border-border/60 rounded-md">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 border-b border-border/60">
                        <tr>
                          <th className="text-left py-1 px-2">IP</th>
                          <th className="text-left py-1 px-2">Total sessions</th>
                          <th className="text-left py-1 px-2">Last seen</th>
                          <th className="text-left py-1 px-2">Status</th>
                          <th className="text-left py-1 px-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ipOverview.map((row) => (
                          <tr key={row.ip} className="border-b border-border/40 last:border-0">
                            <td className="py-1 px-2 font-mono text-[11px] sm:text-xs">{row.ip}</td>
                            <td className="py-1 px-2">{row.sessionCount}</td>
                            <td className="py-1 px-2">
                              {row.lastSeen ? new Date(row.lastSeen).toLocaleString() : '-'}
                            </td>
                            <td className="py-1 px-2">
                              {row.isBlocked ? (
                                <span className="text-xs text-red-500">Blocked</span>
                              ) : (
                                <span className="text-xs text-green-500">Allowed</span>
                              )}
                            </td>
                            <td className="py-1 px-2">
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant={row.isBlocked ? 'outline' : 'destructive'}
                                  onClick={async () => {
                                    try {
                                      const url = row.isBlocked ? '/api/admin/unblock-ip' : '/api/admin/block-ip';
                                      const res = await api.post(url, { ip: row.ip });
                                      if (!(res.data as any)?.success) {
                                        const message = (res.data as any)?.message || 'Failed to update IP status';
                                        throw new Error(message);
                                      }
                                      toast.success(row.isBlocked ? 'IP unblocked' : 'IP blocked');
                                      await handleLoadIpOverview();
                                    } catch (error) {
                                      console.error('Toggle IP block error', error);
                                      safeToast(error instanceof Error ? error.message : 'Failed to update IP status');
                                    }
                                  }}
                                >
                                  {row.isBlocked ? 'Unblock' : 'Block'}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {ipOverview.length === 0 && !isLoadingIpOverview && (
                  <p className="text-[11px] text-muted-foreground">
                    IPs for this user will appear here after you load them.
                  </p>
                )}
              </div>
            )}

            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-foreground">Blocked IPs (global)</h4>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleLoadBlockedIps}
                  disabled={isLoadingBlockedIps}
                >
                  {isLoadingBlockedIps ? 'Loading...' : 'Refresh'}
                </Button>
              </div>
              {blockedIps.length > 0 && (
                <div className="max-h-64 overflow-y-auto border border-border/60 rounded-md">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-b border-border/60">
                      <tr>
                        <th className="text-left py-1 px-2">IP</th>
                        <th className="text-left py-1 px-2">Reason</th>
                        <th className="text-left py-1 px-2">Blocked by</th>
                        <th className="text-left py-1 px-2">Expires at</th>
                        <th className="text-left py-1 px-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockedIps.map((b) => (
                        <tr key={b.ip} className="border-b border-border/40 last:border-0">
                          <td className="py-1 px-2 font-mono text-[11px] sm:text-xs">{b.ip}</td>
                          <td className="py-1 px-2 max-w-xs truncate">{b.reason || '-'}</td>
                          <td className="py-1 px-2">{b.blockedBy?.email || 'Admin'}</td>
                          <td className="py-1 px-2">
                            {b.expiresAt ? new Date(b.expiresAt).toLocaleString() : '-'}
                          </td>
                          <td className="py-1 px-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                try {
                                  const res = await api.post('/api/admin/unblock-ip', { ip: b.ip });
                                  if (!(res.data as any)?.success) {
                                    const msg = (res.data as any)?.message || 'Failed to unblock IP';
                                    throw new Error(msg);
                                  }
                                  toast.success('IP unblocked');
                                  await handleLoadBlockedIps();
                                } catch (error) {
                                  console.error('Unblock IP error', error);
                                  safeToast(error instanceof Error ? error.message : 'Failed to unblock IP');
                                }
                              }}
                            >
                              Unblock
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {blockedIps.length === 0 && !isLoadingBlockedIps && (
                <p className="text-[11px] text-muted-foreground">
                  No blocked IPs found. Use the Block IP buttons above to add some.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Upload;