import { useEffect, useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Printer } from 'lucide-react';

type PrinterSummary = {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  isOnline?: boolean;
};

interface SecurePrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmPrint: (options: {
    printerName: string;
    copies: number;
    pageRange: string;
    orientation: 'portrait' | 'landscape';
    colorMode: 'color' | 'grayscale';
  }) => void;
  documentTitle: string;
  isPrinting: boolean;
  printers: PrinterSummary[];
  isLoadingPrinters: boolean;
  onRefreshPrinters: () => void;
}

export const SecurePrintDialog = ({
  open,
  onOpenChange,
  onConfirmPrint,
  documentTitle,
  isPrinting,
  printers,
  isLoadingPrinters,
  onRefreshPrinters
}: SecurePrintDialogProps) => {
  const sortedPrinters = useMemo(() => {
    const list = Array.isArray(printers) ? printers.slice() : [];
    return list.sort((a, b) => {
      const da = a.isDefault ? 1 : 0;
      const db = b.isDefault ? 1 : 0;
      if (da !== db) return db - da;
      return String(a.displayName || a.name).localeCompare(String(b.displayName || b.name));
    });
  }, [printers]);

  const [printerName, setPrinterName] = useState<string>('');
  const [copies, setCopies] = useState<number>(1);
  const [pageRange, setPageRange] = useState<string>('');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [colorMode, setColorMode] = useState<'color' | 'grayscale'>('color');

  const selectedPrinterIsOnline = useMemo(() => {
    const name = printerName.trim();
    if (!name) return false;
    const match = sortedPrinters.find((p) => p.name === name);
    return match ? match.isOnline !== false : false;
  }, [printerName, sortedPrinters]);

  useEffect(() => {
    if (!open) return;
    const existing = printerName.trim();
    if (existing) {
      const match = sortedPrinters.find((p) => p.name === existing);
      if (match && match.isOnline !== false) return;
    }
    const defaultOnline = sortedPrinters.find((p) => p.isDefault && p.isOnline !== false);
    const firstOnline = sortedPrinters.find((p) => p.isOnline !== false);
    const fallback = sortedPrinters[0];
    const next = (defaultOnline || firstOnline || fallback)?.name;
    if (typeof next === 'string' && next.trim()) {
      setPrinterName(next);
    }
  }, [open, printerName, sortedPrinters]);

  useEffect(() => {
    if (!open) return;
    onRefreshPrinters();
  }, [open, onRefreshPrinters]);

  const handleConfirm = () => {
    const name = printerName.trim();
    if (!name) return;
    const safeCopies = Number.isFinite(copies) && copies > 0 ? Math.floor(copies) : 1;
    onConfirmPrint({
      printerName: name,
      copies: safeCopies,
      pageRange: String(pageRange || ''),
      orientation,
      colorMode,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            Secure Print Request
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Confirm printing this document
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Document Info */}
          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <p className="text-sm text-muted-foreground">Document</p>
            <p className="font-medium text-foreground truncate">{documentTitle}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="printer">Printer</Label>
              <Button type="button" variant="outline" size="sm" onClick={onRefreshPrinters} disabled={isPrinting || isLoadingPrinters}>
                Refresh
              </Button>
            </div>
            <Select value={printerName} onValueChange={setPrinterName}>
              <SelectTrigger id="printer" disabled={isPrinting || isLoadingPrinters || sortedPrinters.length === 0}>
                <SelectValue
                  placeholder={
                    isLoadingPrinters
                      ? 'Loading printers…'
                      : sortedPrinters.length === 0
                        ? 'No printers found'
                        : 'Select printer'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {sortedPrinters.map((p) => {
                  const label = String(p.displayName || p.name);
                  const status = p.isOnline === false ? 'Offline' : 'Online';
                  return (
                    <SelectItem key={p.name} value={p.name} disabled={p.isOnline === false}>
                      {label} ({status})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="copies">Copies</Label>
              <Input
                id="copies"
                type="number"
                min={1}
                step={1}
                value={String(copies)}
                onChange={(e) => setCopies(Number(e.target.value))}
                disabled={isPrinting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pageRange">Page range</Label>
              <Input
                id="pageRange"
                type="text"
                placeholder="e.g. 1-5, 8"
                value={pageRange}
                onChange={(e) => setPageRange(e.target.value)}
                disabled={isPrinting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Orientation</Label>
              <RadioGroup value={orientation} onValueChange={(v) => setOrientation(v === 'landscape' ? 'landscape' : 'portrait')} className="gap-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="portrait" id="portrait" />
                  <Label htmlFor="portrait">Portrait</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="landscape" id="landscape" />
                  <Label htmlFor="landscape">Landscape</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <RadioGroup value={colorMode} onValueChange={(v) => setColorMode(v === 'grayscale' ? 'grayscale' : 'color')} className="gap-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="color" id="color" />
                  <Label htmlFor="color">Color</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="grayscale" id="grayscale" />
                  <Label htmlFor="grayscale">Grayscale</Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPrinting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPrinting || !printerName.trim() || !selectedPrinterIsOnline}
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          >
            {isPrinting ? (
              <>
                <div className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <Printer className="h-4 w-4" />
                Print
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
