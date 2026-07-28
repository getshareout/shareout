// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachMobileSdk, buildMobileApi } from '../src/mobile';
import { resetNavigationForTests } from '../src/mobile/navigation';
import type { ShareOutGlobal } from '../src/mobile/types';

function mobileGlobal(): ShareOutGlobal {
  return { ShareOut: {} };
}

beforeEach(() => {
  resetNavigationForTests();
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    vibrate: vi.fn(),
    serviceWorker: {
      register: vi.fn(async () => ({})),
      getRegistration: vi.fn(async () => null),
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('buildMobileApi', () => {
  it('exposes device detection helpers', () => {
    const api = buildMobileApi();
    expect(api.isMobile()).toBe(true);
    expect(api.isIOS()).toBe(true);
    expect(api.isAndroid()).toBe(false);
    expect(api.version).toBe('1.0.0');
  });

  it('initializes viewport and navigation from the hash', () => {
    window.location.hash = '#dashboard';
    const api = buildMobileApi();

    api.init({ registerServiceWorker: false });

    const viewport = document.querySelector('meta[name="viewport"]');
    expect(viewport?.getAttribute('content')).toContain('viewport-fit=cover');
    expect(api.navigation.currentRoute()).toBe('dashboard');
  });

  it('tracks navigation push and pop', () => {
    const api = buildMobileApi();
    const events: string[] = [];
    api.navigation.onNavigate((e) => events.push(e.type));

    api.navigation.push('settings');
    api.navigation.push('detail');
    expect(api.navigation.stackDepth()).toBe(2);
    expect(api.navigation.canGoBack()).toBe(true);

    api.navigation.pop();
    expect(api.navigation.currentRoute()).toBe('settings');
    expect(events).toContain('push');
  });

  it('fires haptics when vibrate is available', () => {
    const api = buildMobileApi();
    api.haptics.light();
    expect(navigator.vibrate).toHaveBeenCalledWith(10);
    expect(api.haptics.isSupported()).toBe(true);
  });

  it('creates a bottom sheet and opens it', () => {
    const api = buildMobileApi();
    const sheet = api.createBottomSheet({ content: '<p>Hello</p>' });

    expect(sheet.isOpen()).toBe(false);
    sheet.open();
    expect(sheet.isOpen()).toBe(true);
    expect(document.querySelector('.shareout-bottom-sheet')).not.toBeNull();

    sheet.close();
    sheet.destroy();
  });
});

describe('attachMobileSdk', () => {
  it('attaches once and returns the same instance', () => {
    const global = mobileGlobal();
    const first = attachMobileSdk(global);
    const second = attachMobileSdk(global);

    expect(first).toBe(second);
    expect(global.ShareOut?.mobile?.version).toBe('1.0.0');
  });
});
