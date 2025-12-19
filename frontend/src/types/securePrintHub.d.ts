export interface SecurePrintHubAPI {
  backendUrl?: string;
  setJwt: (token: string) => Promise<{ success: boolean }>;
  getPrintersDetailed?: () => Promise<
    Array<{
      name: string;
      displayName?: string;
      isDefault?: boolean;
      isOnline?: boolean;
      status?: number;
      connectionType?: string;
      printerKind?: string;
    }>
  >;
  requestPrint: (params: {
    sessionToken: string;
    printerName?: string;
    copies?: number;
    pageRange?: string;
    orientation?: 'portrait' | 'landscape';
    colorMode?: 'color' | 'grayscale';
  }) => Promise<{ success: boolean; error?: string }>;
}

declare global {
  interface Window {
    securePrintHub?: SecurePrintHubAPI;
  }
}

export {};
