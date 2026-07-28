# Native overflow-anchor for layout-shift preservation, not a JS ResizeObserver

To keep the reader's place when content above the viewport resizes (images load,
markdown/code expands), we rely on the browser's native CSS `overflow-anchor: auto`
rather than a JS `ResizeObserver` that measures height deltas and compensates
`scrollTop`. The only case CSS can't handle — the deliberate "load earlier" prepend in
the dock — is handled explicitly via `ScrollController.preserveOnPrepend` (capture and
restore `scrollHeight`).

Trade-off: Safari ignores `overflow-anchor`, so it loses automatic anchoring on
mid-stream reflow above the fold (the reader shifts slightly, same as before this
change). Accepted for far less code and no observer lifecycle to leak; revisit with a
targeted observer if QA shows Safari jank.
