import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Printer, Eye, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

interface TicketToolbarProps {
  hasSeriesSlot: boolean;
  startingSeries: string;
  endingSeries: string;
  totalPages: number;
  isGenerating: boolean;
  hasOutput: boolean;
  cutMarginMm: number;
  ticketImageXmm: number;
  ticketImageYmm: number;
  ticketImageWidthMm: number;
  ticketImageHeightMm: number;
  ticketImageLockAspect: boolean;
  onAddSeriesSlot: () => void;
  onDeleteSeriesSlot: () => void;
  onStartingSeriesChange: (value: string) => void;
  onTotalPagesChange: (value: number) => void;
  onGenerateOutput: () => void;
  onShowPreview: () => void;
  onCutMarginMmChange: (value: number) => void;
  onTicketImageAlign: (align: 'left' | 'center' | 'right') => void;
  onTicketImageMoveMm: (dxMm: number, dyMm: number) => void;
  onTicketImageXmmChange: (value: number) => void;
  onTicketImageYmmChange: (value: number) => void;
  onTicketImageWidthMmChange: (value: number) => void;
  onTicketImageHeightMmChange: (value: number) => void;
  onTicketImageLockAspectChange: (value: boolean) => void;
  onUploadFont: (file: File) => void;
  onUploadImage: (file: File) => void;
}

