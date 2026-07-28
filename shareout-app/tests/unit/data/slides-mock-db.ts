import { vi } from 'vitest';
import type { DbPresentation, DbSlide } from '../../../src/data/slides/db';

export interface StoredNote {
  id: string;
  slide_id: string;
  content: string;
  updated_at: string;
}

export interface StoredVersion {
  id: string;
  presentation_id: string;
  name: string;
  description: string | null;
  snapshot: string;
  slide_count: number;
  created_by_id: string | null;
  created_by_name: string | null;
  is_auto_save: number;
  created_at: string;
}

export interface StoredPresenterState {
  presentation_id: string;
  is_presenting: number;
  presenter_id: string | null;
  presenter_name: string | null;
  current_slide_index: number;
  started_at: string | null;
  slide_started_at: string | null;
  countdown_total: number | null;
  countdown_remaining: number | null;
  countdown_paused: number | null;
  laser_enabled: number | null;
  laser_x: number | null;
  laser_y: number | null;
  updated_at: string;
}

export interface SlidesStore {
  presentations: DbPresentation[];
  slides: DbSlide[];
  notes: StoredNote[];
  versions: StoredVersion[];
  states: StoredPresenterState[];
}

const DEFAULT_FONTS = JSON.stringify({ heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' });
const DEFAULT_COLORS = JSON.stringify({ background: '#0f172a', text: '#f8fafc', accent: '#3b82f6' });
const DEFAULT_TRANSITION = JSON.stringify({ type: 'fade', duration: 300 });

export function makePresentation(overrides: Partial<DbPresentation> = {}): DbPresentation {
  const now = '2026-05-30T12:00:00.000Z';
  return {
    id: overrides.id ?? 'pres_' + 'a'.repeat(24),
    artifact_id: overrides.artifact_id ?? 'art_test',
    title: overrides.title ?? 'Test Presentation',
    description: overrides.description ?? null,
    width: overrides.width ?? 1920,
    height: overrides.height ?? 1080,
    aspect_ratio: overrides.aspect_ratio ?? '16:9',
    template: overrides.template ?? null,
    default_fonts: overrides.default_fonts ?? DEFAULT_FONTS,
    default_colors: overrides.default_colors ?? DEFAULT_COLORS,
    default_transition: overrides.default_transition ?? DEFAULT_TRANSITION,
    published_artifact_id: overrides.published_artifact_id ?? null,
    visibility: overrides.visibility ?? 'private',
    created_by: overrides.created_by ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

export function makeSlide(overrides: Partial<DbSlide> = {}): DbSlide {
  const now = '2026-05-30T12:00:00.000Z';
  return {
    id: overrides.id ?? 'slide_' + 'b'.repeat(24),
    presentation_id: overrides.presentation_id ?? 'pres_aaaaaaaaaaaaaaaaaaaaaaaa',
    position: overrides.position ?? 0,
    owner_id: overrides.owner_id ?? null,
    override_background: overrides.override_background ?? null,
    override_fonts: overrides.override_fonts ?? null,
    override_transition: overrides.override_transition ?? null,
    content: overrides.content ?? '',
    hidden: overrides.hidden ?? 0,
    locked: overrides.locked ?? 0,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
}

function slideJoinMatch(
  store: SlidesStore,
  artifactId: string,
  presId: string,
  slideId: string
): DbSlide | null {
  const pres = store.presentations.find((p) => p.id === presId && p.artifact_id === artifactId);
  if (!pres) return null;
  return store.slides.find((s) => s.presentation_id === presId && s.id === slideId) ?? null;
}

function handleFirst(sql: string, args: unknown[], store: SlidesStore): unknown {
  if (sql.includes('SELECT id FROM presentations WHERE artifact_id = ? AND id = ?')) {
    const [artifactId, presId] = args as [string, string];
    const pres = store.presentations.find((p) => p.artifact_id === artifactId && p.id === presId);
    return pres ? { id: pres.id } : null;
  }

  if (sql.includes('SELECT COUNT(*) as cnt FROM slides WHERE presentation_id = ?')) {
    const presId = args[0] as string;
    return { cnt: store.slides.filter((s) => s.presentation_id === presId).length };
  }

  if (sql.includes('SELECT position FROM slides WHERE presentation_id = ? AND id = ?')) {
    const [presId, slideId] = args as [string, string];
    const slide = store.slides.find((s) => s.presentation_id === presId && s.id === slideId);
    return slide ? { position: slide.position } : null;
  }

  if (sql.includes('SELECT MAX(position) as max FROM slides WHERE presentation_id = ?')) {
    const presId = args[0] as string;
    const positions = store.slides.filter((s) => s.presentation_id === presId).map((s) => s.position);
    return { max: positions.length ? Math.max(...positions) : null };
  }

  if (sql.includes('SELECT * FROM slides WHERE id = ?') && !sql.includes('presentation_id')) {
    const slideId = args[0] as string;
    return store.slides.find((s) => s.id === slideId) ?? null;
  }

  if (sql.includes('SELECT * FROM slides WHERE presentation_id = ? AND id = ?')) {
    const [presId, slideId] = args as [string, string];
    return store.slides.find((s) => s.presentation_id === presId && s.id === slideId) ?? null;
  }

  if (sql.includes('JOIN presentations p ON s.presentation_id = p.id')) {
    const [artifactId, presId, slideId] = args as [string, string, string];
    return slideJoinMatch(store, artifactId, presId, slideId);
  }

  if (sql.includes('SELECT content FROM slide_notes WHERE slide_id = ?')) {
    const slideId = args[0] as string;
    const note = store.notes.find((n) => n.slide_id === slideId);
    return note ? { content: note.content } : null;
  }

  if (sql.includes('SELECT * FROM presentations WHERE artifact_id = ? AND id = ?')) {
    const [artifactId, presId] = args as [string, string];
    return store.presentations.find((p) => p.artifact_id === artifactId && p.id === presId) ?? null;
  }

  if (sql.includes('SELECT * FROM presentations WHERE id = ?')) {
    const presId = args[0] as string;
    return store.presentations.find((p) => p.id === presId) ?? null;
  }

  if (sql.includes('SELECT id FROM presentations WHERE artifact_id = ? AND id = ?')) {
    const [artifactId, presId] = args as [string, string];
    const pres = store.presentations.find((p) => p.artifact_id === artifactId && p.id === presId);
    return pres ? { id: pres.id } : null;
  }

  if (sql.includes('SELECT visibility, published_artifact_id FROM presentations WHERE id = ?')) {
    const presId = args[0] as string;
    const pres = store.presentations.find((p) => p.id === presId);
    return pres ? { visibility: pres.visibility, published_artifact_id: pres.published_artifact_id } : null;
  }

  if (sql.includes('SELECT COUNT(*) as cnt FROM presentation_versions WHERE presentation_id = ? AND is_auto_save = 1')) {
    const presId = args[0] as string;
    return {
      cnt: store.versions.filter((v) => v.presentation_id === presId && v.is_auto_save === 1).length,
    };
  }

  if (sql.includes('SELECT COUNT(*) as cnt FROM presentation_versions WHERE presentation_id = ?')) {
    const presId = args[0] as string;
    return { cnt: store.versions.filter((v) => v.presentation_id === presId).length };
  }

  if (sql.includes('SELECT id FROM presentation_versions WHERE presentation_id = ? AND is_auto_save = 1 ORDER BY created_at ASC LIMIT 1')) {
    const presId = args[0] as string;
    const oldest = store.versions
      .filter((v) => v.presentation_id === presId && v.is_auto_save === 1)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return oldest ? { id: oldest.id } : null;
  }

  if (sql.includes('SELECT * FROM presentation_versions WHERE presentation_id = ? AND id = ?')) {
    const [presId, versionId] = args as [string, string];
    return store.versions.find((v) => v.presentation_id === presId && v.id === versionId) ?? null;
  }

  if (sql.includes('SELECT * FROM presentation_versions WHERE id = ?')) {
    const versionId = args[0] as string;
    return store.versions.find((v) => v.id === versionId) ?? null;
  }

  if (sql.includes('SELECT snapshot FROM presentation_versions WHERE presentation_id = ? AND id = ?')) {
    const [presId, versionId] = args as [string, string];
    const version = store.versions.find((v) => v.presentation_id === presId && v.id === versionId);
    return version ? { snapshot: version.snapshot } : null;
  }

  if (sql.includes('SELECT id FROM presentation_versions WHERE presentation_id = ? AND id = ?')) {
    const [presId, versionId] = args as [string, string];
    const version = store.versions.find((v) => v.presentation_id === presId && v.id === versionId);
    return version ? { id: version.id } : null;
  }

  if (sql.includes('SELECT * FROM presentation_state WHERE presentation_id = ?')) {
    const presId = args[0] as string;
    return store.states.find((s) => s.presentation_id === presId) ?? null;
  }

  if (sql.includes('SELECT presenter_id FROM presentation_state WHERE presentation_id = ?')) {
    const presId = args[0] as string;
    const state = store.states.find((s) => s.presentation_id === presId);
    return state ? { presenter_id: state.presenter_id } : null;
  }

  return null;
}

function handleAll(sql: string, args: unknown[], store: SlidesStore): { results: unknown[] } {
  if (sql.includes('SELECT * FROM presentations WHERE artifact_id = ? ORDER BY updated_at DESC')) {
    const artifactId = args[0] as string;
    return {
      results: store.presentations
        .filter((p) => p.artifact_id === artifactId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    };
  }

  if (sql.includes('SELECT * FROM slides WHERE presentation_id = ? ORDER BY position ASC')) {
    const presId = args[0] as string;
    return {
      results: store.slides
        .filter((s) => s.presentation_id === presId)
        .sort((a, b) => a.position - b.position),
    };
  }

  if (sql.includes('SELECT id, presentation_id, name, description, slide_count') && sql.includes('FROM presentation_versions')) {
    const presId = args[0] as string;
    return {
      results: store.versions
        .filter((v) => v.presentation_id === presId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((v) => ({
          id: v.id,
          presentation_id: v.presentation_id,
          name: v.name,
          description: v.description,
          slide_count: v.slide_count,
          created_by_id: v.created_by_id,
          created_by_name: v.created_by_name,
          is_auto_save: v.is_auto_save,
          created_at: v.created_at,
        })),
    };
  }

  if (sql.includes('SELECT slide_id, content FROM slide_notes WHERE slide_id IN')) {
    const presId = args[0] as string;
    const slideIds = new Set(store.slides.filter((s) => s.presentation_id === presId).map((s) => s.id));
    return {
      results: store.notes.filter((n) => slideIds.has(n.slide_id)).map((n) => ({
        slide_id: n.slide_id,
        content: n.content,
      })),
    };
  }

  return { results: [] };
}

function handleRun(sql: string, args: unknown[], store: SlidesStore): { success: boolean } {
  if (sql.includes('INSERT INTO presentations')) {
    const [
      id,
      artifact_id,
      title,
      description,
      width,
      height,
      aspect_ratio,
      template,
      default_fonts,
      default_colors,
      visibility,
      created_by,
      created_at,
      updated_at,
    ] = args as string[];
    store.presentations.push({
      id,
      artifact_id,
      title,
      description: description as string | null,
      width: width as unknown as number,
      height: height as unknown as number,
      aspect_ratio,
      template: template as string | null,
      default_fonts,
      default_colors,
      default_transition: DEFAULT_TRANSITION,
      published_artifact_id: null,
      visibility,
      created_by: created_by as string | null,
      created_at,
      updated_at,
    });
    return { success: true };
  }

  if (sql.includes('INSERT INTO slides')) {
    if (sql.includes('override_background')) {
      const [
        id,
        presentation_id,
        position,
        owner_id,
        override_background,
        override_fonts,
        override_transition,
        content,
        hidden,
        locked,
        created_at,
        updated_at,
      ] = args as (string | number | null)[];
      store.slides.push({
        id: id as string,
        presentation_id: presentation_id as string,
        position: position as number,
        owner_id: owner_id as string | null,
        override_background: override_background as string | null,
        override_fonts: override_fonts as string | null,
        override_transition: override_transition as string | null,
        content: content as string,
        hidden: hidden as number,
        locked: locked as number,
        created_at: created_at as string,
        updated_at: updated_at as string,
      });
    } else if (sql.includes('content, hidden, locked')) {
      const [id, presentation_id, position, owner_id, content, hidden, locked, created_at, updated_at] =
        args as (string | number | null)[];
      store.slides.push(
        makeSlide({
          id: id as string,
          presentation_id: presentation_id as string,
          position: Number(position),
          owner_id: (owner_id as string) || null,
          content: content as string,
          hidden: hidden as number,
          locked: locked as number,
          created_at: created_at as string,
          updated_at: updated_at as string,
        })
      );
    } else if (sql.includes('owner_id, content')) {
      const [id, presentation_id, position, owner_id, content, created_at, updated_at] = args as string[];
      store.slides.push(
        makeSlide({
          id,
          presentation_id,
          position: Number(position),
          owner_id: owner_id || null,
          content,
          created_at,
          updated_at,
        })
      );
    } else {
      const [id, presentation_id, position, content, created_at, updated_at] = args as (string | number)[];
      store.slides.push(
        makeSlide({
          id: id as string,
          presentation_id: presentation_id as string,
          position: position as number,
          content: content as string,
          created_at: created_at as string,
          updated_at: updated_at as string,
        })
      );
    }
    return { success: true };
  }

  if (sql.includes('INSERT INTO slide_notes')) {
    const [id, slide_id, content, updated_at] = args as string[];
    const existing = store.notes.findIndex((n) => n.slide_id === slide_id);
    if (existing >= 0) {
      store.notes[existing] = { ...store.notes[existing], content, updated_at };
    } else {
      store.notes.push({ id, slide_id, content, updated_at });
    }
    return { success: true };
  }

  if (sql.includes('INSERT INTO presentation_versions')) {
    const [
      id,
      presentation_id,
      name,
      description,
      snapshot,
      slide_count,
      created_by_id,
      created_by_name,
      is_auto_save,
    ] = args as (string | number | null)[];
    store.versions.push({
      id: id as string,
      presentation_id: presentation_id as string,
      name: name as string,
      description: description as string | null,
      snapshot: snapshot as string,
      slide_count: slide_count as number,
      created_by_id: created_by_id as string | null,
      created_by_name: created_by_name as string | null,
      is_auto_save: is_auto_save as number,
      created_at: new Date().toISOString(),
    });
    return { success: true };
  }

  if (sql.includes('INSERT INTO presentation_state')) {
    const presentation_id = args[0] as string;
    const presenter_id = args[1] as string | null;
    const presenter_name = args[2] as string | null;
    const current_slide_index = args[3] as number;
    const started_at = args[4] as string;
    const slide_started_at = args[5] as string;
    const countdown_total = args[6] as number | null;
    const countdown_remaining = args[7] as number | null;
    const updated_at = args[8] as string;
    const existing = store.states.findIndex((s) => s.presentation_id === presentation_id);
    const state: StoredPresenterState = {
      presentation_id,
      is_presenting: 1,
      presenter_id,
      presenter_name,
      current_slide_index,
      started_at,
      slide_started_at,
      countdown_total,
      countdown_remaining,
      countdown_paused: 0,
      laser_enabled: 0,
      laser_x: null,
      laser_y: null,
      updated_at,
    };
    if (existing >= 0) store.states[existing] = state;
    else store.states.push(state);
    return { success: true };
  }

  if (sql.includes('UPDATE slides SET position = position + 1')) {
    const [presId, position] = args as [string, number];
    for (const slide of store.slides) {
      if (slide.presentation_id === presId && slide.position >= position) {
        slide.position += 1;
      }
    }
    return { success: true };
  }

  if (sql.includes('UPDATE slides SET position = position - 1')) {
    const [presId, position] = args as [string, number];
    for (const slide of store.slides) {
      if (slide.presentation_id === presId && slide.position > position) {
        slide.position -= 1;
      }
    }
    return { success: true };
  }

  if (sql.includes('UPDATE slides SET position = ? WHERE presentation_id = ? AND id = ?')) {
    const [position, presId, slideId] = args as [number, string, string];
    const slide = store.slides.find((s) => s.presentation_id === presId && s.id === slideId);
    if (slide) slide.position = position;
    return { success: true };
  }

  if (sql.includes('UPDATE slides SET locked = 1')) {
    const [, slideId] = args as [string, string];
    const slide = store.slides.find((s) => s.id === slideId);
    if (slide) slide.locked = 1;
    return { success: true };
  }

  if (sql.includes('UPDATE slides SET locked = 0')) {
    const [, slideId] = args as [string, string];
    const slide = store.slides.find((s) => s.id === slideId);
    if (slide) slide.locked = 0;
    return { success: true };
  }

  if (sql.includes('UPDATE slides SET owner_id = ?')) {
    const [ownerId, , slideId] = args as [string | null, string, string];
    const slide = store.slides.find((s) => s.id === slideId);
    if (slide) slide.owner_id = ownerId;
    return { success: true };
  }

  if (sql.startsWith('UPDATE slides SET ') && sql.includes('WHERE id = ?') && !sql.includes('locked =')) {
    const slideId = args[args.length - 1] as string;
    const slide = store.slides.find((s) => s.id === slideId);
    if (slide) {
      const setClause = sql.match(/SET (.+?) WHERE id = \?/i)?.[1] ?? '';
      const fields = setClause.split(', ').map((f) => f.trim());
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const value = args[i];
        if (field === 'content = ?') slide.content = value as string;
        else if (field === 'hidden = ?') slide.hidden = value as number;
        else if (field === 'override_background = ?') slide.override_background = value as string | null;
        else if (field === 'override_fonts = ?') slide.override_fonts = value as string | null;
        else if (field === 'override_transition = ?') slide.override_transition = value as string | null;
        else if (field === 'owner_id = ?') slide.owner_id = value as string | null;
        else if (field === 'updated_at = ?') slide.updated_at = value as string;
      }
    }
    return { success: true };
  }

  if (sql.includes('UPDATE presentations SET')) {
    const presId = args[args.length - 1] as string;
    const pres = store.presentations.find((p) => p.id === presId);
    if (pres) {
      if (sql.includes("visibility = 'private'")) {
        pres.visibility = 'private';
        pres.updated_at = args[0] as string;
      } else if (sql.includes("visibility = 'public'")) {
        pres.visibility = 'public';
        pres.updated_at = args[0] as string;
      } else {
        const setClause = sql.match(/SET (.+?) WHERE id = \?/i)?.[1] ?? '';
        const fields = setClause.split(', ').map((f) => f.trim());
        for (let i = 0; i < fields.length; i++) {
          const field = fields[i];
          const value = args[i];
          if (field === 'title = ?') pres.title = value as string;
          else if (field === 'description = ?') pres.description = value as string | null;
          else if (field === 'width = ?') pres.width = value as number;
          else if (field === 'height = ?') pres.height = value as number;
          else if (field === 'aspect_ratio = ?') pres.aspect_ratio = value as string;
          else if (field === 'template = ?') pres.template = value as string | null;
          else if (field === 'default_fonts = ?') pres.default_fonts = value as string;
          else if (field === 'default_colors = ?') pres.default_colors = value as string;
          else if (field === 'default_transition = ?') pres.default_transition = value as string;
          else if (field === 'visibility = ?') pres.visibility = value as string;
          else if (field === 'updated_at = ?') pres.updated_at = value as string;
        }
      }
    }
    return { success: true };
  }

  if (sql.includes('UPDATE presentation_state SET is_presenting = 0')) {
    const [, presId] = args as [string, string];
    const state = store.states.find((s) => s.presentation_id === presId);
    if (state) state.is_presenting = 0;
    return { success: true };
  }

  if (sql.includes('UPDATE presentation_state SET current_slide_index = ?')) {
    const [slideIndex, , , presId] = args as [number, string, string, string];
    const state = store.states.find((s) => s.presentation_id === presId);
    if (state) {
      state.current_slide_index = slideIndex;
      state.slide_started_at = args[1] as string;
      state.updated_at = args[2] as string;
    }
    return { success: true };
  }

  if (sql.includes('UPDATE presentation_state SET countdown_total = ?')) {
    const [total, remaining, , presId] = args as [number, number, string, string];
    const state = store.states.find((s) => s.presentation_id === presId);
    if (state) {
      state.countdown_total = total;
      state.countdown_remaining = remaining;
      state.countdown_paused = 0;
    }
    return { success: true };
  }

  if (sql.includes('UPDATE presentation_state SET countdown_paused = 1')) {
    const [, presId] = args as [string, string];
    const state = store.states.find((s) => s.presentation_id === presId);
    if (state) state.countdown_paused = 1;
    return { success: true };
  }

  if (sql.includes('UPDATE presentation_state SET countdown_paused = 0') && sql.includes('countdown_remaining = countdown_total')) {
    const [, presId] = args as [string, string];
    const state = store.states.find((s) => s.presentation_id === presId);
    if (state) {
      state.countdown_remaining = state.countdown_total;
      state.countdown_paused = 0;
    }
    return { success: true };
  }

  if (sql.includes('UPDATE presentation_state SET countdown_paused = 0') && !sql.includes('countdown_remaining = countdown_total')) {
    const [, presId] = args as [string, string];
    const state = store.states.find((s) => s.presentation_id === presId);
    if (state) state.countdown_paused = 0;
    return { success: true };
  }

  if (sql.includes('UPDATE presentation_state SET laser_enabled = ?')) {
    const [enabled, x, y, , presId] = args as [number, number | null, number | null, string, string];
    const state = store.states.find((s) => s.presentation_id === presId);
    if (state) {
      state.laser_enabled = enabled;
      state.laser_x = x;
      state.laser_y = y;
    }
    return { success: true };
  }

  if (sql.includes('DELETE FROM slides WHERE id = ?')) {
    const slideId = args[0] as string;
    store.slides = store.slides.filter((s) => s.id !== slideId);
    return { success: true };
  }

  if (sql.includes('DELETE FROM slides WHERE presentation_id = ?')) {
    const presId = args[0] as string;
    store.slides = store.slides.filter((s) => s.presentation_id !== presId);
    return { success: true };
  }

  if (sql.includes('DELETE FROM presentations WHERE id = ?')) {
    const presId = args[0] as string;
    store.presentations = store.presentations.filter((p) => p.id !== presId);
    return { success: true };
  }

  if (sql.includes('DELETE FROM presentation_versions WHERE id = ?') && !sql.includes('WHERE id IN')) {
    const versionId = args[0] as string;
    store.versions = store.versions.filter((v) => v.id !== versionId);
    return { success: true };
  }

  if (sql.includes('DELETE FROM presentation_versions WHERE id IN')) {
    const [presId, excessCount] = args as [string, number];
    const autoSaves = store.versions
      .filter((v) => v.presentation_id === presId && v.is_auto_save === 1)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, excessCount);
    const removeIds = new Set(autoSaves.map((v) => v.id));
    store.versions = store.versions.filter((v) => !removeIds.has(v.id));
    return { success: true };
  }

  return { success: true };
}

export function createSlidesDb(initial?: Partial<SlidesStore>) {
  const store: SlidesStore = {
    presentations: [...(initial?.presentations ?? [])],
    slides: [...(initial?.slides ?? [])],
    notes: [...(initial?.notes ?? [])],
    versions: [...(initial?.versions ?? [])],
    states: [...(initial?.states ?? [])],
  };

  type BoundStmt = {
    first: ReturnType<typeof vi.fn>;
    all: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
    _sql: string;
    _args: unknown[];
  };

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]): BoundStmt => {
        const stmt: BoundStmt = {
          _sql: sql,
          _args: args,
          first: vi.fn(async () => handleFirst(sql, args, store)),
          all: vi.fn(async () => handleAll(sql, args, store)),
          run: vi.fn(async () => handleRun(sql, args, store)),
        };
        return stmt;
      }),
    })),
    batch: vi.fn(async (stmts: BoundStmt[]) => {
      for (const stmt of stmts) {
        await handleRun(stmt._sql, stmt._args, store);
      }
      return [{ success: true }];
    }),
  };

  return { db, store };
}
