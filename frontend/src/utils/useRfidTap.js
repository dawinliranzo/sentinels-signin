import { useEffect, useRef } from 'react';

// USB keyboard-emulation RFID readers "type" the card UID extremely fast
// (a burst of characters in well under half a second) and finish with Enter.
// This hook detects those bursts and reports the UID — while leaving normal
// human typing completely alone.
//
//   useRfidTap((uid) => { ... }, { enabled, allowInInputs })
//
//   enabled        — listen or not (default true)
//   allowInInputs  — also capture while a text field is focused (default false,
//                    so it never swallows anything a visitor is typing)
export default function useRfidTap(onTap, { enabled = true, allowInInputs = false } = {}) {
  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const burstStartRef = useRef(0);
  const callbackRef = useRef(onTap);
  callbackRef.current = onTap;

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (inField && !allowInInputs) {
        bufferRef.current = '';
        return;
      }

      const now = Date.now();
      const gap = now - lastKeyAtRef.current;
      lastKeyAtRef.current = now;

      if (e.key === 'Enter') {
        const buf = bufferRef.current;
        bufferRef.current = '';
        // Badge signature: 6+ chars, whole burst inside ~600ms
        if (buf.length >= 6 && now - burstStartRef.current < 600) {
          e.preventDefault();
          callbackRef.current(buf);
        }
        return;
      }
      if (e.key.length !== 1) { bufferRef.current = ''; return; } // Shift, arrows, etc.

      if (gap > 60) {
        // Too slow for a reader — this is a human keystroke, start fresh
        bufferRef.current = e.key;
        burstStartRef.current = now;
        return;
      }
      bufferRef.current += e.key;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, allowInInputs]);
}
