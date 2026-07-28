import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareOut } from '../src/index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const presentationMeta = {
  id: 'pres_1',
  name: 'Quarterly',
  slideCount: 2,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  theme: 'default',
};

const slides = [
  {
    id: 'slide_1',
    presentationId: 'pres_1',
    position: 0,
    ownerId: null,
    overrideBackground: null,
    overrideFonts: null,
    overrideTransition: null,
    content: '<section>Intro</section>',
    hidden: false,
    locked: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'slide_2',
    presentationId: 'pres_1',
    position: 1,
    ownerId: null,
    overrideBackground: null,
    overrideFonts: null,
    overrideTransition: null,
    content: '<section>Metrics</section>',
    hidden: false,
    locked: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  },
];

function createFetchMock() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/slides/pres_1/slides/slide_1/notes') && init?.method === 'PUT') {
      return jsonResponse({ success: true, data: {} });
    }
    if (url.includes('/slides/pres_1/slides/slide_1/notes')) {
      return jsonResponse({ success: true, data: { notes: 'Welcome notes' } });
    }
    if (url.includes('/slides/pres_1/presenter/start') && init?.method === 'POST') {
      return jsonResponse({ success: true, data: { started: true, startedAt: '2024-01-01T00:00:00Z', userId: 'usr_1' } });
    }
    if (url.includes('/slides/pres_1/presenter/state')) {
      return jsonResponse({
        success: true,
        data: {
          isPresenting: true,
          presenterId: 'usr_1',
          presenterName: 'Ada',
          currentSlideIndex: 0,
          totalSlides: 2,
          startedAt: '2024-01-01T00:00:00Z',
          slideStartedAt: '2024-01-01T00:00:00Z',
          countdown: null,
          laser: { enabled: false, position: null },
        },
      });
    }
    if (url.includes('/slides/pres_1/slides/slide_1/duplicate') && init?.method === 'POST') {
      return jsonResponse({
        success: true,
        data: { ...slides[0], id: 'slide_1_copy', position: 2 },
      });
    }
    if (url.includes('/slides/pres_1/slides/slide_2') && init?.method === 'DELETE') {
      return jsonResponse({ success: true, data: {} });
    }
    if (url.includes('/slides/pres_1/slides/slide_1') && init?.method === 'PATCH') {
      return jsonResponse({
        success: true,
        data: { ...slides[0], content: '<section>Updated intro</section>' },
      });
    }
    if (url.includes('/slides/pres_1/slides') && init?.method === 'POST') {
      return jsonResponse({
        success: true,
        data: {
          id: 'slide_3',
          presentationId: 'pres_1',
          position: 2,
          ownerId: null,
          overrideBackground: null,
          overrideFonts: null,
          overrideTransition: null,
          content: '<section>New slide</section>',
          hidden: false,
          locked: false,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      });
    }
    if (url.includes('/slides/pres_1/slides') && !url.includes('/versions')) {
      return jsonResponse({ success: true, data: { slides, count: 2 } });
    }
    if (url.includes('/slides/pres_1/versions') && init?.method === 'POST') {
      return jsonResponse({
        success: true,
        data: {
          id: 'v2',
          presentationId: 'pres_1',
          name: 'Checkpoint',
          description: 'Saved',
          slideCount: 2,
          createdById: null,
          createdByName: null,
          isAutoSave: false,
          createdAt: '2024-01-02T00:00:00Z',
        },
      });
    }
    if (url.includes('/slides/pres_1/versions')) {
      return jsonResponse({
        success: true,
        data: {
          versions: [{
            id: 'v1',
            presentationId: 'pres_1',
            name: 'Initial',
            description: null,
            slideCount: 2,
            createdById: null,
            createdByName: null,
            isAutoSave: false,
            createdAt: '2024-01-01T00:00:00Z',
          }],
          count: 1,
        },
      });
    }
    if (url.includes('/slides/pres_1/publish/status')) {
      return jsonResponse({ success: true, data: { publishedUrl: 'https://shareout.example.com/p/pres_1' } });
    }
    if (url.includes('/slides/pres_1')) {
      return jsonResponse({ success: true, data: { ...presentationMeta, slides } });
    }
    return jsonResponse({ success: true, data: {} });
  });
}

function createSdk() {
  return new ShareOut({
    artifactId: 'art_1',
    baseUrl: 'https://api.example.com',
    batchDelay: 0,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Presentation view mode', () => {
  it('loads presentation data and exposes managers without websocket setup', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const sdk = createSdk();

    const presentation = await sdk.slides.view('pres_1');

    expect(presentation.meta.get()?.name).toBe('Quarterly');
    expect(presentation.slides.list()).toHaveLength(2);
    await expect(presentation.slides.refresh()).resolves.toHaveLength(2);
    await expect(presentation.versions.list()).resolves.toHaveLength(1);
    await expect(presentation.versions.create('Checkpoint', 'Saved')).resolves.toMatchObject({ id: 'v2' });
    await expect(presentation.publish.getUrl()).resolves.toBe('https://shareout.example.com/p/pres_1');
    await expect(presentation.speakerNotes.get('slide_1')).resolves.toBe('Welcome notes');
    await presentation.speakerNotes.set('slide_1', 'Updated notes');
    await presentation.presenter.start({ fromSlide: 0 });

    presentation.on('presentation:updated', () => undefined);
    presentation.off('presentation:updated', () => undefined);
    presentation.destroy();
  });
});

describe('Presentation edit helpers', () => {
  it('supports slide add/update and undo stack', async () => {
    vi.stubGlobal('fetch', createFetchMock());
    const sdk = createSdk();
    const presentation = await sdk.slides.view('pres_1');

    presentation.transact(() => {
      presentation.slides.move(0, 1);
    });

    await expect(presentation.slides.add({ content: '<section>New slide</section>' })).resolves.toMatchObject({ id: 'slide_3' });
    await expect(presentation.slides.update('slide_1', { content: '<section>Updated intro</section>' })).resolves.toMatchObject({
      content: '<section>Updated intro</section>',
    });
    await expect(presentation.slides.duplicate('slide_1')).resolves.toMatchObject({ id: 'slide_1_copy' });
    await expect(presentation.slides.delete('slide_2')).resolves.toBe(true);
    expect(presentation.undo.canUndo()).toBe(true);
  });
});
