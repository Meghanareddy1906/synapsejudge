import { useEffect, useState } from 'react';
import { formatDuration } from '../utils/time.js';

/**
 * Ticks once a second toward `target`, then calls `onExpire` exactly once.
 *
 * The remaining time is recomputed from the target on every tick rather than
 * decremented, so a backgrounded tab that stops firing timers still shows the
 * right number the moment it comes back.
 */
export default function Countdown({ target, onExpire, label }) {
  const [remaining, setRemaining] = useState(() => new Date(target) - Date.now());

  useEffect(() => {
    setRemaining(new Date(target) - Date.now());

    const id = setInterval(() => {
      const next = new Date(target) - Date.now();
      setRemaining(next);
      if (next <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(id);
  }, [target, onExpire]);

  return (
    <span className="countdown">
      {label && <span className="countdown-label">{label}</span>}
      <span className="countdown-value num">{formatDuration(remaining)}</span>
    </span>
  );
}
