import React, { useRef, useEffect, useCallback } from 'react';

// Reusable draw-to-sign pad. White "paper" area, dark ink, works with
// finger / stylus / mouse. Calls onChange(dataUrl | null) whenever the
// signature becomes non-empty or is cleared.
export default function SignaturePad({ onChange, height = 180 }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const lastRef = useRef(null);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Fixed internal resolution (2x for sharp lines); CSS stretches to full width.
    canvas.width = 1200;
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0F172A';
  }, [height]);

  useEffect(() => { setupCanvas(); }, [setupCanvas]);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const emit = () => {
    if (!onChange) return;
    onChange(hasInkRef.current ? canvasRef.current.toDataURL('image/png') : null);
  };

  const down = (e) => {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pos(e);
    try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  };

  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(lastRef.current.x, lastRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    if (!hasInkRef.current) { hasInkRef.current = true; }
  };

  const up = (e) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    emit();
  };

  const clear = () => {
    setupCanvas();
    hasInkRef.current = false;
    if (onChange) onChange(null);
  };

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          width: '100%', height, borderRadius: 14, display: 'block',
          border: '2px solid rgba(15,23,42,0.25)', background: '#fff',
          touchAction: 'none', cursor: 'crosshair'
        }}
      />
      <button
        type="button"
        onClick={clear}
        style={{
          position: 'absolute', top: 10, right: 10,
          padding: '6px 14px', borderRadius: 8, border: '1px solid #CBD5E1',
          background: '#F8FAFC', color: '#334155', fontSize: 13, fontWeight: 600, cursor: 'pointer'
        }}
      >
        Clear
      </button>
      <div style={{
        position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center',
        fontSize: 12, color: '#94A3B8', pointerEvents: 'none'
      }}>
        Sign here with your finger
      </div>
    </div>
  );
}
