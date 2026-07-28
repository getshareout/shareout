/**
 * Hash-based in-artifact navigation with history integration.
 */

import type { NavigationApi, NavigationEvent, NavigationState } from './types';

const navigationStack: NavigationState[] = [];
const navListeners: Array<(event: NavigationEvent) => void> = [];

/** Clears navigation state — for unit tests only. */
export function resetNavigationForTests(): void {
  navigationStack.length = 0;
  navListeners.length = 0;
}

window.addEventListener('popstate', (e: PopStateEvent) => {
  const state = e.state as NavigationState | null;
  if (state?._shareout_nav) {
    navListeners.forEach((cb) => cb({ type: 'pop', route: state.route, state }));
  }
});

/** Factory for the navigation namespace on `ShareOut.mobile`. */
export function createNavigation(): NavigationApi {
  return {
    push(route, options = {}) {
      const state: NavigationState = {
        _shareout_nav: true,
        route,
        data: options.data ?? {},
        timestamp: Date.now(),
      };

      navigationStack.push(state);

      if (options.replaceUrl !== false) {
        const url = options.url ?? `#${route}`;
        history.pushState(state, '', url);
      }

      navListeners.forEach((cb) => cb({ type: 'push', route, state }));
    },

    pop() {
      if (navigationStack.length > 1) {
        const popped = navigationStack.pop()!;
        history.back();
        return popped;
      }
      return null;
    },

    replace(route, options = {}) {
      const state: NavigationState = {
        _shareout_nav: true,
        route,
        data: options.data ?? {},
        timestamp: Date.now(),
      };

      if (navigationStack.length > 0) {
        navigationStack[navigationStack.length - 1] = state;
      } else {
        navigationStack.push(state);
      }

      const url = options.url ?? `#${route}`;
      history.replaceState(state, '', url);

      navListeners.forEach((cb) => cb({ type: 'replace', route, state }));
    },

    currentRoute() {
      return navigationStack.length > 0 ? navigationStack[navigationStack.length - 1].route : null;
    },

    stackDepth() {
      return navigationStack.length;
    },

    canGoBack() {
      return navigationStack.length > 1;
    },

    onNavigate(callback) {
      navListeners.push(callback);
      return () => {
        const idx = navListeners.indexOf(callback);
        if (idx > -1) navListeners.splice(idx, 1);
      };
    },

    reset(initialRoute = 'home') {
      navigationStack.length = 0;
      this.replace(initialRoute);
    },
  };
}
