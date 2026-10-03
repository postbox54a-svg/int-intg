import { useEffect, useState } from 'react';
import { formatIST } from '@ind-intg/shared';

export function IstClock({ now: initial = Date.now() }: { now?: number }) {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clock" aria-label="Indian Standard Time">
      {formatIST(now)} <span className="tz">IST</span>
    </div>
  );
}
