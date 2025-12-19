import React, { useRef, useState } from 'react';
import { X, Printer, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { safeToast } from '@/lib/safeToast';
import { BACKEND_URL } from '@/lib/backendUrl';

import type { TicketOutputPage, TicketOnPage } from './TicketEditor';

interface TicketOutputPreviewProps {
  pages: TicketOutputPage[];
  onClose: () => void;
  customFonts?: { family: string; dataUrl: string }[];
  documentId?: string;
}

// Feature flag: keep vector layout code present but inactive for now.
// When enabling vector jobs end-to-end, this can be toggled to true and
// the assign-to-user flow can switch from raster to vector layouts.
const USE_VECTOR_LAYOUT =
  (import.meta as any)?.env?.VITE_ENABLE_VECTOR_LAYOUT === '1' ||
  (import.meta as any)?.env?.VITE_ENABLE_VECTOR_LAYOUT === 'true';

// Vector layout types (not yet wired into the live flow)
type VectorPageItem =
  | {
      kind: 'svgTemplate';
      templateKey: string; // e.g. 's3://securepdf/xyz.svg'
      ticketRegion: {
        xPercent: number;
        yPercent: number;
        widthPercent: number;
        heightPercent: number;
      };
    }
  | {
      kind: 'svgOverlay';
      svgMarkup: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: 'text';
      text: string;
      x: number;
      y: number;
      fontSize: number;
      letterFontSizes?: number[];
      letterOffsets?: number[];
      letterSpacingAfterX?: number[];
      fontFamily?: string;
      color?: string;
    };

interface VectorLayoutPage {
  layoutMode: 'vector';
  items: VectorPageItem[];
}

// A4 dimensions
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const A4_FOOTER_PX = 0;
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

function computeFittedImageRectPx(
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  imageW: number,
  imageH: number
) {
  if (!boxW || !boxH || !imageW || !imageH) {
    return { x: boxX, y: boxY, width: boxW, height: boxH };
  }

  const scale = Math.min(boxW / imageW, boxH / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  const x = boxX;
  const y = boxY;

  return { x, y, width, height };
}

function computeFittedImageRectPercent(
  boxXPercent: number,
  boxYPercent: number,
  boxWPercent: number,
  boxHPercent: number,
  imageW: number,
  imageH: number
) {
  if (!boxWPercent || !boxHPercent || !imageW || !imageH) {
    return { x: boxXPercent, y: boxYPercent, width: boxWPercent, height: boxHPercent };
  }

  const boxAR = boxWPercent / boxHPercent;
  const imageAR = imageW / imageH;

  if (imageAR >= boxAR) {
    const width = boxWPercent;
    const height = boxWPercent / imageAR;
    const x = boxXPercent;
    const y = boxYPercent;
    return { x, y, width, height };
  }

  const height = boxHPercent;
  const width = boxHPercent * imageAR;
  const y = boxYPercent;
  const x = boxXPercent;
  return { x, y, width, height };
}

function mapSlotToFittedPx(
  slotRelativeX: number,
  slotRelativeY: number,
  slotRelativeWidth: number,
  slotRelativeHeight: number,
  fitted: { x: number; y: number; width: number; height: number }
) {
  return {
    x: fitted.x + (slotRelativeX / 100) * fitted.width,
    y: fitted.y + (slotRelativeY / 100) * fitted.height,
    width: (slotRelativeWidth / 100) * fitted.width,
    height: (slotRelativeHeight / 100) * fitted.height,
  };
}

function mapSlotToFittedPercent(
  slotRelativeX: number,
  slotRelativeY: number,
  slotRelativeWidth: number,
  slotRelativeHeight: number,
  fitted: { x: number; y: number; width: number; height: number }
) {
  return {
    x: fitted.x + (slotRelativeX / 100) * fitted.width,
    y: fitted.y + (slotRelativeY / 100) * fitted.height,
    width: (slotRelativeWidth / 100) * fitted.width,
    height: (slotRelativeHeight / 100) * fitted.height,
  };
}

function computeSeriesSlotRelative(page: TicketOutputPage, slot: TicketOutputPage['seriesSlots'][number]) {
  const slotRelativeWidth = (slot.width / page.ticketRegion.width) * 100;
  const slotRelativeHeight = (slot.height / page.ticketRegion.height) * 100;

  let slotRelativeX = ((slot.x - page.ticketRegion.x) / page.ticketRegion.width) * 100;
  let slotRelativeY = ((slot.y - page.ticketRegion.y) / page.ticketRegion.height) * 100;

  slotRelativeX = Math.min(100 - slotRelativeWidth, Math.max(0, slotRelativeX));
  slotRelativeY = Math.min(100 - slotRelativeHeight, Math.max(0, slotRelativeY));

  return {
    slotRelativeX,
    slotRelativeY,
    slotRelativeWidth,
    slotRelativeHeight,
  };
}

function computeTicketFittedRectPx(page: TicketOutputPage, ticketHeightPx: number) {
  const srcW = page.ticketImageSize?.width || A4_WIDTH_PX;
  const srcH = page.ticketImageSize?.height || ticketHeightPx;

  const boxX = (page.ticketImageXPercent / 100) * A4_WIDTH_PX;
  const boxY = (page.ticketImageYPercent / 100) * ticketHeightPx;
  const boxW = (page.ticketImageWidthPercent / 100) * A4_WIDTH_PX;
  const boxH = (page.ticketImageHeightPercent / 100) * ticketHeightPx;

  return computeFittedImageRectPx(boxX, boxY, boxW, boxH, srcW, srcH);
}

function computeTicketFittedRectPercent(page: TicketOutputPage) {
  const srcW = page.ticketImageSize?.width || A4_WIDTH_PX;
  const srcH = page.ticketImageSize?.height || 1;

  return computeFittedImageRectPercent(
    page.ticketImageXPercent,
    page.ticketImageYPercent,
    page.ticketImageWidthPercent,
    page.ticketImageHeightPercent,
    srcW,
    srcH
  );
}

// Helper to build a vector-only layout description from the current TicketOutputPage[]
// NOTE: The backend still treats these as experimental until the worker/svg path is
// implemented. For now this only runs when USE_VECTOR_LAYOUT is true.
function buildVectorLayoutPages(
  pages: TicketOutputPage[],
  opts?: { documentId?: string }
): VectorLayoutPage[] {
  const ticketHeightPx = (A4_HEIGHT_PX - A4_FOOTER_PX) / 4;

  return pages.map((page) => {
    const items: VectorPageItem[] = [];

    // Base template reference for this page. We don't yet have the exact S3 key of
    // the uploaded SVG/PDF here on the frontend, so we use a logical identifier
    // based on the documentId and let the backend resolve it later.
    const templateKey = opts?.documentId ? `document:${opts.documentId}` : '';

    items.push({
      kind: 'svgTemplate',
      templateKey,
      ticketRegion: {
        xPercent: page.ticketRegion.x,
        yPercent: page.ticketRegion.y,
        widthPercent: page.ticketRegion.width,
        heightPercent: page.ticketRegion.height,
      },
    });

    // Add text items for each ticket and configured series slot, mirroring the
    // same positioning logic as the raster layout.
    page.tickets.forEach((ticket, idx) => {
      const baseY = ticketHeightPx * idx;

      const fittedTicket = computeTicketFittedRectPx(page, ticketHeightPx);

      page.seriesSlots.forEach((slot) => {
        const seriesForSlot = ticket.seriesBySlot[slot.id];
        if (!seriesForSlot) return;

        const { slotRelativeX, slotRelativeY } = computeSeriesSlotRelative(page, slot);

        const mapped = mapSlotToFittedPx(
          slotRelativeX,
          slotRelativeY,
          0,
          0,
          fittedTicket
        );

        const slotX = mapped.x;
        const slotY = baseY + mapped.y;
        const fontSize =
          seriesForSlot.letterStyles?.[0]?.fontSize || slot.defaultFontSize;

        items.push({
          kind: 'text',
          text: seriesForSlot.seriesValue,
          x: slotX,
          y: slotY + fontSize,
          fontSize,
          letterFontSizes: seriesForSlot.letterStyles?.map((ls) => ls.fontSize),
          letterOffsets: seriesForSlot.letterStyles?.map((ls) => ls.offsetY ?? 0),
          letterSpacingAfterX: seriesForSlot.letterStyles?.map((ls) => ls.spacingAfterX ?? 0),
          fontFamily: slot.fontFamily,
          color: slot.color,
        });
      });
    });

    return {
      layoutMode: 'vector',
      items,
    };
  });
}

export const TicketOutputPreview: React.FC<TicketOutputPreviewProps> = ({ pages, onClose, customFonts, documentId }) => {
  const [currentPage, setCurrentPage] = useState(0);
  const printContainerRef = useRef<HTMLDivElement>(null);
  const { user, token } = useAuth();

  const [assignEmail, setAssignEmail] = useState('');
  const [assignPages, setAssignPages] = useState('500');
  const [assignLoading, setAssignLoading] = useState(false);

  const totalTickets = pages.length * 4;

  const handleAssignToUser = async () => {
    if (!user || user.role !== 'ADMIN') return;

    if (!BACKEND_URL || !String(BACKEND_URL).trim()) {
      safeToast('Backend URL not configured');
      return;
    }

    if (!assignEmail || !assignPages) {
      safeToast('Email aur pages dono required hai');
      return;
    }

    const pagesNum = Number(assignPages);
    if (Number.isNaN(pagesNum) || pagesNum <= 0) {
      safeToast('Pages positive number hone chahiye');
      return;
    }

    try {
      setAssignLoading(true);
      if (!token) {
        safeToast('Missing auth token');
        return;
      }

      if (USE_VECTOR_LAYOUT) {
        const vectorLayoutPages = buildVectorLayoutPages(pages, { documentId });

        const res = await fetch(`${BACKEND_URL}/api/admin/assign-job`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email: assignEmail, assignedQuota: pagesNum, layoutPages: vectorLayoutPages }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const message = data.message || 'Assignment failed';
          throw new Error(message);
        }

        toast.custom(
          (id) => (
            <div
              className="rounded-lg border border-emerald-500/60 bg-background px-4 py-3 shadow-lg flex flex-col gap-1 text-sm max-w-sm"
              onClick={() => toast.dismiss(id)}
            >
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
                Assignment Started
              </span>
              <span className="text-foreground">
                {pagesNum} pages assignment queued for <span className="font-medium">{assignEmail}</span>.
              </span>
              <span className="text-[11px] text-muted-foreground">
                PDF background me generate ho raha hai. User login karke <span className="font-semibold">/printing</span> page par
                apne assigned prints dekh sakta hai jab job complete ho jaye.
              </span>
            </div>
          ),
          { duration: 4000 }
        );

        return;
      }

      // 1) Upload unique ticket images to backend so we only send S3 references in the job
      const uniqueImages = new Map<string, string>(); // base64 -> s3://key

      for (const page of pages) {
        const src = page.ticketImageData;
        if (!src || typeof src !== 'string') continue;
        if (!src.startsWith('data:image')) continue;
        if (uniqueImages.has(src)) continue;

        try {
          const uploadRes = await fetch(`${BACKEND_URL}/api/admin/upload-ticket-image`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ base64: src }),
          });

          const uploadData = await uploadRes.json().catch(() => ({}));

          if (!uploadRes.ok || !uploadData.key) {
            const message = uploadData.message || 'Failed to upload ticket image';
            throw new Error(message);
          }

          // Store as a lightweight s3:// reference (worker knows how to resolve this)
          uniqueImages.set(src, `s3://${uploadData.key}`);
        } catch (err) {
          console.error('Upload ticket image error:', err);
          throw err instanceof Error ? err : new Error('Failed to upload ticket image');
        }
      }

      // 2) Build lightweight layout JSON using only S3-based src values
      // We mirror the same 3-cars-per-page layout used in this preview, including series text and all series boxes.
      const ticketHeightPx = (A4_HEIGHT_PX - A4_FOOTER_PX) / 4;
      const layoutPages = pages.map((page) => {
        const s3Src = uniqueImages.get(page.ticketImageData) || '';

        const fittedTicket = computeTicketFittedRectPx(page, ticketHeightPx);

        const items: Array<
          | { type: 'image'; src: string; x: number; y: number; width: number; height: number }
          | {
              type: 'text';
              text: string;
              x: number;
              y: number;
              fontSize: number;
              letterFontSizes?: number[];
              letterOffsets?: number[];
              letterSpacingAfterX?: number[];
              fontFamily?: string;
              color?: string;
            }
        > = [];

        page.tickets.forEach((ticket, idx) => {
          const baseY = ticketHeightPx * idx;

          // Ticket image area
          items.push({
            type: 'image',
            src: s3Src,
            x: fittedTicket.x,
            y: baseY + fittedTicket.y,
            width: fittedTicket.width,
            height: fittedTicket.height,
          });

          // Series number text for each configured slot on this ticket
          page.seriesSlots.forEach((slot) => {
            const seriesForSlot = ticket.seriesBySlot[slot.id];
            if (!seriesForSlot) return;

            const { slotRelativeX, slotRelativeY } = computeSeriesSlotRelative(page, slot);

            const mapped = mapSlotToFittedPx(
              slotRelativeX,
              slotRelativeY,
              0,
              0,
              fittedTicket
            );

            const slotX = mapped.x;
            const slotY = baseY + mapped.y;
            const fontSize =
              seriesForSlot.letterStyles?.[0]?.fontSize || slot.defaultFontSize;

            items.push({
              type: 'text',
              text: seriesForSlot.seriesValue,
              x: slotX,
              y: slotY + fontSize,
              fontSize,
              letterFontSizes: seriesForSlot.letterStyles?.map((ls) => ls.fontSize),
              letterOffsets: seriesForSlot.letterStyles?.map((ls) => ls.offsetY ?? 0),
              letterSpacingAfterX: seriesForSlot.letterStyles?.map((ls) => ls.spacingAfterX ?? 0),
              fontFamily: slot.fontFamily,
              color: slot.color,
            });
          });
        });

        return { layoutMode: 'raster' as const, items };
      });

      // 3) Create background assignment job (no synchronous PDF generation, only S3 references)
      const res = await fetch(`${BACKEND_URL}/api/admin/assign-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: assignEmail, assignedQuota: pagesNum, layoutPages }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message = data.message || 'Assignment failed';
        throw new Error(message);
      }

      toast.custom(
        (id) => (
          <div
            className="rounded-lg border border-emerald-500/60 bg-background px-4 py-3 shadow-lg flex flex-col gap-1 text-sm max-w-sm"
            onClick={() => toast.dismiss(id)}
          >
            <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wide">
              Assignment Started
            </span>
            <span className="text-foreground">
              {pagesNum} pages assignment queued for <span className="font-medium">{assignEmail}</span>.
            </span>
            <span className="text-[11px] text-muted-foreground">
              PDF background me generate ho raha hai. User login karke <span className="font-semibold">/printing</span> page par
              apne assigned prints dekh sakta hai jab job complete ho jaye.
            </span>
          </div>
        ),
        { duration: 4000 }
      );
    } catch (err) {
      console.error('Assign error:', err);
      safeToast(err instanceof Error ? err.message : 'Assignment failed');
    } finally {
      setAssignLoading(false);
    }
  };

  const renderTicketHtml = (
    page: TicketOutputPage,
    ticket: TicketOnPage,
    ticketHeight: number
  ) => {
    const fittedPercent = computeTicketFittedRectPercent(page);

    const lettersHtmlBySlot = page.seriesSlots.map((slot) => {
      const seriesForSlot = ticket.seriesBySlot[slot.id];
      const seriesText = seriesForSlot?.seriesValue ?? '';

      const lettersHtml = seriesText.split('').map((letter, idx) => {
        const style = seriesForSlot?.letterStyles[idx];
        const fontSize = style?.fontSize || slot.defaultFontSize;
        const offsetY = style?.offsetY || 0;
        const cumulativeSpacingPt = seriesText
          .split('')
          .slice(0, idx)
          .reduce((sum, _, i) => sum + (seriesForSlot?.letterStyles[i]?.spacingAfterX || 0), 0);
        const cumulativeX = cumulativeSpacingPt * (96 / 72);

        const displayLetter = letter === ' ' ? '&nbsp;' : letter;
        return `<span style="
        font-size: ${fontSize}px;
        font-family: ${slot.fontFamily};
        color: ${slot.color};
        display: inline-block;
        transform: translate(${cumulativeX}px, ${offsetY}px);

        white-space: pre;
      ">${displayLetter}</span>`;
      }).join('');

      const { slotRelativeX, slotRelativeY, slotRelativeWidth, slotRelativeHeight } =
        computeSeriesSlotRelative(page, slot);

      const mapped = mapSlotToFittedPercent(
        slotRelativeX,
        slotRelativeY,
        slotRelativeWidth,
        slotRelativeHeight,
        fittedPercent
      );

      return {
        lettersHtml,
        slotRelativeX: mapped.x,
        slotRelativeY: mapped.y,
        slotRelativeWidth: mapped.width,
        slotRelativeHeight: mapped.height,
        slot,
      };
    });

    return `
      <div class="ticket" style="height: ${ticketHeight}mm;">
        <div class="ticket-inner">
          <img src="${page.ticketImageData}" class="ticket-image" style="
            position: absolute;
            left: ${fittedPercent.x}%;
            top: ${fittedPercent.y}%;
            width: ${fittedPercent.width}%;
            height: ${fittedPercent.height}%;
          " />
          ${lettersHtmlBySlot.map(({ lettersHtml, slotRelativeX, slotRelativeY, slotRelativeWidth, slotRelativeHeight, slot }) => `
          <div class="series-slot" style="
            left: ${slotRelativeX}%;
            top: ${slotRelativeY}%;
            width: ${slotRelativeWidth}%;
            height: ${slotRelativeHeight}%;
            background-color: ${slot.backgroundColor};
            border: ${slot.borderWidth}px solid ${slot.borderColor};
            border-radius: ${slot.borderRadius}px;
            padding: ${slot.paddingTop}px ${slot.paddingRight}px ${slot.paddingBottom}px ${slot.paddingLeft}px;
            transform: rotate(${slot.rotation}deg);
            transform-origin: center center;
            display: flex;
            align-items: center;
            justify-content: ${slot.textAlign === 'left' ? 'flex-start' : slot.textAlign === 'right' ? 'flex-end' : 'center'};
          ">
            <div class="series-letters">${lettersHtml}</div>
          </div>`).join('')}
        </div>
      </div>
    `;
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print.');
    }

    const ticketHeight = A4_HEIGHT_MM / 4;

    const fontFaceCss = (customFonts || [])
      .map(
        (font) => `@font-face {
  font-family: "${font.family}";
  src: url(${font.dataUrl});
  font-weight: normal;
  font-style: normal;
}`
      )
      .join('\n');

    const pagesHtml = pages.map((page) => {
      const ticketsHtml = page.tickets.map((ticket) =>
        renderTicketHtml(page, ticket, ticketHeight)
      ).join('');

      return `
        <div class="page">
          ${ticketsHtml}
        </div>
      `;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Ticket Output</title>
          <style>
            ${fontFaceCss}
            @page {
              size: A4;
              margin: 0;
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: Arial, sans-serif;
            }
            .page {
              width: ${A4_WIDTH_MM}mm;
              height: ${A4_HEIGHT_MM}mm;
              page-break-after: always;
              display: flex;
              flex-direction: column;
              background: white;
            }
            .page:last-child {
              page-break-after: avoid;
            }
            .ticket {
              flex: 1;
              position: relative;
              overflow: hidden;
              border-bottom: 1px dashed #ccc;
            }
            .ticket:last-child {
              border-bottom: none;
            }
            .ticket-inner {
              position: absolute;
              inset: 0;
              overflow: hidden;
            }
            .ticket-image {
              position: absolute;
            }
            .series-slot {
              position: absolute;
              display: flex;
              align-items: center;
              overflow: visible;
              transform-origin: center center;
            }
            .series-letters {
              display: flex;
              align-items: baseline;
              white-space: pre;
            }
            @media print {
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              .ticket { border-bottom: none; }
            }
          </style>
        </head>
        <body>
          ${pagesHtml}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  const currentPageData = pages[currentPage];

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
            <X className="h-4 w-4" />
            Close
          </Button>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm text-muted-foreground">
            Output: {pages.length} pages, {totalTickets} tickets
          </span>
        </div>
        <Button onClick={handlePrint} size="sm" className="gap-2">
          <Printer className="h-4 w-4" />
          Print All Pages
        </Button>
      </div>

      {/* Preview Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Page Navigation */}
        <div className="w-48 border-r border-border p-3 overflow-y-auto bg-card/50">
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Pages</p>
          <div className="space-y-1">
            {pages.map((page, idx) => {
              const primarySlot = page.seriesSlots[0];
              const firstTicket = page.tickets[0];
              const lastTicket = page.tickets[3];
              const firstSeries = primarySlot && firstTicket
                ? firstTicket.seriesBySlot[primarySlot.id]?.seriesValue
                : '';
              const lastSeries = primarySlot && lastTicket
                ? lastTicket.seriesBySlot[primarySlot.id]?.seriesValue
                : '';

              return (
                <button
                  key={page.pageNumber}
                  onClick={() => setCurrentPage(idx)}
                  className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                    currentPage === idx
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  Page {page.pageNumber}
                  {firstSeries && lastSeries ? ` (${firstSeries} - ${lastSeries})` : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* Page Preview with Scroll */}
        <div className="flex-1 min-h-0">
          <div className="h-full overflow-auto p-6 bg-muted/30 flex justify-center items-start">
            <div
              ref={printContainerRef}
              className="bg-white shadow-2xl relative flex flex-col rounded-none shrink-0"
              style={{
                width: A4_WIDTH_PX,
                height: A4_HEIGHT_PX,
              }}
            >
              {currentPageData && (
                <div className="flex flex-col h-full">
                  {currentPageData.tickets.map((ticket, ticketIdx) => {
                    const ticketHeightPx = (A4_HEIGHT_PX - A4_FOOTER_PX) / 4;

                    const fittedTicket = computeTicketFittedRectPx(currentPageData, ticketHeightPx);

                    return (
                      <div
                        key={ticketIdx}
                        className="relative overflow-hidden border-b border-dashed border-muted-foreground/30 last:border-b-0"
                        style={{ height: ticketHeightPx }}
                      >
                        {/* Ticket image area with overlay */}
                        <div className="absolute inset-0">
                          <div className="relative w-full h-full rounded-sm bg-white overflow-hidden">
                            <img
                              src={currentPageData.ticketImageData}
                              alt="Ticket"
                              className="absolute"
                              style={{
                                left: fittedTicket.x,
                                top: fittedTicket.y,
                                width: fittedTicket.width,
                                height: fittedTicket.height,
                              }}
                            />
                            {/* Series Slots Overlay */}
                            {[...currentPageData.seriesSlots]
                              .sort((a, b) => (a.y - b.y) || (a.x - b.x))
                              .map((slot) => {
                                const {
                                  slotRelativeX,
                                  slotRelativeY,
                                  slotRelativeWidth,
                                  slotRelativeHeight,
                                } = computeSeriesSlotRelative(currentPageData, slot);

                                const mapped = mapSlotToFittedPx(
                                  slotRelativeX,
                                  slotRelativeY,
                                  slotRelativeWidth,
                                  slotRelativeHeight,
                                  fittedTicket
                                );

                                return (
                                  <div
                                    key={slot.id}
                                    className="absolute flex items-center overflow-visible"
                                    style={{
                                      left: mapped.x,
                                      top: mapped.y,
                                      width: mapped.width,
                                      height: mapped.height,
                                      backgroundColor: slot.backgroundColor,
                                      border: `${slot.borderWidth}px solid ${slot.borderColor}`,
                                      borderRadius: slot.borderRadius,
                                      padding: `${slot.paddingTop}px ${slot.paddingRight}px ${slot.paddingBottom}px ${slot.paddingLeft}px`,
                                      transform: `rotate(${slot.rotation}deg)`,
                                      transformOrigin: 'center center',
                                      justifyContent:
                                        slot.textAlign === 'left'
                                          ? 'flex-start'
                                          : slot.textAlign === 'right'
                                          ? 'flex-end'
                                          : 'center',
                                    }}
                                  >
                                    <div
                                      className="flex items-baseline"
                                      style={{ justifyContent: 'inherit', whiteSpace: 'pre' }}
                                    >
                                      {(() => {
                                        const seriesForSlot = ticket.seriesBySlot[slot.id];
                                        const seriesText = seriesForSlot?.seriesValue ?? '';
                                        return seriesText.split('').map((letter, letterIdx) => {
                                          const style = seriesForSlot?.letterStyles[letterIdx];
                                          const fontSize = style?.fontSize || slot.defaultFontSize;
                                          const offsetY = style?.offsetY || 0;
                                          const cumulativeSpacingPt = seriesText
                                            .split('')
                                            .slice(0, letterIdx)
                                            .reduce(
                                              (sum, _, i) => sum + (seriesForSlot?.letterStyles[i]?.spacingAfterX || 0),
                                              0
                                            );
                                          const cumulativeX = cumulativeSpacingPt * (96 / 72);

                                          return (
                                            <span
                                              key={letterIdx}
                                              style={{
                                                fontSize,
                                                fontFamily: slot.fontFamily,
                                                color: slot.color,
                                                display: 'inline-block',
                                                whiteSpace: 'pre',
                                                transform: `translate(${cumulativeX}px, ${offsetY}px)`,
                                              }}
                                            >
                                              {letter === ' ' ? '\u00A0' : letter}
                                            </span>
                                          );
                                        });
                                      })()}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Assign panel on right for admin */}
      {user?.role === 'ADMIN' && (
        <div className="w-72 border-l border-border p-4 bg-card/50">
          <h2 className="text-sm font-semibold mb-2">Assign to User</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Based on the ISS-generated layout (4 cars per page), assign the base document along with its pages to a user’s email. After logging in, the user will go to the /printing page to view their assigned prints.
          </p>

          <div className="space-y-2 mb-3">
            <Label htmlFor="assignEmail" className="text-xs">User Email</Label>
            <Input
              id="assignEmail"
              type="email"
              placeholder="user@example.com"
              value={assignEmail}
              onChange={(e) => setAssignEmail(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2 mb-4">
            <Label htmlFor="assignPages" className="text-xs">print limit</Label>
            <Input
              id="assignPages"
              type="number"
              min={1}
              value={assignPages}
              onChange={(e) => setAssignPages(e.target.value)}
              className="h-8 text-xs"
            />
          </div>

          <Button
            size="sm"
            className="w-full text-xs"
            disabled={assignLoading}
            onClick={handleAssignToUser}
          >
            {assignLoading ? 'Assigning...' : 'Assign Pages'}
          </Button>
        </div>
      )}

      {/* Footer Navigation */}
      <div className="flex items-center justify-center gap-4 px-4 py-3 border-t border-border bg-card">
        <Button
          variant="outline"
          onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
          disabled={currentPage === 0}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {currentPage + 1} of {pages.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage(Math.min(pages.length - 1, currentPage + 1))}
          disabled={currentPage === pages.length - 1}
          className="gap-1"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};