// Shared contracts consumed across the worker, SDK, and tooling.
// Keep this package free of runtime/platform dependencies — types and small
// constants only, so any zone can import it (plan §5.3, §5.4).
export * from './artifact';
