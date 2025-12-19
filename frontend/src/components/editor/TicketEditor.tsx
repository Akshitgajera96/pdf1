// frontend/src/components/editor/TicketEditor.tsx
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import { safeToast } from '@/lib/safeToast';
import { PDFCanvasViewer, DetectedRegion } from './PDFCanvasViewer';
import { SeriesSlot, SeriesSlotData, LetterStyle } from './SeriesSlot';
import { TicketToolbar } from './TicketToolbar';
import { TicketPropertiesPanel } from './TicketPropertiesPanel';
import { TicketOutputPreview } from './TicketOutputPreview';

interface TicketEditorProps {
  pdfUrl?: string | null;
  fileType?: 'pdf' | 'svg';
  documentId?: string;
}

export interface TicketOnPage {
  seriesBySlot: Record<
    string,
    {
      seriesValue: string;
      letterStyles: { fontSize: number; offsetY: number; spacingAfterX: number }[];
    }
  >;
}

export interface TicketOutputPage {
  pageNumber: number;
  layoutMode: 'raster' | 'vector';
  ticketImageData: string; // Single ticket image
  ticketImageSize?: { width: number; height: number }; // Pixel size of ticketImageData source
  ticketImageXPercent: number;
  ticketImageYPercent: number;
  ticketImageWidthPercent: number;
  ticketImageHeightPercent: number;
  ticketRegion: { x: number; y: number; width: number; height: number }; // Ticket position in percentage
  seriesSlots: SeriesSlotData[]; // One or more slots relative to ticket
  tickets: TicketOnPage[]; // 4 tickets per page
}

export interface MasterSlotConfig {
  pageNumber: number;
  region: {
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
  };
  seriesSlot: {
    xPercent: number;
    yPercent: number;
    widthPercent: number;
    heightPercent: number;
    rotation: number;
    backgroundColor: string;
    borderColor: string;
    borderWidth: number;
    paddingTop: number;
    paddingRight: number;
    paddingBottom: number;
    paddingLeft: number;
    textAlign: 'left' | 'center' | 'right';
    fontFamily: string;
    defaultFontSize: number;
    color: string;
    perLetterFontSizes: number[];
    perLetterOffsets: number[];
  };
}

