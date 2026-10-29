/** Progress lines the build agent streams while it works, in the reader's language. */
import type { LocaleCopy } from '../i18n';

export const AGENT_PROGRESS_COPY: LocaleCopy<{
  planning: string;
  writing: (path: string) => string;
  editing: (path: string) => string;
  checking: string;
  fixing: (errors: number) => string;
  publishing: string;
  testing: string;
  fixingLive: (errors: number) => string;
  finishing: string;
}> = {
  en: {
    planning: 'Planning your page…',
    writing: (path) => (/\.html?$/i.test(path) ? 'Writing the page structure…' : /\.css$/i.test(path) ? 'Writing styles…' : /\.m?js$/i.test(path) ? 'Writing the page logic…' : `Writing ${path}…`),
    editing: (path) => `Refining ${path}…`,
    checking: 'Checking the code…',
    fixing: (n) => `Fixing ${n} ${n === 1 ? 'error' : 'errors'}…`,
    publishing: 'Publishing it…',
    testing: 'Testing the page…',
    fixingLive: (n) => `Fixing ${n} ${n === 1 ? 'problem' : 'problems'} found while testing…`,
    finishing: 'Making it live…',
  },
  es: {
    planning: 'Planeando tu página…',
    writing: (path) => (/\.html?$/i.test(path) ? 'Escribiendo la estructura…' : /\.css$/i.test(path) ? 'Escribiendo estilos…' : /\.m?js$/i.test(path) ? 'Escribiendo la lógica…' : `Escribiendo ${path}…`),
    editing: (path) => `Ajustando ${path}…`,
    checking: 'Revisando el código…',
    fixing: (n) => `Corrigiendo ${n} ${n === 1 ? 'error' : 'errores'}…`,
    publishing: 'Publicándola…',
    testing: 'Probando la página…',
    fixingLive: (n) => `Corrigiendo ${n} ${n === 1 ? 'problema' : 'problemas'} que aparecieron al probar…`,
    finishing: 'Dejándola en vivo…',
  },
};
