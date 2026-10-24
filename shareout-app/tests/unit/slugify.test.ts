import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/slugify';
import { generateSlug } from '../../src/validation';
import { generateFolderSlug } from '../../src/folders';
import { generateWorkspaceSlug } from '../../src/workspaces/slug';
import { slugifyName } from '../../src/catalog/seed';
import { toSkillName } from '../../src/skills/markdown';

describe('slugify transliterates instead of dropping letters', () => {
  it.each([
    ['Resumen semanal de gestión', 'resumen-semanal-de-gestion'],
    ['Inducción INCRO', 'induccion-incro'],
    ['Flujograma PG-08 Cotización', 'flujograma-pg-08-cotizacion'],
    ['Año nuevo', 'ano-nuevo'],
    ['Pingüino', 'pinguino'],
    // pt
    ['Relatório de Ação Preventiva', 'relatorio-de-acao-preventiva'],
    ['Coração', 'coracao'],
    // fr
    ['Café crème brûlée à Noël', 'cafe-creme-brulee-a-noel'],
    ['Œuvre d’art', 'oeuvre-d-art'],
    // de
    ['Größe über Äpfel', 'grosse-uber-apfel'],
    ['Straße', 'strasse'],
    // other latin
    ['Æther Łódź Øl', 'aether-lodz-ol'],
  ])('%s -> %s', (input, out) => {
    expect(slugify(input)).toBe(out);
  });

  it('leaves an already-clean slug unchanged and trims dashes', () => {
    expect(slugify('already-clean-slug-2')).toBe('already-clean-slug-2');
    expect(slugify('  --Hello,   World!--  ')).toBe('hello-world');
  });

  it('returns empty when nothing survives and applies max length', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('abcdefghij', 5)).toBe('abcde');
  });
});

describe('every slug generator shares it', () => {
  it('publish, folders, workspaces, catalog and skills all transliterate', () => {
    expect(generateSlug('Resumen semanal de gestión')).toBe('resumen-semanal-de-gestion');
    expect(generateFolderSlug('Cotización')).toBe('cotizacion');
    expect(generateWorkspaceSlug('Año Nuevo')).toBe('ano-nuevo');
    expect(slugifyName('Conexión Producción')).toBe('conexion-produccion');
    expect(toSkillName('Guía de Diseño')).toBe('guia-de-diseno');
  });

  it('keeps the fallbacks', () => {
    expect(generateSlug('!!!')).toBe('artifact');
    expect(generateFolderSlug('???')).toBe('folder');
    expect(generateWorkspaceSlug('???')).toBe('workspace');
  });
});