export const TicketEditor: React.FC<TicketEditorProps> = ({ pdfUrl, fileType = 'pdf', documentId }: TicketEditorProps) => {
  const [pdfCanvas, setPdfCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pdfDimensions, setPdfDimensions] = useState({ width: 0, height: 0 });

  const A4_WIDTH_MM = 210;
  const A4_HEIGHT_MM = 297;
  const TICKET_HEIGHT_MM = A4_HEIGHT_MM / 4;
  const [cutMarginMm, setCutMarginMm] = useState(0);
  const CUT_MARGIN_X_PERCENT = useMemo(() => (cutMarginMm / A4_WIDTH_MM) * 100, [A4_WIDTH_MM, cutMarginMm]);
  const CUT_MARGIN_Y_PERCENT = useMemo(() => (cutMarginMm / TICKET_HEIGHT_MM) * 100, [TICKET_HEIGHT_MM, cutMarginMm]);

  const xPercentToMm = useCallback((xPercent: number) => (xPercent / 100) * A4_WIDTH_MM, [A4_WIDTH_MM]);
  const yPercentToMm = useCallback((yPercent: number) => (yPercent / 100) * TICKET_HEIGHT_MM, [TICKET_HEIGHT_MM]);
  const xMmToPercent = useCallback((xMm: number) => (xMm / A4_WIDTH_MM) * 100, [A4_WIDTH_MM]);
  const yMmToPercent = useCallback((yMm: number) => (yMm / TICKET_HEIGHT_MM) * 100, [TICKET_HEIGHT_MM]);

  const DEFAULT_FONT_FAMILIES = [
    'Arial',
    'Times New Roman',
    'Courier New',
    'Georgia',
    'Verdana',
    'Helvetica',
    'Trebuchet MS',
    'Impact',
    'Comic Sans MS',
    'Monaco',
  ];

  const [customFonts, setCustomFonts] = useState<{ family: string; dataUrl: string }[]>([]);

  // Detected ticket region (user can adjust this)
  const [ticketRegion, setTicketRegion] = useState<DetectedRegion | null>(null);
  const [isRegionDragging, setIsRegionDragging] = useState(false);
  const [isRegionResizing, setIsRegionResizing] = useState<string | null>(null);
  const [regionDragStart, setRegionDragStart] = useState({ x: 0, y: 0, regionX: 0, regionY: 0 });
  const [regionResizeStart, setRegionResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, regionX: 0, regionY: 0 });

  // Series slot state (support multiple slots, one selected at a time)
  const [seriesSlots, setSeriesSlots] = useState<SeriesSlotData[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  // Series config - support any characters including spaces
  const [startingSeries, setStartingSeries] = useState('A001');
  const [totalPages, setTotalPages] = useState(5);

  // Output state
  const [outputPages, setOutputPages] = useState<TicketOutputPage[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const [ticketImageXPercent, setTicketImageXPercent] = useState(CUT_MARGIN_X_PERCENT);
  const [ticketImageYPercent, setTicketImageYPercent] = useState(CUT_MARGIN_Y_PERCENT);
  const [ticketImageWidthPercent, setTicketImageWidthPercent] = useState(100 - 2 * CUT_MARGIN_X_PERCENT);
  const [ticketImageHeightPercent, setTicketImageHeightPercent] = useState(100 - 2 * CUT_MARGIN_Y_PERCENT);
  const [ticketImageLockAspect, setTicketImageLockAspect] = useState(true);

  useEffect(() => {
    if (!outputPages || outputPages.length === 0) return;

    setOutputPages((prev) =>
      prev.map((p) => ({
        ...p,
        ticketImageXPercent,
        ticketImageYPercent,
        ticketImageWidthPercent,
        ticketImageHeightPercent,
      }))
    );
  }, [
    outputPages.length,
    ticketImageHeightPercent,
    ticketImageWidthPercent,
    ticketImageXPercent,
    ticketImageYPercent,
  ]);

  // Drag/resize state for series slot
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, slotX: 0, slotY: 0 });
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, slotX: 0, slotY: 0 });

  const [overlayImage, setOverlayImage] = useState<string | null>(null);
  const [overlayImagePosition, setOverlayImagePosition] = useState({ x: 5, y: 5, width: 20 });
  const [isOverlayDragging, setIsOverlayDragging] = useState(false);
  const [overlayDragStart, setOverlayDragStart] = useState({ x: 0, y: 0, startX: 5, startY: 5 });
  const [isOverlaySelected, setIsOverlaySelected] = useState(false);
  const [isOverlayResizing, setIsOverlayResizing] = useState(false);
  const [overlayResizeStart, setOverlayResizeStart] = useState({ x: 0, y: 0, width: 20 });

  const clampTicketImageRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const maxWidth = 100 - 2 * CUT_MARGIN_X_PERCENT;
      const maxHeight = 100 - 2 * CUT_MARGIN_Y_PERCENT;

      const width = Math.max(1, Math.min(maxWidth, rect.width));
      const height = Math.max(1, Math.min(maxHeight, rect.height));

      const x = Math.max(CUT_MARGIN_X_PERCENT, Math.min(100 - CUT_MARGIN_X_PERCENT - width, rect.x));
      const y = Math.max(CUT_MARGIN_Y_PERCENT, Math.min(100 - CUT_MARGIN_Y_PERCENT - height, rect.y));

      return { x, y, width, height };
    },
    [CUT_MARGIN_X_PERCENT, CUT_MARGIN_Y_PERCENT]
  );

  useEffect(() => {
    const next = clampTicketImageRect({
      x: ticketImageXPercent,
      y: ticketImageYPercent,
      width: ticketImageWidthPercent,
      height: ticketImageHeightPercent,
    });

    if (
      Math.abs(next.x - ticketImageXPercent) > 1e-6 ||
      Math.abs(next.y - ticketImageYPercent) > 1e-6 ||
      Math.abs(next.width - ticketImageWidthPercent) > 1e-6 ||
      Math.abs(next.height - ticketImageHeightPercent) > 1e-6
    ) {
      setTicketImageXPercent(next.x);
      setTicketImageYPercent(next.y);
      setTicketImageWidthPercent(next.width);
      setTicketImageHeightPercent(next.height);
    }
  }, [
    clampTicketImageRect,
    ticketImageHeightPercent,
    ticketImageWidthPercent,
    ticketImageXPercent,
    ticketImageYPercent,
  ]);

  const fitLockedAspectToBounds = useCallback(
    (rect: { width: number; height: number }) => {
      const maxWidth = 100 - 2 * CUT_MARGIN_X_PERCENT;
      const maxHeight = 100 - 2 * CUT_MARGIN_Y_PERCENT;

      const scale = Math.min(1, maxWidth / rect.width, maxHeight / rect.height);
      return {
        width: Math.max(1, rect.width * scale),
        height: Math.max(1, rect.height * scale),
      };
    },
    [CUT_MARGIN_X_PERCENT, CUT_MARGIN_Y_PERCENT]
  );

  const updateTicketImageRect = useCallback(
    (updates: Partial<{ x: number; y: number; width: number; height: number }> & { sourceAspectRatio?: number }) => {
      const current = {
        x: ticketImageXPercent,
        y: ticketImageYPercent,
        width: ticketImageWidthPercent,
        height: ticketImageHeightPercent,
      };

      let next = { ...current, ...updates };

      const aspect = updates.sourceAspectRatio;
      if (ticketImageLockAspect && aspect && aspect > 0) {
        const widthChanged = typeof updates.width === 'number' && updates.width !== current.width;
        const heightChanged = typeof updates.height === 'number' && updates.height !== current.height;

        if (widthChanged && !heightChanged) {
          const widthMm = (next.width / 100) * A4_WIDTH_MM;
          const heightMm = widthMm / aspect;
          next.height = (heightMm / TICKET_HEIGHT_MM) * 100;
        } else if (heightChanged && !widthChanged) {
          const heightMm = (next.height / 100) * TICKET_HEIGHT_MM;
          const widthMm = heightMm * aspect;
          next.width = (widthMm / A4_WIDTH_MM) * 100;
        }

        const fitted = fitLockedAspectToBounds({ width: next.width, height: next.height });
        next.width = fitted.width;
        next.height = fitted.height;
      }

      next = clampTicketImageRect(next);

      setTicketImageXPercent(next.x);
      setTicketImageYPercent(next.y);
      setTicketImageWidthPercent(next.width);
      setTicketImageHeightPercent(next.height);
    },
    [
      A4_WIDTH_MM,
      TICKET_HEIGHT_MM,
      clampTicketImageRect,
      fitLockedAspectToBounds,
      ticketImageHeightPercent,
      ticketImageLockAspect,
      ticketImageWidthPercent,
      ticketImageXPercent,
      ticketImageYPercent,
    ]
  );

  const getCurrentTicketImageAspectRatio = useCallback(() => {
    const w = outputPages?.[0]?.ticketImageSize?.width;
    const h = outputPages?.[0]?.ticketImageSize?.height;
    if (!w || !h) return null;
    if (w <= 0 || h <= 0) return null;
    return w / h;
  }, [outputPages]);

  const handleTicketImageAlign = useCallback(
    (align: 'left' | 'center' | 'right') => {
      if (align === 'left') {
        updateTicketImageRect({ x: CUT_MARGIN_X_PERCENT });
        return;
      }
      if (align === 'right') {
        updateTicketImageRect({ x: 100 - CUT_MARGIN_X_PERCENT - ticketImageWidthPercent });
        return;
      }
      updateTicketImageRect({ x: (100 - ticketImageWidthPercent) / 2 });
    },
    [CUT_MARGIN_X_PERCENT, ticketImageWidthPercent, updateTicketImageRect]
  );

  const handleTicketImageMove = useCallback(
    (dx: number, dy: number) => {
      updateTicketImageRect({ x: ticketImageXPercent + dx, y: ticketImageYPercent + dy });
    },
    [ticketImageXPercent, ticketImageYPercent, updateTicketImageRect]
  );

  const handleTicketImageMoveMm = useCallback(
    (dxMm: number, dyMm: number) => {
      const dx = xMmToPercent(dxMm);
      const dy = yMmToPercent(dyMm);
      updateTicketImageRect({ x: ticketImageXPercent + dx, y: ticketImageYPercent + dy });
    },
    [ticketImageXPercent, ticketImageYPercent, updateTicketImageRect, xMmToPercent, yMmToPercent]
  );

  const handleTicketImageXmmChange = useCallback(
    (xMm: number) => {
      updateTicketImageRect({ x: xMmToPercent(xMm) });
    },
    [updateTicketImageRect, xMmToPercent]
  );

  const handleTicketImageYmmChange = useCallback(
    (yMm: number) => {
      updateTicketImageRect({ y: yMmToPercent(yMm) });
    },
    [updateTicketImageRect, yMmToPercent]
  );

  const handleCutMarginMmChange = useCallback((mm: number) => {
    setCutMarginMm(Math.max(0, mm));
  }, []);

  const handleTicketImageWidthMmChange = useCallback(
    (vMm: number) => {
      updateTicketImageRect({ width: xMmToPercent(vMm), sourceAspectRatio: getCurrentTicketImageAspectRatio() || undefined });
    },
    [getCurrentTicketImageAspectRatio, updateTicketImageRect, xMmToPercent]
  );

  const handleTicketImageHeightMmChange = useCallback(
    (vMm: number) => {
      updateTicketImageRect({ height: yMmToPercent(vMm), sourceAspectRatio: getCurrentTicketImageAspectRatio() || undefined });
    },
    [getCurrentTicketImageAspectRatio, updateTicketImageRect, yMmToPercent]
  );

  // Track the actual displayed size of the PDF canvas for accurate drag calculations
  const [displayedPdfSize, setDisplayedPdfSize] = useState({ width: 0, height: 0 });

  // Calculate ending series
  const calculateEndingSeries = useCallback((start: string, totalTickets: number): string => {
    const match = start.match(/^(.*?)(\d+)$/);
    if (match) {
      const [, prefix, numStr] = match;
      const startNum = parseInt(numStr, 10);
      const endNum = startNum + totalTickets - 1;
      return `${prefix}${endNum.toString().padStart(numStr.length, '0')}`;
    }
    return start;
  }, []);

  // 4 tickets per page
  const endingSeries = useMemo(() => calculateEndingSeries(startingSeries, totalPages * 4), [startingSeries, totalPages, calculateEndingSeries]);

  const masterSlotConfig = useMemo<MasterSlotConfig | null>(() => {
    if (!ticketRegion || seriesSlots.length === 0) return null;

    const primarySlot = seriesSlots[0];

    const slotRelativeX = ((primarySlot.x - ticketRegion.x) / ticketRegion.width) * 100;
    const slotRelativeY = ((primarySlot.y - ticketRegion.y) / ticketRegion.height) * 100;
    const slotRelativeWidth = (primarySlot.width / ticketRegion.width) * 100;
    const slotRelativeHeight = (primarySlot.height / ticketRegion.height) * 100;

    const perLetterFontSizes = (primarySlot.letterStyles || []).map((ls) => ls.fontSize || primarySlot.defaultFontSize);
    const perLetterOffsets = (primarySlot.letterStyles || []).map((ls) => ls.offsetY || 0);

    return {
      pageNumber: 1,
      region: {
        xPercent: ticketRegion.x,
        yPercent: ticketRegion.y,
        widthPercent: ticketRegion.width,
        heightPercent: ticketRegion.height,
      },
      seriesSlot: {
        xPercent: slotRelativeX,
        yPercent: slotRelativeY,
        widthPercent: slotRelativeWidth,
        heightPercent: slotRelativeHeight,
        rotation: primarySlot.rotation ?? 0,
        backgroundColor: primarySlot.backgroundColor ?? 'transparent',
        borderColor: primarySlot.borderColor ?? '#000000',
        borderWidth: primarySlot.borderWidth ?? 0,
        paddingTop: primarySlot.paddingTop ?? 0,
        paddingRight: primarySlot.paddingRight ?? 0,
        paddingBottom: primarySlot.paddingBottom ?? 0,
        paddingLeft: primarySlot.paddingLeft ?? 0,
        textAlign: primarySlot.textAlign ?? 'center',
        fontFamily: primarySlot.fontFamily ?? 'Arial',
        defaultFontSize: primarySlot.defaultFontSize ?? 24,
        color: primarySlot.color ?? '#000000',
        perLetterFontSizes,
        perLetterOffsets,
      },
    };
  }, [ticketRegion, seriesSlots]);

  const handlePdfRendered = useCallback((canvas: HTMLCanvasElement, width: number, height: number) => {
    setPdfCanvas(canvas);
    setPdfDimensions({ width, height });

    // Get actual displayed size (guard for getBoundingClientRect)
    try {
      const rect = canvas.getBoundingClientRect();
      setDisplayedPdfSize({ width: rect.width || width, height: rect.height || height });
    } catch {
      setDisplayedPdfSize({ width, height });
    }
  }, []);

  const handleRegionsDetected = useCallback((regions: DetectedRegion[]) => {
    if (regions.length > 0 && !ticketRegion) {
      setTicketRegion(regions[0]);
      toast.success('Ticket area detected. You can adjust the selection.');
    }
    // if user already set region, don't override
  }, [ticketRegion]);

  // Increment series - preserve spaces and other characters
  const incrementSeries = useCallback((value: string, increment: number): string => {
    const match = value.match(/^(.*?)(\d+)$/);
    if (match) {
      const [, prefix, numStr] = match;
      const num = parseInt(numStr, 10);
      const endNum = num + increment;
      return `${prefix}${endNum.toString().padStart(numStr.length, '0')}`;
    }
    return value;
  }, []);

  const handleAddSeriesSlot = useCallback(() => {
    const letterStyles: LetterStyle[] = startingSeries.split('').map(() => ({
      fontSize: 24,
      offsetY: 0,
      spacingAfterX: 0,
    }));

    // Position relative to the detected ticket region (fallback safe values)
    const fallbackX = 50;
    const fallbackY = 30;
    const fallbackWidth = 20;
    const fallbackHeight = 8;

    const newSlot: SeriesSlotData = {
      id: Date.now().toString(),
      x: ticketRegion ? ticketRegion.x + (ticketRegion.width * 0.6) : fallbackX,
      y: ticketRegion ? ticketRegion.y + (ticketRegion.height * 0.4) : fallbackY,
      width: ticketRegion ? (fallbackWidth) : fallbackWidth,
      height: ticketRegion ? (fallbackHeight) : fallbackHeight,
      value: startingSeries,
      startingSeries: startingSeries,
      seriesIncrement: 1,
      letterStyles,
      defaultFontSize: 24,
      fontFamily: 'Arial',
      color: '#000000',
      rotation: 0,
      backgroundColor: 'transparent',
      borderColor: '#10b981',
      borderWidth: 0,
      borderRadius: 4,
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 8,
      paddingRight: 8,
      textAlign: 'center',
    };

    setSeriesSlots((prev) => [...prev, newSlot]);
    setSelectedSlotId(newSlot.id);
    toast.success('Series slot added. Drag to position on ticket.');
  }, [startingSeries, ticketRegion]);

  const handleDeleteSeriesSlot = useCallback(() => {
    setSeriesSlots((prev) => {
      if (prev.length === 0) return prev;
      if (!selectedSlotId) {
        const [, ...rest] = prev;
        return rest;
      }
      return prev.filter((slot) => slot.id !== selectedSlotId);
    });

    setSelectedSlotId((prevSelectedId) => {
      const remaining = seriesSlots.filter((slot) => slot.id !== prevSelectedId);
      return remaining.length > 0 ? remaining[0].id : null;
    });

    setOutputPages([]);
    toast.success('Series slot deleted');
  }, [seriesSlots, selectedSlotId]);

  const handleUpdateSlot = useCallback((updates: Partial<SeriesSlotData>) => {
    if (!selectedSlotId) return;

    setSeriesSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== selectedSlotId) return slot;

        const updated: SeriesSlotData = { ...slot, ...updates };

        if (updates.value && updates.value !== slot.value) {
          const newLength = updates.value.length;
          const currentStyles = slot.letterStyles || [];

          const newLetterStyles: LetterStyle[] = [];
          for (let i = 0; i < newLength; i++) {
            newLetterStyles.push(currentStyles[i] || { fontSize: slot.defaultFontSize, offsetY: 0, spacingAfterX: 0 });
          }
          updated.letterStyles = newLetterStyles;
          // Keep startingSeries in sync with the slot value the user is editing
          setStartingSeries(updates.value);
        }

        return updated;
      })
    );
  }, [selectedSlotId]);

  const handleUpdateLetterSpacingAfterX = useCallback((index: number, spacingAfterX: number) => {
    if (!selectedSlotId) return;

    setSeriesSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== selectedSlotId) return slot;

        const newLetterStyles = [...(slot.letterStyles || [])];
        newLetterStyles[index] = { ...newLetterStyles[index], spacingAfterX };
        return { ...slot, letterStyles: newLetterStyles };
      })
    );
  }, [selectedSlotId]);

  const handleUpdateLetterFontSize = useCallback((index: number, fontSize: number) => {
    if (!selectedSlotId) return;

    setSeriesSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== selectedSlotId) return slot;

        const newLetterStyles = [...(slot.letterStyles || [])];
        newLetterStyles[index] = { ...newLetterStyles[index], fontSize };

        return { ...slot, letterStyles: newLetterStyles };
      })
    );
  }, [selectedSlotId]);

  const handleUpdateLetterOffset = useCallback((index: number, offsetY: number) => {
    if (!selectedSlotId) return;

    setSeriesSlots((prev) =>
      prev.map((slot) => {
        if (slot.id !== selectedSlotId) return slot;

        const newLetterStyles = [...(slot.letterStyles || [])];
        newLetterStyles[index] = { ...newLetterStyles[index], offsetY };

        return { ...slot, letterStyles: newLetterStyles };
      })
    );
  }, [selectedSlotId]);

  // Series slot drag handling
  const handleDragStart = useCallback((e: React.MouseEvent, slot: SeriesSlotData) => {
    e.preventDefault();

    setSelectedSlotId(slot.id);
    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      slotX: slot.x,
      slotY: slot.y,
    });
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, corner: string, slot: SeriesSlotData) => {
    e.preventDefault();
    e.stopPropagation();

    setSelectedSlotId(slot.id);
    setIsResizing(corner);
    setResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: slot.width,
      height: slot.height,
      slotX: slot.x,
      slotY: slot.y,
    });
  }, []);

  // Ticket region drag/resize handlers
  const handleRegionDragStart = useCallback((e: React.MouseEvent) => {
    if (!ticketRegion) return;
    e.preventDefault();
    e.stopPropagation();

    setIsRegionDragging(true);
    setRegionDragStart({
      x: e.clientX,
      y: e.clientY,
      regionX: ticketRegion.x,
      regionY: ticketRegion.y,
    });
  }, [ticketRegion]);

  const handleRegionResizeStart = useCallback((e: React.MouseEvent, corner: string) => {
    if (!ticketRegion) return;
    e.preventDefault();
    e.stopPropagation();

    setIsRegionResizing(corner);
    setRegionResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: ticketRegion.width,
      height: ticketRegion.height,
      regionX: ticketRegion.x,
      regionY: ticketRegion.y,
    });
  }, [ticketRegion]);

  const handleOverlayDragStart = useCallback((e: React.MouseEvent) => {
    if (!overlayImage || displayedPdfSize.width === 0) return;
    e.preventDefault();
    e.stopPropagation();

    setIsOverlayDragging(true);
    setOverlayDragStart({
      x: e.clientX,
      y: e.clientY,
      startX: overlayImagePosition.x,
      startY: overlayImagePosition.y,
    });
  }, [overlayImage, overlayImagePosition, displayedPdfSize.width]);

  const handleOverlayResizeStart = useCallback((e: React.MouseEvent) => {
    if (!overlayImage || displayedPdfSize.width === 0) return;
    e.preventDefault();
    e.stopPropagation();

    setIsOverlayResizing(true);
    setOverlayResizeStart({
      x: e.clientX,
      y: e.clientY,
      width: overlayImagePosition.width,
    });
  }, [overlayImage, overlayImagePosition.width, displayedPdfSize.width]);

  const handleOverlayWheel = useCallback((e: React.WheelEvent) => {
    if (!overlayImage) return;
    e.preventDefault();
    e.stopPropagation();

    const delta = e.deltaY > 0 ? -2 : 2;
    setOverlayImagePosition((prev) => {
      const newWidth = Math.max(5, Math.min(80, prev.width + delta));
      return { ...prev, width: newWidth };
    });
  }, [overlayImage]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (displayedPdfSize.width === 0) return;

    // Handle series slot drag - use displayed size for accurate positioning
    if (isDragging && selectedSlotId) {
      const dx = ((e.clientX - dragStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - dragStart.y) / displayedPdfSize.height) * 100;

      setSeriesSlots((prev) =>
        prev.map((slot) => {
          if (slot.id !== selectedSlotId) return slot;

          const newX = Math.max(0, Math.min(100 - slot.width, dragStart.slotX + dx));
          const newY = Math.max(0, Math.min(100 - slot.height, dragStart.slotY + dy));

          return { ...slot, x: newX, y: newY };
        })
      );
    }

    // Handle series slot resize
    if (isResizing && selectedSlotId) {
      const dx = ((e.clientX - resizeStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - resizeStart.y) / displayedPdfSize.height) * 100;

      const targetSlot = seriesSlots.find((s) => s.id === selectedSlotId);
      if (!targetSlot) return;

      let newWidth = resizeStart.width;
      let newHeight = resizeStart.height;
      let newX = resizeStart.slotX;
      let newY = resizeStart.slotY;

      if (isResizing.includes('e')) newWidth = Math.max(5, resizeStart.width + dx);
      if (isResizing.includes('w')) {
        const widthChange = Math.min(dx, resizeStart.width - 5);
        newWidth = resizeStart.width - widthChange;
        newX = resizeStart.slotX + widthChange;
      }

      if (isResizing.includes('s')) newHeight = Math.max(3, resizeStart.height + dy);
      if (isResizing.includes('n')) {
        const heightChange = Math.min(dy, resizeStart.height - 3);
        newHeight = resizeStart.height - heightChange;
        newY = resizeStart.slotY + heightChange;
      }

      const clampedWidth = Math.max(5, Math.min(100, newWidth));
      const clampedHeight = Math.max(3, Math.min(100, newHeight));
      const clampedX = Math.max(0, Math.min(100 - clampedWidth, newX));
      const clampedY = Math.max(0, Math.min(100 - clampedHeight, newY));

      setSeriesSlots((prev) =>
        prev.map((slot) => {
          if (slot.id !== selectedSlotId) return slot;
          return { ...slot, x: clampedX, y: clampedY, width: clampedWidth, height: clampedHeight };
        })
      );
    }

    // Handle ticket region drag
    if (isRegionDragging && ticketRegion) {
      const dx = ((e.clientX - regionDragStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - regionDragStart.y) / displayedPdfSize.height) * 100;

      const newX = Math.max(0, Math.min(100 - ticketRegion.width, regionDragStart.regionX + dx));
      const newY = Math.max(0, Math.min(100 - ticketRegion.height, regionDragStart.regionY + dy));

      setTicketRegion({ ...ticketRegion, x: newX, y: newY });
    }

    // Handle ticket region resize
    if (isRegionResizing && ticketRegion) {
      const dx = ((e.clientX - regionResizeStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - regionResizeStart.y) / displayedPdfSize.height) * 100;

      let newWidth = regionResizeStart.width;
      let newHeight = regionResizeStart.height;
      let newX = regionResizeStart.regionX;
      let newY = regionResizeStart.regionY;

      if (isRegionResizing.includes('e')) newWidth = Math.max(10, regionResizeStart.width + dx);
      if (isRegionResizing.includes('w')) {
        const widthChange = Math.min(dx, regionResizeStart.width - 10);
        newWidth = regionResizeStart.width - widthChange;
        newX = regionResizeStart.regionX + widthChange;
      }

      if (isRegionResizing.includes('s')) newHeight = Math.max(10, regionResizeStart.height + dy);
      if (isRegionResizing.includes('n')) {
        const heightChange = Math.min(dy, regionResizeStart.height - 10);
        newHeight = regionResizeStart.height - heightChange;
        newY = regionResizeStart.regionY + heightChange;
      }

      setTicketRegion({ ...ticketRegion, x: newX, y: newY, width: newWidth, height: newHeight });
    }

    // Handle overlay image drag
    if (isOverlayDragging && overlayImage) {
      const dx = ((e.clientX - overlayDragStart.x) / displayedPdfSize.width) * 100;
      const dy = ((e.clientY - overlayDragStart.y) / displayedPdfSize.height) * 100;

      const newX = Math.max(0, Math.min(100 - overlayImagePosition.width, overlayDragStart.startX + dx));
      const newY = Math.max(0, Math.min(100, overlayDragStart.startY + dy));

      setOverlayImagePosition((prev) => ({ ...prev, x: newX, y: newY }));
    }

    // Handle overlay image resize (width only)
    if (isOverlayResizing && overlayImage) {
      const dx = ((e.clientX - overlayResizeStart.x) / displayedPdfSize.width) * 100;
      const newWidth = Math.max(5, Math.min(80, overlayResizeStart.width + dx));
      setOverlayImagePosition((prev) => ({ ...prev, width: newWidth }));
    }
  }, [
    displayedPdfSize,
    isDragging,
    selectedSlotId,
    dragStart,
    isResizing,
    resizeStart,
    seriesSlots,
    isRegionDragging,
    ticketRegion,
    regionDragStart,
    isRegionResizing,
    regionResizeStart,
    isOverlayDragging,
    overlayImage,
    overlayImagePosition,
    overlayDragStart,
    isOverlayResizing,
    overlayResizeStart,
  ]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(null);
    setIsRegionDragging(false);
    setIsRegionResizing(null);
    setIsOverlayDragging(false);
    setIsOverlayResizing(false);
  }, []);

  const handleGenerateOutput = useCallback(async () => {
    if (!pdfCanvas) {
      safeToast('No PDF canvas available');
      return;
    }
    if (!ticketRegion) {
      safeToast('Please select a ticket region first');
      return;
    }

    setIsGenerating(true);

    try {
      // Crop only the selected ticket region from the full PDF canvas
      const sourceWidth = pdfCanvas.width;
      const sourceHeight = pdfCanvas.height;

      const cropX = Math.round((ticketRegion.x / 100) * sourceWidth);
      const cropY = Math.round((ticketRegion.y / 100) * sourceHeight);
      const cropWidth = Math.round((ticketRegion.width / 100) * sourceWidth);
      const cropHeight = Math.round((ticketRegion.height / 100) * sourceHeight);

      const ticketCanvas = document.createElement('canvas');
      ticketCanvas.width = Math.max(1, cropWidth);
      ticketCanvas.height = Math.max(1, cropHeight);

      const ticketCtx = ticketCanvas.getContext('2d');
      if (!ticketCtx) {
        safeToast('Failed to prepare ticket canvas');
        setIsGenerating(false);
        return;
      }

      ticketCtx.drawImage(
        pdfCanvas,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight
      );

      // Composite overlay image (logo/SVG) onto the ticket canvas so it appears in print
      if (overlayImage) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              // overlayImagePosition is relative to full page; convert to ticket-relative
              const relX = (overlayImagePosition.x - ticketRegion.x) / ticketRegion.width;
              const relY = (overlayImagePosition.y - ticketRegion.y) / ticketRegion.height;
              const relWidth = overlayImagePosition.width / ticketRegion.width;

              const drawX = relX * ticketCanvas.width;
              const drawY = relY * ticketCanvas.height;
              const drawWidth = relWidth * ticketCanvas.width;
              const aspect = img.width > 0 ? img.height / img.width : 1;
              const drawHeight = drawWidth * aspect;

              ticketCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
            } catch (err) {
              // keep going; overlay is optional
              // eslint-disable-next-line no-console
              console.error('Error drawing overlay image on ticket canvas:', err);
            }
            resolve();
          };
          img.onerror = () => {
            // eslint-disable-next-line no-console
            console.error('Failed to load overlay image for compositing');
            resolve();
          };
          img.src = overlayImage;
        });
      }

      const ticketImageData = ticketCanvas.toDataURL('image/png', 1.0);
      const ticketImageSize = { width: ticketCanvas.width, height: ticketCanvas.height };

      const sourceAspectRatio = ticketImageSize.width > 0 && ticketImageSize.height > 0 ? ticketImageSize.width / ticketImageSize.height : null;

      let finalTicketImageRect = {
        x: ticketImageXPercent,
        y: ticketImageYPercent,
        width: ticketImageWidthPercent,
        height: ticketImageHeightPercent,
      };

      if (ticketImageLockAspect && sourceAspectRatio) {
        const widthMm = (finalTicketImageRect.width / 100) * A4_WIDTH_MM;
        const heightMm = widthMm / sourceAspectRatio;
        finalTicketImageRect.height = (heightMm / TICKET_HEIGHT_MM) * 100;

        const fitted = fitLockedAspectToBounds({ width: finalTicketImageRect.width, height: finalTicketImageRect.height });
        finalTicketImageRect.width = fitted.width;
        finalTicketImageRect.height = fitted.height;
      }

      finalTicketImageRect = clampTicketImageRect(finalTicketImageRect);

      // Keep UI state in sync with what we embed into generated pages
      setTicketImageXPercent(finalTicketImageRect.x);
      setTicketImageYPercent(finalTicketImageRect.y);
      setTicketImageWidthPercent(finalTicketImageRect.width);
      setTicketImageHeightPercent(finalTicketImageRect.height);

      // Calculate total tickets and pages (4 tickets per page)
      const totalTickets = totalPages * 4;
      const pages: TicketOutputPage[] = [];

      // Use the first slot as the primary for range display only.
      const primarySlot = seriesSlots[0];
      const primaryBaseSeries = primarySlot?.startingSeries || primarySlot?.value || startingSeries;

      for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
        const tickets: TicketOnPage[] = [];

        // Top-to-bottom ordering: ticketIdx 0..3 is the visual order on the page.
        for (let ticketIdx = 0; ticketIdx < 4; ticketIdx++) {
          const globalIdx = pageIdx * 4 + ticketIdx;

          const seriesBySlot: TicketOnPage['seriesBySlot'] = {};

          seriesSlots.forEach((slot) => {
            // Each slot uses its own fully independent base series and increment.
            const slotBaseSeries = slot.startingSeries || slot.value || startingSeries;
            const inc = slot.seriesIncrement ?? 1;
            const seriesValue = incrementSeries(slotBaseSeries, globalIdx * inc);

            const letterStyles = seriesValue.split('').map((letter, idx) => {
              const baseStyle = slot.letterStyles?.[idx];
              return baseStyle
                ? { fontSize: baseStyle.fontSize, offsetY: baseStyle.offsetY ?? 0, spacingAfterX: baseStyle.spacingAfterX ?? 0 }
                : { fontSize: slot.defaultFontSize, offsetY: 0, spacingAfterX: 0 };
            });

            seriesBySlot[slot.id] = { seriesValue, letterStyles };
          });

          tickets.push({ seriesBySlot });
        }

        // Convert the series slots to be relative to the ticket region (0-100)
        const ticketRelativeSlots = seriesSlots.map((slot) => ({
          ...slot,
          x: ((slot.x - ticketRegion.x) / ticketRegion.width) * 100,
          y: ((slot.y - ticketRegion.y) / ticketRegion.height) * 100,
          width: (slot.width / ticketRegion.width) * 100,
          height: (slot.height / ticketRegion.height) * 100,
        })) as SeriesSlotData[];

        pages.push({
          pageNumber: pageIdx + 1,
          layoutMode: 'raster',
          ticketImageData,
          ticketImageSize,
          ticketImageXPercent: finalTicketImageRect.x,
          ticketImageYPercent: finalTicketImageRect.y,
          ticketImageWidthPercent: finalTicketImageRect.width,
          ticketImageHeightPercent: finalTicketImageRect.height,
          // Ticket region is now the full cropped ticket image
          ticketRegion: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
          },
          seriesSlots: ticketRelativeSlots,
          tickets,
        });
      }

      setOutputPages(pages);
      const endSeries = incrementSeries(primaryBaseSeries, totalTickets - 1);
      toast.success(`Generated ${pages.length} pages, ${totalTickets} tickets (${primaryBaseSeries} → ${endSeries})`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error generating output:', err);
      safeToast('Failed to generate output');
    } finally {
      setIsGenerating(false);
    }
  }, [
    pdfCanvas,
    ticketRegion,
    overlayImage,
    seriesSlots,
    startingSeries,
    totalPages,
    incrementSeries,
    ticketImageHeightPercent,
    ticketImageLockAspect,
    ticketImageWidthPercent,
    ticketImageXPercent,
    ticketImageYPercent,
    clampTicketImageRect,
    fitLockedAspectToBounds,
  ]);

  const handleShowPreview = useCallback(() => {
    setShowPreview(true);
  }, []);

  const handleUploadFont = useCallback((file: File | null) => {
    if (!file) return;

    const allowedTypes = [
      'font/ttf',
      'font/otf',
      'font/woff',
      'font/woff2',
      'application/x-font-ttf',
      'application/x-font-otf',
      'application/font-woff',
      'application/font-woff2',
    ];

    if (!allowedTypes.includes(file.type) && !/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/.test(file.name)) {
      safeToast('Upload a valid font file (.ttf, .otf, .woff, .woff2)');
      return;
    }

    console.log('File object:', file, 'type:', typeof file, 'name type:', typeof file.name);
    const safeFileName = typeof file.name === 'string' ? file.name : String(file.name);
    const fontFamilyName = safeFileName.replace(/\.[^.]+$/, '') || 'Custom Font';
    console.log('Font family name:', fontFamilyName);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const dataUrl = typeof e.target?.result === 'string' ? e.target.result : null;
        if (!dataUrl) {
          safeToast('Failed to read font file');
          return;
        }

        const fontFace = new (window as any).FontFace(fontFamilyName, `url(${dataUrl})`);
        const loaded = await fontFace.load();
        (document as any).fonts.add(loaded);

        setCustomFonts((prev) => {
          if (prev.some((f) => f.family === fontFamilyName)) return prev;
          return [...prev, { family: fontFamilyName, dataUrl }];
        });

        toast.success(`Font "${fontFamilyName}" added`);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error loading font:', error);
        safeToast('Failed to load font');
      }
    };

    reader.readAsDataURL(file);
  }, []);

  const handleUploadImage = useCallback((file: File | null) => {
    if (!file) return;

    const allowedTypes = ['image/svg+xml', 'image/png', 'image/jpeg'];

    const lowered = file.name.toLowerCase();
    if (!allowedTypes.includes(file.type) && !/(\.svg|\.png|\.jpe?g)$/.test(lowered)) {
      safeToast('Upload SVG, PNG, or JPG image');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = typeof e.target?.result === 'string' ? e.target.result : null;
      if (!result) {
        safeToast('Failed to read image file');
        return;
      }
      setOverlayImage(result);
      setOverlayImagePosition({ x: 5, y: 5, width: 20 });
      toast.success('Image added on ticket');
    };
    reader.readAsDataURL(file);
  }, []);

  if (!pdfUrl) {
    return (
      <div className="flex h-full bg-background">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-24 h-32 mx-auto mb-4 rounded border-2 border-dashed border-border flex items-center justify-center">
              <span className="text-4xl text-muted-foreground">📄</span>
            </div>
            <p className="text-sm text-muted-foreground">Upload a PDF or SVG to start editing</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full bg-background">
        {/* Left Toolbar */}
        <TicketToolbar
          hasSeriesSlot={seriesSlots.length > 0}
          startingSeries={startingSeries}
          endingSeries={endingSeries}
          totalPages={totalPages}
          isGenerating={isGenerating}
          hasOutput={outputPages.length > 0}
          cutMarginMm={cutMarginMm}
          ticketImageXmm={xPercentToMm(ticketImageXPercent)}
          ticketImageYmm={yPercentToMm(ticketImageYPercent)}
          ticketImageWidthMm={xPercentToMm(ticketImageWidthPercent)}
          ticketImageHeightMm={yPercentToMm(ticketImageHeightPercent)}
          ticketImageLockAspect={ticketImageLockAspect}
          onAddSeriesSlot={handleAddSeriesSlot}
          onDeleteSeriesSlot={handleDeleteSeriesSlot}
          onStartingSeriesChange={setStartingSeries}
          onTotalPagesChange={setTotalPages}
          onGenerateOutput={handleGenerateOutput}
          onShowPreview={handleShowPreview}
          onCutMarginMmChange={handleCutMarginMmChange}
          onTicketImageAlign={handleTicketImageAlign}
          onTicketImageMoveMm={handleTicketImageMoveMm}
          onTicketImageXmmChange={handleTicketImageXmmChange}
          onTicketImageYmmChange={handleTicketImageYmmChange}
          onTicketImageWidthMmChange={handleTicketImageWidthMmChange}
          onTicketImageHeightMmChange={handleTicketImageHeightMmChange}
          onTicketImageLockAspectChange={(v) => {
            setTicketImageLockAspect(v);
            if (v) {
              const ar = getCurrentTicketImageAspectRatio();
              if (ar) updateTicketImageRect({ width: ticketImageWidthPercent, sourceAspectRatio: ar });
            }
          }}
          onUploadFont={(f: File) => handleUploadFont(f)}
          onUploadImage={(f: File) => handleUploadImage(f)}
        />

        {/* Center - PDF Canvas */}
        <div
          ref={containerRef}
          className="flex-1 min-h-0 p-4 relative overflow-auto bg-muted/30 flex items-start justify-center"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <PDFCanvasViewer
            pdfUrl={pdfUrl}
            fileType={fileType}
            onPdfRendered={handlePdfRendered}
            onRegionDetected={handleRegionsDetected}
          >
            {/* Detected/Adjustable Ticket Region */}
            {ticketRegion && displayedPdfSize.width > 0 && (
              <div
                className="absolute border-2 border-dashed border-blue-500 cursor-move bg-blue-500/5"
                style={{
                  left: `${ticketRegion.x}%`,
                  top: `${ticketRegion.y}%`,
                  width: `${ticketRegion.width}%`,
                  height: `${ticketRegion.height}%`,
                }}
                onMouseDown={handleRegionDragStart}
              >
                <span className="absolute -top-6 left-0 text-[10px] bg-blue-500 text-white px-2 py-0.5 rounded whitespace-nowrap">
                  Ticket Area (drag to adjust)
                </span>

                {/* Resize handles for ticket region */}
                {['nw', 'ne', 'sw', 'se'].map((corner) => (
                  <div
                    key={corner}
                    className="absolute w-3 h-3 bg-blue-500 rounded-full cursor-pointer"
                    style={{
                      top: corner.includes('n') ? -6 : 'auto',
                      bottom: corner.includes('s') ? -6 : 'auto',
                      left: corner.includes('w') ? -6 : 'auto',
                      right: corner.includes('e') ? -6 : 'auto',
                    }}
                    onMouseDown={(e) => handleRegionResizeStart(e, corner)}
                  />
                ))}
              </div>
            )}

            {/* Series Slots */}
            {seriesSlots.length > 0 && displayedPdfSize.width > 0 && (
              <>
                {seriesSlots.map((slot) => (
                  <SeriesSlot
                    key={slot.id}
                    slot={slot}
                    isSelected={selectedSlotId === slot.id}
                    containerWidth={displayedPdfSize.width}
                    containerHeight={displayedPdfSize.height}
                    onSelect={() => setSelectedSlotId(slot.id)}
                    onDragStart={(e) => handleDragStart(e, slot)}
                    onValueChange={(value: string) => {
                      setSelectedSlotId(slot.id);
                      handleUpdateSlot({ value });
                    }}
                    onResizeStart={(e, corner) => handleResizeStart(e, corner, slot)}
                  />
                ))}
              </>
            )}

            {overlayImage && displayedPdfSize.width > 0 && (
              <div
                className="absolute group"
                style={{
                  left: `${overlayImagePosition.x}%`,
                  top: `${overlayImagePosition.y}%`,
                  width: `${overlayImagePosition.width}%`,
                }}
              >
                <img
                  src={overlayImage}
                  alt="Overlay"
                  className="w-full h-auto select-none cursor-move"
                  onMouseDown={handleOverlayDragStart}
                  onWheel={handleOverlayWheel}
                />
                {/* Resize handle for overlay image (bottom-right) */}
                <div
                  className="absolute -right-2 -bottom-2 w-4 h-4 bg-primary rounded-full cursor-se-resize shadow-md border-2 border-background opacity-0 group-hover:opacity-100 transition-opacity"
                  onMouseDown={handleOverlayResizeStart}
                />
              </div>
            )}
          </PDFCanvasViewer>
        </div>

        {/* Right Properties Panel */}
        <TicketPropertiesPanel
          slot={seriesSlots.find((s) => s.id === selectedSlotId) || null}
          availableFonts={[...DEFAULT_FONT_FAMILIES, ...customFonts.map((f) => f.family)]}
          onUpdateSlot={handleUpdateSlot}
          onUpdateLetterFontSize={handleUpdateLetterFontSize}
          onUpdateLetterOffset={handleUpdateLetterOffset}
          onUpdateLetterSpacingAfterX={handleUpdateLetterSpacingAfterX}
        />
      </div>

      {/* Output Preview */}
      {showPreview && (
        <TicketOutputPreview
          pages={outputPages}
          customFonts={customFonts}
          onClose={() => setShowPreview(false)}
          documentId={documentId}
        />
      )}
    </>
  );
};

export default TicketEditor;
