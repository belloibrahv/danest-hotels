import { WifiOff } from 'lucide-react';
import { useOnline } from '@/lib/pwa';

/** Says plainly when the connection drops, so nobody thinks a payment or check-in was saved. */
export function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg"
    >
      <WifiOff className="size-4 shrink-0 text-warning" />
      <span>You're offline. You can look around, but nothing is saved until the connection is back.</span>
    </div>
  );
}