export const TicketToolbar: React.FC<TicketToolbarProps> = ({
  hasSeriesSlot,
  startingSeries,
  endingSeries,
  totalPages,
  isGenerating,
  hasOutput,
  cutMarginMm,
  ticketImageXmm,
  ticketImageYmm,
  ticketImageWidthMm,
  ticketImageHeightMm,
  ticketImageLockAspect,
  onAddSeriesSlot,
  onDeleteSeriesSlot,
  onStartingSeriesChange,
  onTotalPagesChange,
  onGenerateOutput,
  onShowPreview,
  onCutMarginMmChange,
  onTicketImageAlign,
  onTicketImageMoveMm,
  onTicketImageXmmChange,
  onTicketImageYmmChange,
  onTicketImageWidthMmChange,
  onTicketImageHeightMmChange,
  onTicketImageLockAspectChange,
  onUploadFont,
  onUploadImage,
}) => {
  const formatMm = (v: number) => {
    if (!Number.isFinite(v)) return '';
    const rounded = Math.round(v * 100) / 100;
    return String(rounded);
  };

  const [cutMarginMmInput, setCutMarginMmInput] = useState('');
  const [xMmInput, setXmmInput] = useState('');
  const [yMmInput, setYmmInput] = useState('');
  const [widthMmInput, setWidthMmInput] = useState('');
  const [heightMmInput, setHeightMmInput] = useState('');
  const [isEditingCutMargin, setIsEditingCutMargin] = useState(false);
  const [isEditingX, setIsEditingX] = useState(false);
  const [isEditingY, setIsEditingY] = useState(false);
  const [isEditingWidth, setIsEditingWidth] = useState(false);
  const [isEditingHeight, setIsEditingHeight] = useState(false);

  useEffect(() => {
    if (!isEditingCutMargin) setCutMarginMmInput(formatMm(cutMarginMm));
  }, [cutMarginMm, isEditingCutMargin]);

  useEffect(() => {
    if (!isEditingX) setXmmInput(formatMm(ticketImageXmm));
  }, [isEditingX, ticketImageXmm]);

  useEffect(() => {
    if (!isEditingY) setYmmInput(formatMm(ticketImageYmm));
  }, [isEditingY, ticketImageYmm]);

  useEffect(() => {
    if (!isEditingWidth) setWidthMmInput(formatMm(ticketImageWidthMm));
  }, [isEditingWidth, ticketImageWidthMm]);

  useEffect(() => {
    if (!isEditingHeight) setHeightMmInput(formatMm(ticketImageHeightMm));
  }, [isEditingHeight, ticketImageHeightMm]);

  const commitCutMargin = () => {
    const n = Number.parseFloat(cutMarginMmInput);
    if (Number.isFinite(n)) {
      const clamped = Math.max(0, n);
      setCutMarginMmInput(formatMm(clamped));
      onCutMarginMmChange(clamped);
    } else {
      setCutMarginMmInput(formatMm(cutMarginMm));
    }
  };

  const commitX = () => {
    const n = Number.parseFloat(xMmInput);
    if (Number.isFinite(n)) {
      onTicketImageXmmChange(n);
    } else {
      setXmmInput(formatMm(ticketImageXmm));
    }
  };

  const commitY = () => {
    const n = Number.parseFloat(yMmInput);
    if (Number.isFinite(n)) {
      onTicketImageYmmChange(n);
    } else {
      setYmmInput(formatMm(ticketImageYmm));
    }
  };

  const commitWidth = () => {
    const n = Number.parseFloat(widthMmInput);
    if (Number.isFinite(n)) {
      onTicketImageWidthMmChange(n);
    } else {
      setWidthMmInput(formatMm(ticketImageWidthMm));
    }
  };

  const commitHeight = () => {
    const n = Number.parseFloat(heightMmInput);
    if (Number.isFinite(n)) {
      onTicketImageHeightMmChange(n);
    } else {
      setHeightMmInput(formatMm(ticketImageHeightMm));
    }
  };

  return (
    <div className="w-56 bg-card border-r border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Ticket Editor
        </h2>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Series Slot Controls */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Series Slot</Label>

          {/* Always allow adding new series slots so admin can place multiple boxes */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={onAddSeriesSlot}
              size="sm"
              className="w-full gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Series Slot
            </Button>

            {hasSeriesSlot && (
              <Button
                onClick={onDeleteSeriesSlot}
                variant="destructive"
                size="sm"
                className="w-full gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Remove Selected Slot
              </Button>
            )}
          </div>

          <p className="text-[10px] text-muted-foreground">
            Place series number on your ticket (you can add multiple boxes)
          </p>
        </div>

        <Separator />

        {/* Series Configuration */}
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Series Config</Label>
          
          <div className="space-y-1.5">
            <Label className="text-xs text-foreground">Starting Series</Label>
            <Input
              value={startingSeries}
              onChange={(e) => onStartingSeriesChange(e.target.value)}
              placeholder="e.g. A001 or A 001"
              className="h-8 text-sm bg-background font-mono"
            />
            <p className="text-[10px] text-muted-foreground">
              Supports spaces (e.g., A 001, B 0001)
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-foreground">Total Pages</Label>
            <Input
              type="number"
              value={totalPages}
              onChange={(e) => onTotalPagesChange(Math.max(1, parseInt(e.target.value) || 1))}
              min={1}
              max={500}
              className="h-8 text-sm bg-background"
            />
            <p className="text-[10px] text-primary font-medium">
              {totalPages * 4} tickets total (4 per page)
            </p>
          </div>

          {/* Auto-calculated ending series */}
          <div className="p-2 bg-muted/50 rounded border border-border">
            <p className="text-[10px] text-muted-foreground mb-1">Series Range</p>
            <p className="text-xs font-mono font-medium text-foreground">
              {startingSeries} → {endingSeries}
            </p>
          </div>
        </div>

        <Separator />

        {/* Generate & Preview */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Output</Label>
          
          <Button
            onClick={onGenerateOutput}
            disabled={!hasSeriesSlot || !startingSeries || isGenerating}
            size="sm"
            className="w-full gap-2"
          >
            <Eye className="h-4 w-4" />
            {isGenerating ? 'Generating...' : 'Generate Output'}
          </Button>

          {hasOutput && (
            <Button
              onClick={onShowPreview}
              variant="outline"
              size="sm"
              className="w-full gap-2"
            >
              <Printer className="h-4 w-4" />
              View & Print
            </Button>
          )}
        </div>

        <Separator />

        {/* Ticket Image Placement */}
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Ticket Layout</Label>

          <div className="space-y-2">
            <Label className="text-xs text-foreground">Cut margin (mm)</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={cutMarginMmInput}
              onFocus={() => setIsEditingCutMargin(true)}
              onChange={(e) => setCutMarginMmInput(e.target.value)}
              onBlur={() => {
                setIsEditingCutMargin(false);
                commitCutMargin();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="h-8 text-sm bg-background"
            />
            <p className="text-[10px] text-muted-foreground">Max: 0 – 10 mm</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-foreground">Position (mm)</Label>
            <p className="text-[10px] text-muted-foreground">Moves image from top-left origin. Max: -20 to +20 mm</p>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4 shrink-0">X:</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={xMmInput}
                  onFocus={() => setIsEditingX(true)}
                  onChange={(e) => setXmmInput(e.target.value)}
                  onBlur={() => {
                    setIsEditingX(false);
                    commitX();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-9 text-base bg-background flex-1 min-w-0"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-4 shrink-0">Y:</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={yMmInput}
                  onFocus={() => setIsEditingY(true)}
                  onChange={(e) => setYmmInput(e.target.value)}
                  onBlur={() => {
                    setIsEditingY(false);
                    commitY();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-9 text-base bg-background flex-1 min-w-0"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-foreground">Alignment</Label>
            <p className="text-[10px] text-muted-foreground">Horizontal alignment on ticket</p>
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onTicketImageAlign('left')}>
                Left
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onTicketImageAlign('center')}>
                Center
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onTicketImageAlign('right')}>
                Right
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-foreground">Fine Adjust</Label>
            <div className="grid grid-cols-3 gap-2">
              <div />
              <Button type="button" variant="outline" size="sm" onClick={() => onTicketImageMoveMm(0, -1)}>
                Up
              </Button>
              <div />
              <Button type="button" variant="outline" size="sm" onClick={() => onTicketImageMoveMm(-1, 0)}>
                Left
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onTicketImageMoveMm(0, 1)}>
                Down
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onTicketImageMoveMm(1, 0)}>
                Right
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">Moves by ±1 mm per click</p>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-foreground">Size (mm)</Label>
            <p className="text-[10px] text-muted-foreground">Max width: 200 mm. Max height: 100 mm</p>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">Width:</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={widthMmInput}
                  onFocus={() => setIsEditingWidth(true)}
                  onChange={(e) => setWidthMmInput(e.target.value)}
                  onBlur={() => {
                    setIsEditingWidth(false);
                    commitWidth();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-9 text-base bg-background flex-1 min-w-0"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12 shrink-0">Height:</span>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={heightMmInput}
                  onFocus={() => setIsEditingHeight(true)}
                  onChange={(e) => setHeightMmInput(e.target.value)}
                  onBlur={() => {
                    setIsEditingHeight(false);
                    commitHeight();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="h-9 text-base bg-background flex-1 min-w-0"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="ticketLockAspect"
              type="checkbox"
              checked={ticketImageLockAspect}
              onChange={(e) => onTicketImageLockAspectChange(e.target.checked)}
            />
            <Label htmlFor="ticketLockAspect" className="text-xs text-foreground">
              Keep proportions
            </Label>
          </div>
          <p className="text-[10px] text-muted-foreground">Prevents image stretching</p>
        </div>

        <Separator />

        {/* Custom Fonts */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Custom Font</Label>
          <input
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="block w-full text-[10px] text-muted-foreground file:mr-2 file:py-1 file:px-2 file:text-[10px] file:rounded file:border-0 file:bg-primary/10 file:text-primary cursor-pointer"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onUploadFont(file);
                e.target.value = '';
              }
            }}
          />
          <p className="text-[10px] text-muted-foreground">
            Upload .ttf, .otf, .woff for this session
          </p>
        </div>

        <Separator />

        {/* Custom Image (SVG/PNG/JPG) */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">Custom Image</Label>
          <input
            type="file"
            accept=".svg,.png,.jpg,.jpeg"
            className="block w-full text-[10px] text-muted-foreground file:mr-2 file:py-1 file:px-2 file:text-[10px] file:rounded file:border-0 file:bg-primary/10 file:text-primary cursor-pointer"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onUploadImage(file);
                e.target.value = '';
              }
            }}
          />
          <p className="text-[10px] text-muted-foreground">
            Add logo or SVG; shown on top of ticket
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border bg-muted/30">
        <div className="text-[10px] text-muted-foreground text-center space-y-1">
          <p>1. Position series slot on A4</p>
          <p>2. Set starting series & pages</p>
          <p>3. Generate → View A4 output</p>
        </div>
      </div>
    </div>
  );
};