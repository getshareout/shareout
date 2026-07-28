/**
 * Progressive Web App install prompt and service worker helpers.
 */

import { isStandalone } from './device';
import type { InstallState, PwaApi } from './types';

let deferredPrompt: Event | null = null;
const installListeners: Array<(state: InstallState) => void> = [];

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installListeners.forEach((cb) => cb({ canInstall: true }));
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  installListeners.forEach((cb) => cb({ installed: true }));
});

/** Factory for the PWA namespace on `ShareOut.mobile`. */
export function createPwa(): PwaApi {
  return {
    canInstall() {
      return deferredPrompt !== null;
    },

    isInstalled() {
      return isStandalone();
    },

    async promptInstall() {
      if (!deferredPrompt) {
        return { outcome: 'dismissed', error: 'Install prompt not available' };
      }

      const promptEvent = deferredPrompt as Event & {
        prompt: () => void;
        userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
      };

      promptEvent.prompt();
      const result = await promptEvent.userChoice;

      if (result.outcome === 'accepted') {
        deferredPrompt = null;
      }

      return result;
    },

    onInstallStateChange(callback) {
      installListeners.push(callback);
      callback({
        canInstall: deferredPrompt !== null,
        installed: isStandalone(),
      });
      return () => {
        const idx = installListeners.indexOf(callback);
        if (idx > -1) installListeners.splice(idx, 1);
      };
    },

    async registerServiceWorker(swPath = 'sw.js') {
      if (!('serviceWorker' in navigator)) {
        throw new Error('Service workers not supported');
      }
      return navigator.serviceWorker.register(swPath);
    },

    async updateServiceWorker() {
      if (!('serviceWorker' in navigator)) return;
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.update();
      }
    },
  };
}
