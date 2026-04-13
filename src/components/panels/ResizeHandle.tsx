'use client';

import { useCallback, useRef, useEffect, useState } from 'react';

interface ResizeHandleProps {
  readonly side: 'left' | 'right';
  readonly onResize: (delta: number) => void;
}

export function ResizeHandle({ side, onResize }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      startXRef.current = e.clientX;
      setDragging(true);
    },
    []
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startXRef.current;
      startXRef.current = e.clientX;
      // For a left-side handle (right panel), dragging left = panel grows
      onResize(side === 'left' ? -delta : delta);
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, onResize, side]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`group relative z-10 w-1 shrink-0 cursor-col-resize ${
        dragging ? 'bg-accent/50' : 'hover:bg-accent/30'
      } transition-colors`}
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
