export function resolveBackendUrl(): string | undefined {
  try {
    const fromDesktop =
      typeof window !== 'undefined' ? (window as any)?.securePrintHub?.backendUrl : undefined;
    const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined;
    const raw = fromDesktop || fromEnv;
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed.length) return undefined;

    if (import.meta.env.PROD) {
      try {
        const u = new URL(trimmed);
        const host = String(u.hostname || '').toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
          return undefined;
        }
      } catch {
        return undefined;
      }
    }

    return trimmed;
  } catch {
    return undefined;
  }
}

export const BACKEND_URL = resolveBackendUrl();
