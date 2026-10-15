// The preamble's shared fetch-error helpers (okOr / failToast / errReason), for test
// harnesses that evaluate one client-script fragment without the preamble around it.
import { componentScripts } from '../../../src/design-system/components/index';

type Opt = {
  check(r: unknown): unknown;
  report(e: unknown, msg: string, retry?: () => void): unknown;
  text(e: unknown, msg: string): string;
};

/** Pass the harness's own showToast stub to see failToast as a plain [msg, 'error'] toast. */
export function fetchErrorHelpers(showToast?: (msg: string, kind: string) => void): Record<string, unknown> {
  const w = window as unknown as { soOptimistic?: Opt };
  if (!w.soOptimistic) (0, eval)(componentScripts);
  const o = () => w.soOptimistic as Opt;
  return {
    okOr: (r: unknown) => o().check(r),
    failToast: (e: unknown, msg: string, retry?: () => void) => (showToast ? showToast(msg, 'error') : o().report(e, msg, retry)),
    errReason: (e: unknown, msg: string) => o().text(e, msg),
  };
}
