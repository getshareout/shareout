# Reading behaviour lives in a pure-DOM ScrollController (core + opt-in layers)

All "never move the reader against their intent" behaviour is centralised in
`createScrollController` — a framework-agnostic controller over a scroll viewport
element, with no markup assumptions, so even the dock's bespoke `wsx-*` rows attach to
it. Unread tracking, the aria-live announcer, and in-thread search are **separate
composable helpers** (`createUnreadTracker`, `createLiveAnnouncer`, `createChatSearch`)
that take a controller, rather than methods on one god-object.

We chose core-plus-layers over a single fat controller so the embeddable SDK widget
ships only the core (it needs neither search nor a divider) while the dock composes
all of it, and so the core stays unit-testable in isolation. The cost is a few more
factory functions and the surface wiring that composes them.
