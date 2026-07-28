import puppeteer from '@cloudflare/puppeteer';
import { errorResponse, type DataContext } from '../middleware';
import { canEditPresentation } from './auth';
import type { DbPresentation, DbSlide } from './db';
import { mapPresentation } from './db';

const NAV_TIMEOUT = 20000;

type ExportFormat = 'pdf' | 'png';

interface DeckStyle {
  width: number;
  height: number;
  background: string;
  text: string;
  bodyFont: string;
}

function deckStyle(pres: ReturnType<typeof mapPresentation>): DeckStyle {
  return {
    width: pres.width || 1920,
    height: pres.height || 1080,
    background: pres.defaultColors?.background || '#0f172a',
    text: pres.defaultColors?.text || '#f8fafc',
    bodyFont: pres.defaultFonts?.body || 'Inter',
  };
}

function slideCss(s: DeckStyle): string {
  return `*{margin:0;padding:0;box-sizing:border-box}
html,body{background:${s.background}}
.slide{width:${s.width}px;height:${s.height}px;overflow:hidden;background:${s.background};color:${s.text};font-family:${s.bodyFont},system-ui,sans-serif;position:relative;page-break-after:always}`;
}

/** Full single-slide HTML document sized to the deck. Pure — unit-testable. */
export function buildSlideHtml(pres: ReturnType<typeof mapPresentation>, content: string): string {
  const s = deckStyle(pres);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${slideCss(s)}</style></head><body><div class="slide">${content}</div></body></html>`;
}

/** Full multi-slide HTML document, one page-break per slide. Pure — unit-testable. */
export function buildDeckHtml(pres: ReturnType<typeof mapPresentation>, contents: string[]): string {
  const s = deckStyle(pres);
  const slides = contents.map((c) => `<div class="slide">${c}</div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:${s.width}px ${s.height}px;margin:0}${slideCss(s)}</style></head><body>${slides}</body></html>`;
}

export async function handleExportRoute(request: Request, ctx: DataContext, presId: string): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }

  const url = new URL(request.url);
  const format = (url.searchParams.get('format') || 'pdf') as ExportFormat;
  const slideId = url.searchParams.get('slide');

  if (format !== 'pdf' && format !== 'png') {
    return errorResponse({ code: 'INVALID_FORMAT', message: 'format must be pdf or png', status: 400 });
  }

  const canEdit = await canEditPresentation(request, ctx, presId);
  if (!canEdit) {
    return errorResponse({ code: 'FORBIDDEN', message: 'Cannot export this presentation', status: 403 });
  }

  const presRow = await ctx.env.DB.prepare(`SELECT * FROM presentations WHERE artifact_id = ? AND id = ?`)
    .bind(ctx.artifactId, presId)
    .first<DbPresentation>();
  if (!presRow) {
    return errorResponse({ code: 'PRESENTATION_NOT_FOUND', message: 'Presentation not found', status: 404 });
  }
  const pres = mapPresentation(presRow);

  if (!ctx.env.BROWSER) {
    return errorResponse({ code: 'EXPORT_UNAVAILABLE', message: 'Browser rendering not configured', status: 503 });
  }

  const slidesResult = await ctx.env.DB.prepare(
    `SELECT * FROM slides WHERE presentation_id = ? ORDER BY position ASC`
  )
    .bind(presId)
    .all<DbSlide>();
  const slides = slidesResult.results;
  if (slides.length === 0) {
    return errorResponse({ code: 'NO_SLIDES', message: 'Presentation has no slides', status: 400 });
  }

  const style = deckStyle(pres);

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(ctx.env.BROWSER as Parameters<typeof puppeteer.launch>[0]);
    const page = await browser.newPage();
    await page.setViewport({ width: style.width, height: style.height, deviceScaleFactor: 1 });

    if (format === 'png') {
      const target = slideId ? slides.find((s) => s.id === slideId) : slides[0];
      if (!target) {
        return errorResponse({ code: 'SLIDE_NOT_FOUND', message: 'Slide not found', status: 404 });
      }
      await page.setContent(buildSlideHtml(pres, target.content || ''), { waitUntil: 'load', timeout: NAV_TIMEOUT });
      await page.evaluate(() => (globalThis as any).document?.fonts?.ready ?? Promise.resolve()).catch(() => {});
      const buf = (await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: style.width, height: style.height },
      })) as unknown as ArrayBuffer;
      return new Response(buf, { headers: { 'Content-Type': 'image/png' } });
    }

    await page.setContent(buildDeckHtml(pres, slides.map((s) => s.content || '')), {
      waitUntil: 'load',
      timeout: NAV_TIMEOUT,
    });
    await page.evaluate(() => (globalThis as any).document?.fonts?.ready ?? Promise.resolve()).catch(() => {});
    const pdf = (await page.pdf({
      width: `${style.width}px`,
      height: `${style.height}px`,
      printBackground: true,
      pageRanges: '',
    })) as unknown as ArrayBuffer;
    return new Response(pdf, { headers: { 'Content-Type': 'application/pdf' } });
  } catch (err) {
    console.error('slide export failed', { presId, format, error_stack: (err as Error)?.stack || String(err) });
    return errorResponse({ code: 'EXPORT_FAILED', message: 'Export failed', status: 502 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
