import { dispatchAction } from './dispatch';
import { generateEditorId } from './ids';
import { jsonResponse } from './response';
import type { SDKEditorHandler } from './types';

export const handleSlidesEditor: SDKEditorHandler = async (request, ctx, action) => {
  const { artifactId, env } = ctx;

  return dispatchAction(action, {
    get: async () => {
      const slides = await env.DB.prepare(`
        SELECT id, position, content_html, background, transition_type, transition_duration, hidden, speaker_notes
        FROM artifact_slides
        WHERE artifact_id = ?
        ORDER BY position
      `).bind(artifactId).all<{
        id: string;
        position: number;
        content_html: string;
        background: string | null;
        transition_type: string | null;
        transition_duration: number | null;
        hidden: number;
        speaker_notes: string | null;
      }>();

      const config = await env.DB.prepare(`
        SELECT title, aspect_ratio, default_transition, auto_play_interval
        FROM artifact_presentation_config
        WHERE artifact_id = ?
      `).bind(artifactId).first<{
        title: string;
        aspect_ratio: string;
        default_transition: string;
        auto_play_interval: number;
      }>();

      return jsonResponse({
        success: true,
        presentation: {
          title: config?.title || 'Untitled Presentation',
          aspectRatio: config?.aspect_ratio || '16:9',
          defaultTransition: config?.default_transition || 'fade',
          autoPlayInterval: config?.auto_play_interval || 0,
        },
        slides: slides.results?.map(s => ({
          id: s.id,
          position: s.position,
          content: s.content_html,
          background: s.background,
          transition: s.transition_type ? {
            type: s.transition_type,
            duration: s.transition_duration || 500,
          } : null,
          hidden: s.hidden === 1,
          speakerNotes: s.speaker_notes,
        })) || [],
      });
    },

    config: async () => {
      const body = await request.json() as {
        title?: string;
        aspectRatio?: string;
        defaultTransition?: string;
        autoPlayInterval?: number;
      };

      await env.DB.prepare(`
        INSERT INTO artifact_presentation_config
        (artifact_id, title, aspect_ratio, default_transition, auto_play_interval)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(artifact_id) DO UPDATE SET
          title = excluded.title,
          aspect_ratio = excluded.aspect_ratio,
          default_transition = excluded.default_transition,
          auto_play_interval = excluded.auto_play_interval
      `).bind(
        artifactId,
        body.title || 'Untitled',
        body.aspectRatio || '16:9',
        body.defaultTransition || 'fade',
        body.autoPlayInterval || 0
      ).run();

      return jsonResponse({ success: true });
    },

    add: async () => {
      const body = await request.json() as {
        content?: string;
        position?: number;
      };

      const slideId = generateEditorId('slide');

      const max = await env.DB.prepare(`
        SELECT MAX(position) as max_pos FROM artifact_slides WHERE artifact_id = ?
      `).bind(artifactId).first<{ max_pos: number | null }>();

      const position = body.position ?? ((max?.max_pos || 0) + 1);

      await env.DB.prepare(`
        INSERT INTO artifact_slides (id, artifact_id, position, content_html, created_at)
        VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `).bind(slideId, artifactId, position, body.content || '<div class="slide"></div>').run();

      return jsonResponse({ success: true, id: slideId });
    },

    update: async () => {
      const body = await request.json() as {
        id: string;
        content?: string;
        background?: string;
        transition?: { type: string; duration: number };
        hidden?: boolean;
        speakerNotes?: string;
      };

      await env.DB.prepare(`
        UPDATE artifact_slides SET
          content_html = COALESCE(?, content_html),
          background = COALESCE(?, background),
          transition_type = ?,
          transition_duration = ?,
          hidden = ?,
          speaker_notes = ?
        WHERE id = ? AND artifact_id = ?
      `).bind(
        body.content || null,
        body.background || null,
        body.transition?.type || null,
        body.transition?.duration || null,
        body.hidden ? 1 : 0,
        body.speakerNotes || null,
        body.id,
        artifactId
      ).run();

      return jsonResponse({ success: true });
    },

    reorder: async () => {
      const body = await request.json() as { slideIds: string[] };

      for (let i = 0; i < body.slideIds.length; i++) {
        await env.DB.prepare(`
          UPDATE artifact_slides SET position = ? WHERE id = ? AND artifact_id = ?
        `).bind(i, body.slideIds[i], artifactId).run();
      }

      return jsonResponse({ success: true });
    },

    delete: async () => {
      const body = await request.json() as { id: string };

      await env.DB.prepare(`
        DELETE FROM artifact_slides WHERE id = ? AND artifact_id = ?
      `).bind(body.id, artifactId).run();

      return jsonResponse({ success: true });
    },
  });
};
