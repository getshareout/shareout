---
title: Mobile & PWA overview
description: Turn any ShareOut artifact into a native-feeling mobile app with device detection, touch gestures, and optional PWA installation.
---

ShareOut artifacts are responsive by default. Add `mobile_html` and `pwa` to your publish call and you get automatic device detection, app-like navigation, offline support, and an "Add to Home Screen" prompt — with no separate build pipeline.

## Web vs. mobile

| | Responsive HTML | ShareOut Mobile |
|---|---|---|
| Add to homescreen | Browser bookmark | Native app icon + splash |
| Full-screen mode | Always has URL bar | No browser chrome |
| Offline support | Requires connection | Service worker caching |
| Touch gestures | Basic scrolling | Swipe nav, pull-refresh |
| Navigation | Links only | Bottom tabs, stack, drawer |
| Transitions | Page reloads | Native-feel animations |

## How device detection works

Publish one artifact with both versions. ShareOut serves the right one automatically:

| User agent | Version served |
|---|---|
| Desktop browser | `html` |
| Mobile browser | `mobile_html` (if provided) |
| Tablet | `html` by default |

Override with `?v=web` or `?v=mobile`.

## Publish both versions

```javascript
const sdk = new ShareOut();

await sdk.publish({
  slug: 'my-app',
  title: 'My App',
  html: webHtml,          // served to desktop
  mobile_html: mobileHtml // served to mobile browsers
});
```

Add the `pwa` key to make the artifact installable — see [PWA setup](/mobile/pwa/).

## Navigation patterns

The mobile SDK (`shareout-mobile.js`) ships three navigation styles:

**Bottom tabs** — main navigation, thumb-reachable:

```javascript
ShareOut.mobile.navigation({ type: 'bottom-tabs', tabs: [
  { id: 'home',    icon: 'home',   label: 'Home' },
  { id: 'search',  icon: 'search', label: 'Search' },
  { id: 'profile', icon: 'user',   label: 'Profile' }
], onChange: tabId => showView(tabId) });
```

**Stack** — push/pop screens with animated transitions:

```javascript
ShareOut.mobile.navigation({ type: 'stack', initialView: 'list' });
ShareOut.mobile.push('detail', { id: 123 });
ShareOut.mobile.pop();
```

**Drawer** — slide-in side menu:

```javascript
ShareOut.mobile.navigation({ type: 'drawer', position: 'left', items: [
  { id: 'dashboard', icon: 'grid', label: 'Dashboard' },
  { id: 'settings',  icon: 'cog',  label: 'Settings' }
] });
```

## Touch interactions

```javascript
// Swipe between views
ShareOut.mobile.swipe({ element: '#main',
  onSwipeLeft:  () => showNextView(),
  onSwipeRight: () => showPrevView()
});

// Pull to refresh
ShareOut.mobile.pullToRefresh({ element: '#content',
  onRefresh: async () => fetchNewData()
});

// Haptic feedback
ShareOut.mobile.haptic('success'); // light | medium | heavy | success | error
```

## Design principles

- **Thumb-first** — primary actions in the bottom 60 % of the screen.
- **Tap targets ≥ 48 × 48 px** — use padding to expand small icons.
- **Content > chrome** — keep navigation bars thin; let content dominate.
- **Immediate feedback** — touch highlight in < 100 ms, spinner after 300 ms.
- **Offline-first** — show cached data and a banner when the connection drops.
- **Respect system settings** — `prefers-color-scheme`, `prefers-reduced-motion`.

## When to use mobile_html

Add a separate `mobile_html` when:

- Navigation needs to move to the bottom of the screen.
- Cards should stack vertically rather than in a grid.
- You want swipe gestures or pull-to-refresh.
- The desktop layout relies on hover states or wide sidebars.

A single responsive layout is fine for reports and read-only dashboards that reflow cleanly at narrow widths.

## Browser support

| Feature | iOS Safari | Chrome Android | Samsung Internet |
|---|---|---|---|
| PWA install | 14+ | 72+ | 12+ |
| Service worker | 11.3+ | 45+ | 4+ |
| Web App Manifest | 11.3+ | 39+ | 4+ |
| Haptic feedback | 13+ | 89+ | Limited |
| Fullscreen API | 12+ | 38+ | 4+ |

## Next steps

- [PWA setup](/mobile/pwa/) — manifest, offline caching, install prompt, icons.
- [SDK reference](/sdk/json/) — data stores work the same in PWA mode.
