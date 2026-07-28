import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearServiceWorkerCache,
  precacheUrls,
  registerServiceWorker,
  unregisterServiceWorker,
} from '../src/service-worker';

type MockRegistration = ServiceWorkerRegistration & {
  installing: ServiceWorker | null;
  active: ServiceWorker | null;
  addEventListener: ReturnType<typeof vi.fn>;
};

function createRegistration(overrides: Partial<MockRegistration> = {}): MockRegistration {
  return {
    installing: null,
    active: null,
    addEventListener: vi.fn(),
    ...overrides,
  } as MockRegistration;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('registerServiceWorker', () => {
  it('returns null when service workers are unavailable', async () => {
    vi.stubGlobal('window', undefined);
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it('registers the worker and invokes onSuccess for active registrations', async () => {
    const registration = createRegistration({
      active: { state: 'activated' } as ServiceWorker,
    });
    const onSuccess = vi.fn();
    const register = vi.fn(async () => registration);

    vi.stubGlobal('navigator', { serviceWorker: { register } });
    vi.stubGlobal('window', {});

    const result = await registerServiceWorker('/sw.js', {
      scope: '/app/',
      updateViaCache: 'imports',
      onSuccess,
    });

    expect(result).toBe(registration);
    expect(register).toHaveBeenCalledWith('/sw.js', {
      scope: '/app/',
      updateViaCache: 'imports',
    });
    expect(onSuccess).toHaveBeenCalledWith(registration);
    expect(registration.addEventListener).toHaveBeenCalledWith('updatefound', expect.any(Function));
  });

  it('fires onUpdate when a waiting worker is installed', async () => {
    const listeners = new Map<string, EventListener>();
    const newWorker = {
      state: 'installed',
      addEventListener: vi.fn((event: string, handler: EventListener) => {
        listeners.set(event, handler);
      }),
    } as unknown as ServiceWorker;

    const registration = createRegistration({ installing: newWorker });
    registration.addEventListener.mockImplementation((event: string, handler: EventListener) => {
      if (event === 'updatefound') handler(new Event('updatefound'));
    });

    const onUpdate = vi.fn();
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn(async () => registration),
        controller: {},
      },
    });
    vi.stubGlobal('window', {});

    await registerServiceWorker('/sw.js', { onUpdate });
    listeners.get('statechange')?.(new Event('statechange'));

    expect(onUpdate).toHaveBeenCalledWith(registration);
  });

  it('returns null when registration throws', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        register: vi.fn(async () => {
          throw new Error('blocked');
        }),
      },
    });
    vi.stubGlobal('window', {});

    await expect(registerServiceWorker('/sw.js')).resolves.toBeNull();
  });
});

describe('unregisterServiceWorker', () => {
  it('returns false when service workers are unavailable', async () => {
    vi.stubGlobal('window', undefined);
    await expect(unregisterServiceWorker()).resolves.toBe(false);
  });

  it('unregisters all registrations', async () => {
    const unregister = vi.fn(async () => true);
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistrations: vi.fn(async () => [{ unregister }, { unregister }]),
      },
    });
    vi.stubGlobal('window', {});

    await expect(unregisterServiceWorker()).resolves.toBe(true);
    expect(unregister).toHaveBeenCalledTimes(2);
  });
});

describe('service worker messaging helpers', () => {
  it('posts precache and clear-cache messages to the active worker', async () => {
    const postMessage = vi.fn();
    const ready = Promise.resolve({
      active: { postMessage },
    } as ServiceWorkerRegistration);

    vi.stubGlobal('navigator', {
      serviceWorker: { ready },
    });
    vi.stubGlobal('window', {});

    precacheUrls(['/index.html', '/app.js']);
    clearServiceWorkerCache();

    await ready;
    await Promise.resolve();

    expect(postMessage).toHaveBeenCalledWith({ type: 'PRECACHE', urls: ['/index.html', '/app.js'] });
    expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_CACHE' });
  });

  it('no-ops when service workers are unavailable', () => {
    vi.stubGlobal('window', undefined);
    expect(() => precacheUrls(['/a'])).not.toThrow();
    expect(() => clearServiceWorkerCache()).not.toThrow();
  });
});
