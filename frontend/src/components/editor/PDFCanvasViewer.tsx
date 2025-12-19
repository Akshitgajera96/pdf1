import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface DetectedRegion {
  id: string;
  x: number; // percentage
  y: number; // percentage
  width: number; // percentage
  height: number; // percentage
}

interface PDFCanvasViewerProps {
  pdfUrl: string;
  fileType?: 'pdf' | 'svg';
  onPdfRendered?: (canvas: HTMLCanvasElement, pageWidth: number, pageHeight: number) => void;
  onRegionDetected?: (regions: DetectedRegion[]) => void;
  children?: React.ReactNode;
}

export const PDFCanvasViewer: React.FC<PDFCanvasViewerProps> = ({
  pdfUrl,
  fileType = 'pdf',
  onPdfRendered,
  onRegionDetected,
  children,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  // Base A4 dimensions in pixels at 96 DPI for screen display
  const A4_WIDTH_PX = 794; // 210mm at 96 DPI
  const A4_HEIGHT_PX = 1123; // 297mm at 96 DPI

  // Render at a higher internal resolution to reduce visible pixelation in the editor.
  // The canvas is rendered at SCALE_FACTOR times the base A4 size, then displayed
  // scaled down via CSS (maxWidth/maxHeight). This keeps edges sharper when the
  // user zooms in on the screen while still using a canvas for region detection.
  const SCALE_FACTOR = 3;
  const CANVAS_WIDTH = A4_WIDTH_PX * SCALE_FACTOR;
  const CANVAS_HEIGHT = A4_HEIGHT_PX * SCALE_FACTOR;

  // Render document (PDF or SVG) to canvas at A4 size
  const renderPDF = useCallback(async () => {
    if (!pdfUrl || !canvasRef.current || !containerRef.current) return;

    try {
      setIsLoading(true);
      setError(null);

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d')!;
      
      // Set canvas to higher-than-screen resolution (supersampling)
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;

      // Fill with white background first
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      if (fileType === 'pdf') {
        // Load PDF via pdf.js
        const response = await fetch(pdfUrl);
        const arrayBuffer = await response.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        pdfDocRef.current = pdfDoc;

        // Get first page
        const page = await pdfDoc.getPage(1);

        const originalViewport = page.getViewport({ scale: 1 });

        // Scale to fit the higher-resolution canvas while maintaining aspect ratio
        const scaleX = CANVAS_WIDTH / originalViewport.width;
        const scaleY = CANVAS_HEIGHT / originalViewport.height;
        const scale = Math.min(scaleX, scaleY);

        const viewport = page.getViewport({ scale });

        // Center the PDF content on the canvas
        const offsetX = (CANVAS_WIDTH - viewport.width) / 2;
        const offsetY = (CANVAS_HEIGHT - viewport.height) / 2;

        context.save();
        context.translate(offsetX, offsetY);

        // Render page
        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        context.restore();
      } else {
        // Render SVG by drawing it into the canvas
        const response = await fetch(pdfUrl);
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            // Scale SVG to fit the higher-resolution canvas while maintaining aspect ratio
            const scaleX = CANVAS_WIDTH / img.width;
            const scaleY = CANVAS_HEIGHT / img.height;
            const scale = Math.min(scaleX, scaleY);

            const drawWidth = img.width * scale;
            const drawHeight = img.height * scale;
            const offsetX = (CANVAS_WIDTH - drawWidth) / 2;
            const offsetY = (CANVAS_HEIGHT - drawHeight) / 2;

            context.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

            URL.revokeObjectURL(objectUrl);
            resolve();
          };
          img.onerror = (err) => {
            URL.revokeObjectURL(objectUrl);
            reject(err);
          };
          img.src = objectUrl;
        });
      }

      setDimensions({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });

      // Notify parent of rendered canvas
      if (onPdfRendered) {
        onPdfRendered(canvas, A4_WIDTH_PX, A4_HEIGHT_PX);
      }

      // Detect content region
      detectRegions(canvas, context);
      
      setIsLoading(false);
    } catch (err) {
      console.error('Error rendering document:', err);
      setError('Failed to load document');
      setIsLoading(false);
    }
  }, [pdfUrl, fileType, onPdfRendered]);

  // Simple region detection (detects non-white areas)
  const detectRegions = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
    let hasContent = false;

    const scanStep = 4 * SCALE_FACTOR;

    // Scan for non-white pixels
    for (let y = 0; y < canvas.height; y += scanStep) {
      for (let x = 0; x < canvas.width; x += scanStep) {
        const i = (y * canvas.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Check if pixel is not white (threshold 240)
        if (r < 240 || g < 240 || b < 240) {
          hasContent = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (hasContent && onRegionDetected) {
      // Create detected region as percentage, matching just the note/ticket area
      const region: DetectedRegion = {
        id: 'ticket-1',
        x: (minX / canvas.width) * 100,
        y: (minY / canvas.height) * 100,
        width: ((maxX - minX) / canvas.width) * 100,
        height: ((maxY - minY) / canvas.height) * 100,
      };

      onRegionDetected([region]);
    }
  };

  useEffect(() => {
    renderPDF();

    const handleResize = () => {
      renderPDF();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderPDF]);

  // Track actual displayed canvas size for overlay positioning
  const [displayedSize, setDisplayedSize] = useState({ width: 0, height: 0 });
  const canvasWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    
    const updateDisplayedSize = () => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setDisplayedSize({ width: rect.width, height: rect.height });
      }
    };

    updateDisplayedSize();
    const resizeObserver = new ResizeObserver(updateDisplayedSize);
    resizeObserver.observe(canvasRef.current);
    
    return () => resizeObserver.disconnect();
  }, [dimensions]);

  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-full flex items-start justify-center bg-muted/30"
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <div className="text-center">
            <div className="h-8 w-8 mx-auto rounded-full border-2 border-primary border-t-transparent animate-spin mb-2" />
            <p className="text-sm text-muted-foreground">Loading PDF...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* PDF Canvas with Wrapper for proper overlay positioning */}
      <div
        ref={canvasWrapperRef}
        className="relative inline-block"
        style={{ width: `min(100%, ${A4_WIDTH_PX}px)`, aspectRatio: `${A4_WIDTH_PX} / ${A4_HEIGHT_PX}` }}
      >
        <canvas
          ref={canvasRef}
          className="shadow-2xl rounded-sm block w-full h-full"
        />

        {/* Overlay layer for editing - positioned exactly over the canvas */}
        {displayedSize.width > 0 && (
          <div
            className="absolute top-0 left-0"
            style={{
              width: displayedSize.width,
              height: displayedSize.height,
              pointerEvents: 'auto',
            }}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
};
