import { ShareOutError } from '../../../shareout-error';
import type { SdkClient } from '../../../core/sdk-client';
import { SlideHelpers } from '../../../presentation/slide-helpers';
import type { SlideSpec, SlideThemeInput } from '../../../presentation/slide-helpers';
import type { Slide, SlidesFonts, SlidesTransition } from '../types';

/**
 * CRUD and batch operations for slides within a presentation.
 * Maintains a local cache synchronized with the REST API and WebSocket events.
 */
export class SlidesManager {
  constructor(
    private sdk: SdkClient,
    private presId: string,
    private cached: Slide[],
    private observers: Set<(slides: Slide[]) => void>,
    private onUpdate: (slides: Slide[]) => void,
  ) {}

  list(): Slide[] {
    return this.cached;
  }

  async refresh(): Promise<Slide[]> {
    const result = await this.sdk._internalFetch<{ slides: Slide[]; count: number }>(
      `/slides/${encodeURIComponent(this.presId)}/slides`,
    );
    this.cached = result.slides;
    return result.slides;
  }

  observe(handler: (slides: Slide[]) => void): () => void {
    this.observers.add(handler);
    return () => this.observers.delete(handler);
  }

  async add(options: { position?: number; content?: string; afterSlideId?: string } = {}): Promise<Slide> {
    const slide = await this.sdk._internalFetch<Slide>(
      `/slides/${encodeURIComponent(this.presId)}/slides`,
      {
        method: 'POST',
        body: JSON.stringify(options),
      },
    );
    this.cached.push(slide);
    this.cached.sort((a, b) => a.position - b.position);
    this.onUpdate(this.cached);
    return slide;
  }

  /** Append many slides from specs or raw HTML in a single request. */
  async addMany(specs: (SlideSpec | string)[], theme?: SlideThemeInput): Promise<Slide[]> {
    return this.writeBatch(specs, false, theme);
  }

  /** Replace all slides with the given specs in a single atomic request. */
  async replaceAll(specs: (SlideSpec | string)[], theme?: SlideThemeInput): Promise<Slide[]> {
    return this.writeBatch(specs, true, theme);
  }

  private async writeBatch(
    specs: (SlideSpec | string)[],
    replace: boolean,
    theme?: SlideThemeInput,
  ): Promise<Slide[]> {
    const helpers = theme ? new SlideHelpers().withTheme(theme) : new SlideHelpers();
    const payload = specs.map((s) => ({
      content: helpers.spec(s),
      hidden: typeof s === 'object' && 'hidden' in s ? Boolean(s.hidden) : undefined,
      notes: typeof s === 'object' && 'notes' in s ? (s.notes as string | undefined) : undefined,
    }));
    const result = await this.sdk._internalFetch<{ slides: Slide[]; count: number }>(
      `/slides/${encodeURIComponent(this.presId)}/slides/batch`,
      { method: 'POST', body: JSON.stringify({ slides: payload, replace }) },
    );
    this.cached = result.slides;
    this.onUpdate(this.cached);
    return result.slides;
  }

  private async slideAi(slideId: string, action: string, instruction?: string): Promise<unknown> {
    return this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}/ai`,
      { method: 'POST', body: JSON.stringify({ action, instruction }) },
    );
  }

  /** Rewrite a slide's content with AI, optionally guided by an instruction. Applies the result. */
  async rewrite(slideId: string, instruction?: string): Promise<Slide> {
    const updated = (await this.slideAi(slideId, 'rewrite', instruction)) as Slide;
    const idx = this.cached.findIndex((s) => s.id === slideId);
    if (idx >= 0) this.cached[idx] = updated;
    this.onUpdate(this.cached);
    return updated;
  }

  /** Expand a slide's content with AI. Applies the result. */
  async expand(slideId: string): Promise<Slide> {
    const updated = (await this.slideAi(slideId, 'expand')) as Slide;
    const idx = this.cached.findIndex((s) => s.id === slideId);
    if (idx >= 0) this.cached[idx] = updated;
    this.onUpdate(this.cached);
    return updated;
  }

  /** Generate speaker notes for a slide with AI. Saves and returns them. */
  async generateNotes(slideId: string): Promise<string> {
    const result = (await this.slideAi(slideId, 'generateNotes')) as { notes: string };
    return result.notes;
  }

  /** Ask AI which layout best fits a slide. Read-only suggestion. */
  async suggestLayout(slideId: string): Promise<string> {
    const result = (await this.slideAi(slideId, 'suggestLayout')) as { suggestion: string };
    return result.suggestion;
  }

  async get(slideId: string): Promise<Slide | null> {
    try {
      return await this.sdk._internalFetch<Slide>(
        `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}`,
      );
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'SLIDE_NOT_FOUND') {
        return null;
      }
      throw e;
    }
  }

  async update(slideId: string, changes: Partial<{
    content: string;
    hidden: boolean;
    overrideBackground: string | null;
    overrideFonts: Partial<SlidesFonts> | null;
    overrideTransition: Partial<SlidesTransition> | null;
  }>): Promise<Slide> {
    const updated = await this.sdk._internalFetch<Slide>(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(changes),
      },
    );
    const idx = this.cached.findIndex((s) => s.id === slideId);
    if (idx >= 0) this.cached[idx] = updated;
    this.onUpdate(this.cached);
    return updated;
  }

  async delete(slideId: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(
        `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}`,
        { method: 'DELETE' },
      );
      this.cached = this.cached.filter((s) => s.id !== slideId);
      this.onUpdate(this.cached);
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'SLIDE_NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  async duplicate(slideId: string): Promise<Slide> {
    const slide = await this.sdk._internalFetch<Slide>(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}/duplicate`,
      { method: 'POST' },
    );
    await this.refresh();
    this.onUpdate(this.cached);
    return slide;
  }

  move(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.cached.length) return;
    if (toIndex < 0 || toIndex >= this.cached.length) return;
    const slideIds = this.cached.map((s) => s.id);
    const [moved] = slideIds.splice(fromIndex, 1);
    slideIds.splice(toIndex, 0, moved);
    this.reorder(slideIds);
  }

  async reorder(slideIds: string[]): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/slides/reorder`,
      {
        method: 'POST',
        body: JSON.stringify({ slideIds }),
      },
    );
    await this.refresh();
    this.onUpdate(this.cached);
  }

  async lock(slideId: string): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}/lock`,
      { method: 'POST' },
    );
    const slide = this.cached.find((s) => s.id === slideId);
    if (slide) slide.locked = true;
  }

  async unlock(slideId: string): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}/unlock`,
      { method: 'POST' },
    );
    const slide = this.cached.find((s) => s.id === slideId);
    if (slide) slide.locked = false;
  }

  isLocked(slideId: string): boolean {
    const slide = this.cached.find((s) => s.id === slideId);
    return slide?.locked || false;
  }

  async setOwner(slideId: string, userId: string | null): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}/owner`,
      {
        method: 'PUT',
        body: JSON.stringify({ userId }),
      },
    );
    const slide = this.cached.find((s) => s.id === slideId);
    if (slide) slide.ownerId = userId;
  }

  getOwner(slideId: string): string | null {
    const slide = this.cached.find((s) => s.id === slideId);
    return slide?.ownerId || null;
  }

  getContent(slideId: string): string {
    const slide = this.cached.find((s) => s.id === slideId);
    return slide?.content || '';
  }

  async setContent(slideId: string, html: string): Promise<void> {
    await this.update(slideId, { content: html });
  }
}
