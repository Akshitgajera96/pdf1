import { FileText } from 'lucide-react';

interface SecurePDFViewerProps {
  pdfUrl: string;
  documentTitle?: string;
  onPrint?: () => void;
  printDisabled?: boolean;
  remainingPrints?: number;
  maxPrints?: number;
}

export const SecurePDFViewer = ({ 
  pdfUrl, 
  documentTitle = "Secure Document",
  onPrint,
  printDisabled = false,
  remainingPrints,
  maxPrints
}: SecurePDFViewerProps) => {
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="text-center max-w-md">
        <div className="mb-4 h-12 w-12 mx-auto rounded-full bg-muted flex items-center justify-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="text-foreground font-medium">Preview unavailable</div>
        <div className="text-sm text-muted-foreground mt-1">
          The web UI does not render documents.
        </div>
      </div>
    </div>
  );
};
