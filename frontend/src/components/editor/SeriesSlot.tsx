import React from 'react';
import { Move } from 'lucide-react';

export interface LetterStyle {
  fontSize: number;
  offsetY?: number; // vertical offset in px (positive = down)
  // spacingAfterX adds extra gap AFTER this letter (in pt). It does not move the letter itself.
  // The next letter starts after the cumulative sum of previous letters' spacingAfterX.
  // offsetY remains a pure vertical translate for the letter and is unchanged.
  spacingAfterX?: number; // per-letter horizontal spacing after this letter (pt)
}

export interface SeriesSlotData {
  id: string;
  x: number; // percentage relative to ticket
  y: number; // percentage relative to ticket
  width: number; // percentage
  height: number; // percentage
  value: string;
  // Optional per-slot series configuration (starting series for this slot)
  startingSeries?: string;
  // Optional per-slot increment (defaults to 1 if not set)
  seriesIncrement?: number;
  letterStyles: LetterStyle[]; // per-letter font sizes
  defaultFontSize: number;
  fontFamily: string;
  color: string;
  rotation: number;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  paddingTop: number;
  paddingBottom: number;
  paddingLeft: number;
  paddingRight: number;
  textAlign: 'left' | 'center' | 'right';
}

interface SeriesSlotProps {
  slot: SeriesSlotData;
  isSelected: boolean;
  containerWidth: number;
  containerHeight: number;
  onSelect: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onValueChange: (value: string) => void;
  onResizeStart: (e: React.MouseEvent, corner: string) => void;
}

export const SeriesSlot: React.FC<SeriesSlotProps> = ({
  slot,
  isSelected,
  containerWidth,
  containerHeight,
  onSelect,
  onDragStart,
  onValueChange,
  onResizeStart,
}) => {
  const pixelX = (slot.x / 100) * containerWidth;
  const pixelY = (slot.y / 100) * containerHeight;
  const pixelWidth = (slot.width / 100) * containerWidth;
  const pixelHeight = (slot.height / 100) * containerHeight;

  // Render each letter with individual font size
  const renderLetters = () => {
    return slot.value.split('').map((letter, index) => {
      const letterStyle = slot.letterStyles[index];
      const fontSize = letterStyle?.fontSize || slot.defaultFontSize;
      const offsetY = letterStyle?.offsetY || 0;
      const cumulativeSpacingPt = slot.value
        .split('')
        .slice(0, index)
        .reduce((sum, _, i) => sum + (slot.letterStyles[i]?.spacingAfterX || 0), 0);
      const cumulativeX = cumulativeSpacingPt * (96 / 72);

      const displayLetter = letter === ' ' ? '\u00A0' : letter;

      return (
        <span
          key={index}
          style={{
            fontSize,
            fontFamily: slot.fontFamily,
            color: slot.color,
            display: 'inline-block',
            whiteSpace: 'pre',
            transform: `translate(${cumulativeX}px, ${offsetY}px)`,
          }}
        >
          {displayLetter}
        </span>
      );
    });
  };

  return (
    <div
      className={`absolute cursor-move group ${isSelected ? 'z-20' : 'z-10'}`}
      style={{
        left: pixelX,
        top: pixelY,
        width: pixelWidth,
        height: pixelHeight,
        transform: `rotate(${slot.rotation}deg)`,
        transformOrigin: 'center center',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseDown={onDragStart}
    >
      {/* Slot Frame */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          backgroundColor: slot.backgroundColor,
          borderColor: slot.borderColor,
          borderWidth: slot.borderWidth,
          borderStyle: 'solid',
          borderRadius: slot.borderRadius,
        }}
      >
        {/* Inner content area with padding */}
        <div
          className="w-full h-full flex items-center"
          style={{
            paddingTop: slot.paddingTop,
            paddingBottom: slot.paddingBottom,
            paddingLeft: slot.paddingLeft,
            paddingRight: slot.paddingRight,
            justifyContent: slot.textAlign === 'left' ? 'flex-start' : slot.textAlign === 'right' ? 'flex-end' : 'center',
          }}
        >
          {/* Per-letter rendering */}
          <div 
            className="flex items-baseline"
            style={{
              justifyContent: slot.textAlign === 'left' ? 'flex-start' : slot.textAlign === 'right' ? 'flex-end' : 'center',
              width: '100%',
              whiteSpace: 'pre',
            }}
          >
            {renderLetters()}
          </div>
        </div>
      </div>

      {/* Selection ring */}
      <div
        className={`absolute inset-0 rounded pointer-events-none transition-all ${
          isSelected 
            ? 'ring-2 ring-primary ring-offset-2' 
            : 'group-hover:ring-2 group-hover:ring-primary/50'
        }`}
        style={{ borderRadius: slot.borderRadius }}
      />

      {/* Drag handle */}
      <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-card/95 backdrop-blur rounded-md px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg border border-border">
        <Move className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground font-medium">Series Slot</span>
      </div>

      {/* Resize handles */}
      {isSelected && (
        <>
          <div
            className="absolute -right-2 -bottom-2 w-4 h-4 bg-primary rounded-full cursor-se-resize shadow-md border-2 border-background"
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, 'se');
            }}
          />
          <div
            className="absolute -left-2 -bottom-2 w-4 h-4 bg-primary rounded-full cursor-sw-resize shadow-md border-2 border-background"
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, 'sw');
            }}
          />
          <div
            className="absolute -right-2 -top-2 w-4 h-4 bg-primary rounded-full cursor-ne-resize shadow-md border-2 border-background"
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, 'ne');
            }}
          />
          <div
            className="absolute -left-2 -top-2 w-4 h-4 bg-primary rounded-full cursor-nw-resize shadow-md border-2 border-background"
            onMouseDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, 'nw');
            }}
          />
        </>
      )}
    </div>
  );
};
