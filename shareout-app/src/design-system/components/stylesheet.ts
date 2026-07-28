/**
 * Aggregates every component's CSS into one stylesheet and every stateful
 * component's browser script into one bundle.
 *
 * Server-rendered pages get the classes via renderHtmlPage() (base CSS vars are
 * already present). Contexts that DON'T ship base vars (the sandbox-viewer
 * toolbar) pass { withVars: true } so the custom properties are prepended.
 */

import { cssVariables } from '../base.css';
import { buttonClasses } from './button';
import { inputClasses } from './input';
import { modalClasses, modalScript } from './modal';
import { cardClasses } from './card';
import { badgeClasses } from './badge';
import { toastClasses, toastScript } from './toast';
import { themeClasses } from './themes';

export function componentStylesheet(opts?: { withVars?: boolean }): string {
  const sheet = [
    buttonClasses,
    inputClasses,
    modalClasses,
    cardClasses,
    badgeClasses,
    toastClasses,
    themeClasses,
  ].join('\n');
  return opts?.withVars ? cssVariables + sheet : sheet;
}

export const componentScripts = [modalScript, toastScript].join('\n');
