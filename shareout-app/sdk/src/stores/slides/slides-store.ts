import { ShareOutError } from '../../shareout-error';
import type { SdkClient } from '../../core/sdk-client';
import { SlideHelpers } from '../../presentation/slide-helpers';
import type { SlideSpec, SlideThemeInput } from '../../presentation/slide-helpers';
import { Presentation } from './presentation';
import type {
  CreatePresentationOptions,
  CreatePresentationResult,
  PresentationMeta,
} from './types';

/**
 * Top-level SDK namespace for slides (`sdk.slides`).
 * Handles REST CRUD and opens live {@link Presentation} sessions over REST + WebSocket.
 */
export class SlidesStore {
  constructor(private sdk: SdkClient) {}

  async create(options: CreatePresentationOptions = {}): Promise<CreatePresentationResult> {
    return this.sdk._internalFetch<CreatePresentationResult>('/slides', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async open(id: string): Promise<Presentation> {
    const presentation = new Presentation(this.sdk, id, 'edit');
    await presentation.connect();
    return presentation;
  }

  /**
   * Generate a deck from a natural-language prompt. The server produces a
   * structured outline; the SDK renders it with the chosen theme and creates
   * the presentation. Requires an AI provider configured on the worker.
   */
  async generate(
    options: { prompt: string; length?: number; theme?: SlideThemeInput } & CreatePresentationOptions,
  ): Promise<CreatePresentationResult & { presentation: Presentation }> {
    const { prompt, length, theme, ...meta } = options;
    const outline = await this.sdk._internalFetch<{ title: string | null; slides: SlideSpec[] }>(
      '/slides/generate',
      { method: 'POST', body: JSON.stringify({ prompt, length }) },
    );
    return this.createDeck({
      ...meta,
      title: meta.title || outline.title || undefined,
      theme,
      slides: outline.slides,
    });
  }

  /**
   * Create a presentation and fill it with slides in one call.
   * Provide `slides` (specs or HTML) or `fromMarkdown`. Returns the created
   * presentation metadata plus a connected `presentation` instance.
   */
  async createDeck(
    options: CreatePresentationOptions & {
      slides?: (SlideSpec | string)[];
      fromMarkdown?: string;
      theme?: SlideThemeInput;
    } = {},
  ): Promise<CreatePresentationResult & { presentation: Presentation }> {
    const { slides, fromMarkdown, theme, ...meta } = options;
    const result = await this.create(meta);
    const presentation = await this.open(result.id);
    const helpers = theme ? new SlideHelpers().withTheme(theme) : new SlideHelpers();
    const specs = fromMarkdown ? helpers.fromMarkdown(fromMarkdown) : slides || [];
    if (specs.length) {
      await presentation.slides.replaceAll(specs, theme);
    }
    return Object.assign(result, { presentation });
  }

  async view(id: string, options: { track?: boolean } = {}): Promise<Presentation> {
    const presentation = new Presentation(this.sdk, id, 'view', options.track !== false);
    await presentation.connect();
    return presentation;
  }

  async list(): Promise<PresentationMeta[]> {
    const result = await this.sdk._internalFetch<{ presentations: PresentationMeta[]; count: number }>('/slides');
    return result.presentations;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(`/slides/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'PRESENTATION_NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  get helpers(): SlideHelpers {
    return new SlideHelpers();
  }
}
