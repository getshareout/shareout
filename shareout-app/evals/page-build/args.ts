/** Command-line parsing for `npm run eval:builds`. Pure, so it is unit-tested. */

export type Command =
  | { cmd: 'list' }
  | { cmd: 'compare'; before: string; after: string }
  | { cmd: 'cleanup'; from: string; origin: string; tokenEnv: string }
  | { cmd: 'run'; origin: string; workspace: string; tokenEnv: string; only?: string[]; repeat: number; out?: string; verify: boolean; cleanup: boolean };

export const USAGE = `Usage:
  npm run eval:builds -- --origin <https://…> --workspace <wsp_…> --token-env <ENV_VAR>
        [--only id1,id2] [--repeat N] [--out evals/results/<name>.json] [--no-verify] [--cleanup]
  npm run eval:builds -- compare <before.json> <after.json>
  npm run eval:builds -- cleanup --from <results.json> --origin <https://…> --token-env <ENV_VAR>
  npm run eval:builds -- list

Each item is one real build on the instance's AI budget. The token is read from the named
environment variable and never printed.`;

export class UsageError extends Error {}

/** https only, except for a local dev instance. */
export function checkOrigin(origin: string): string {
  let u: URL;
  try { u = new URL(origin); } catch { throw new UsageError(`--origin is not a URL: ${origin}`); }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new UsageError('--origin must be https (http only for localhost)');
  return u.origin;
}

export function parseArgs(argv: string[]): Command {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  const valued = new Set(['origin', 'workspace', 'token-env', 'only', 'repeat', 'out', 'from']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const name = a.slice(2);
    if (valued.has(name)) {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`--${name} needs a value`);
      flags.set(name, v);
    } else if (['no-verify', 'cleanup', 'list', 'help'].includes(name)) flags.set(name, true);
    else throw new UsageError(`Unknown flag --${name}`);
  }
  const need = (name: string): string => {
    const v = flags.get(name);
    if (typeof v !== 'string') throw new UsageError(`--${name} is required`);
    return v;
  };

  const [first] = positional;
  if (flags.has('list') || first === 'list') return { cmd: 'list' };
  if (first === 'compare') {
    if (positional.length !== 3) throw new UsageError('compare needs two results files');
    return { cmd: 'compare', before: positional[1], after: positional[2] };
  }
  if (first === 'cleanup') return { cmd: 'cleanup', from: need('from'), origin: checkOrigin(need('origin')), tokenEnv: need('token-env') };
  if (first) throw new UsageError(`Unknown command ${first}`);

  const repeat = flags.has('repeat') ? Number(flags.get('repeat')) : 1;
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) throw new UsageError('--repeat must be a whole number from 1 to 10');
  const workspace = need('workspace');
  if (!/^[\w-]+$/.test(workspace)) throw new UsageError('--workspace must be a workspace id');
  return {
    cmd: 'run',
    origin: checkOrigin(need('origin')),
    workspace,
    tokenEnv: need('token-env'),
    only: typeof flags.get('only') === 'string' ? (flags.get('only') as string).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    repeat,
    out: typeof flags.get('out') === 'string' ? (flags.get('out') as string) : undefined,
    verify: !flags.has('no-verify'),
    cleanup: flags.has('cleanup'),
  };
}
