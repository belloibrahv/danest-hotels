import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

/**
 * Installable app + offline shell. The worker is only registered in production builds; in
 * development Vite serves fresh files on every change and a cache would get in the way.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
    if (!reg) return;
    // A new deploy is ready. Never reload under someone mid-check-in: let them choose when.
    const offer = (worker: ServiceWorker) =>
      toast('A new version of the app is ready', {
        id: 'update',
        duration: Infinity,
        description: 'Reload when you finish what you are doing.',
        action: { label: 'Reload', onClick: () => worker.postMessage('skip-waiting') },
      });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    // Reception screens stay open all day: look for a new version every hour.
    setInterval(() => reg.update().catch(() => {}), 60 * 60_000);
  });
}

// ---------- "Install app" (Chrome, Edge, Android). Safari installs from the Share menu. ----------

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** Returns an install function when the browser offers one, otherwise null. */
export function useInstall(): (() => Promise<void>) | null {
  const prompt = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => deferred,
  );
  if (!prompt) return null;
  return async () => {
    await prompt.prompt();
    await prompt.userChoice;
    deferred = null;
    notify();
  };
}

/** Running as an installed app (no browser bar). */
export const isInstalled = () => typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

// ---------- connection ----------

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
