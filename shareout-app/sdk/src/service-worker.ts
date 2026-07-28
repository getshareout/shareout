export interface ServiceWorkerOptions {
  scope?: string;
  updateViaCache?: 'all' | 'imports' | 'none';
  onUpdate?: (registration: ServiceWorkerRegistration) => void;
  onSuccess?: (registration: ServiceWorkerRegistration) => void;
}

export async function registerServiceWorker(
  swUrl: string = '/sw.js',
  options: ServiceWorkerOptions = {}
): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: options.scope || '/',
      updateViaCache: options.updateViaCache || 'none',
    });

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          options.onUpdate?.(registration);
        } else if (newWorker.state === 'activated') {
          options.onSuccess?.(registration);
        }
      });
    });

    if (registration.active) {
      options.onSuccess?.(registration);
    }

    return registration;
  } catch {
    return null;
  }
}

export function unregisterServiceWorker(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(false);
  }

  return navigator.serviceWorker.getRegistrations().then((registrations) => {
    return Promise.all(registrations.map((r) => r.unregister())).then(() => true);
  });
}

export function precacheUrls(urls: string[]): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: 'PRECACHE', urls });
  });
}

export function clearServiceWorkerCache(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then((registration) => {
    registration.active?.postMessage({ type: 'CLEAR_CACHE' });
  });
}

