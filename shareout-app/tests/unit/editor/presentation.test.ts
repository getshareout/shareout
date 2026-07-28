/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPresentationEditorScript,
  getPresentationStyles,
} from '../../../src/editor/presentation/index';
import { loadEditorClass } from './helpers/load-editor-script';

interface Slide {
  id: string;
  title: string;
  html: string;
  hidden?: boolean;
  background?: { type: string; value: string };
  transition?: { type: string; duration: number };
  notes?: string;
}

interface PresentationEditorInstance {
  slides: Slide[];
  currentSlide: number;
  handlers: {
    onSlideChange: (slide: Slide, index: number) => void;
    onSlidesUpdate: (slides: Slide[]) => void;
  };
  renderNavigator: (container: HTMLElement) => void;
  renderProperties: (container: HTMLElement, slide: Slide | null) => void;
  renderTemplates: (container: HTMLElement) => void;
  selectSlide: (index: number) => void;
  addSlide: (template?: string) => void;
  duplicateSlide: (index: number) => void;
  deleteSlide: (index: number) => void;
  reorderSlide: (from: number, to: number) => void;
  updateSlide: (index: number, updates: Partial<Slide>) => void;
  getDragAfterElement: (list: HTMLElement, y: number) => Element | undefined;
  startPresenter: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

const slides: Slide[] = [
  { id: 's1', title: 'Intro', html: '<div>One</div>', notes: 'Welcome' },
  { id: 's2', title: 'Details', html: '<div>Two</div>', hidden: true },
];

describe('getPresentationStyles', () => {
  it('includes slide navigator and template styles', () => {
    const css = getPresentationStyles();
    expect(css).toContain('.slide-navigator');
    expect(css).toContain('.slide-thumb.active');
    expect(css).toContain('.slide-template');
    expect(css).toContain('.btn-add-slide');
  });
});

describe('PresentationEditor', () => {
  let PresentationEditor: new (config: Record<string, unknown>) => PresentationEditorInstance;
  let editor: PresentationEditorInstance;

  beforeEach(() => {
    document.body.innerHTML = '<div id="nav-root"></div>';
    PresentationEditor = loadEditorClass(getPresentationEditorScript(), 'PresentationEditor');
    editor = new PresentationEditor({
      artifactId: 'art_1',
      slides: structuredClone(slides),
      currentSlide: 0,
      aspectRatio: '16:9',
      theme: 'default',
    });
  });

  it('renders slide navigator with thumbs', () => {
    const container = document.createElement('div');
    editor.renderNavigator(container);

    expect(container.querySelector('.slide-navigator')).toBeTruthy();
    expect(container.querySelectorAll('.slide-thumb')).toHaveLength(2);
    expect(container.querySelector('.slide-thumb.active')).toBeTruthy();
    expect(container.querySelector('.slide-thumb.hidden')).toBeTruthy();
  });

  it('selects slide and notifies handler', () => {
    const onChange = vi.fn();
    editor.on('slideChange', onChange);

    const container = document.createElement('div');
    editor.renderNavigator(container);
    editor.selectSlide(1);

    expect(editor.currentSlide).toBe(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' }), 1);
  });

  it('adds slide from add button and templates', () => {
    const onUpdate = vi.fn();
    editor.on('slidesUpdate', onUpdate);

    const nav = document.createElement('div');
    editor.renderNavigator(nav);
    nav.querySelector('.btn-add-slide')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.slides.length).toBe(3);
    expect(onUpdate).toHaveBeenCalled();

    const templates = document.createElement('div');
    editor.renderTemplates(templates);
    expect(templates.querySelectorAll('.slide-template')).toHaveLength(5);
    templates.querySelector('[data-template="title"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.slides.length).toBe(4);
  });

  it('duplicates and deletes slides', () => {
    const navParent = document.createElement('div');
    document.body.appendChild(navParent);
    editor.renderNavigator(navParent);

    editor.duplicateSlide(0);
    expect(editor.slides.some((s) => s.title.includes('(copy)'))).toBe(true);

    editor.deleteSlide(2);
    expect(editor.slides.length).toBe(2);

    editor.slides = [{ id: 'only', title: 'Only', html: '<div>x</div>' }];
    editor.deleteSlide(0);
    expect(editor.slides).toHaveLength(1);
  });

  it('reorders slides and tracks current index', () => {
    editor.reorderSlide(0, 1);
    expect(editor.slides[0].id).toBe('s2');
    expect(editor.currentSlide).toBe(1);
  });

  it('updates slide via properties panel', () => {
    const onUpdate = vi.fn();
    editor.on('slidesUpdate', onUpdate);

    const props = document.createElement('div');
    editor.renderProperties(props, editor.slides[0]);

    expect(props.querySelector('#slide-title')).toBeTruthy();
    expect(props.querySelector('#slide-notes')?.textContent).toBe('Welcome');

    const titleInput = props.querySelector('#slide-title') as HTMLInputElement;
    titleInput.value = 'Updated Title';
    titleInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(editor.slides[0].title).toBe('Updated Title');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('shows no-selection when slide is null', () => {
    const props = document.createElement('div');
    editor.renderProperties(props, null);
    expect(props.textContent).toContain('Select a slide');
  });

  it('getDragAfterElement returns element based on pointer position', () => {
    const list = document.createElement('div');
    const a = document.createElement('div');
    a.className = 'slide-thumb';
    a.getBoundingClientRect = () => ({ top: 0, height: 40, left: 0, right: 0, bottom: 40, width: 100, x: 0, y: 0, toJSON: () => ({}) });
    const b = document.createElement('div');
    b.className = 'slide-thumb';
    b.getBoundingClientRect = () => ({ top: 50, height: 40, left: 0, right: 0, bottom: 90, width: 100, x: 0, y: 50, toJSON: () => ({}) });
    list.append(a, b);

    expect(editor.getDragAfterElement(list, 10)).toBe(a);
    expect(editor.getDragAfterElement(list, 200)).toBeUndefined();
  });

  it('duplicate and delete actions work from thumb buttons', () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    editor.renderNavigator(wrapper);

    wrapper.querySelector('[data-action="duplicate"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.slides.length).toBe(3);

    wrapper.querySelector('[data-action="delete"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(editor.slides.length).toBe(2);
  });

  it('startPresenter opens presenter window when allowed', () => {
    const write = vi.fn();
    const mockWindow = { document: { write } };
    vi.spyOn(window, 'open').mockReturnValue(mockWindow as unknown as Window);

    editor.startPresenter();
    expect(write).toHaveBeenCalled();
    expect(write.mock.calls[0][0]).toContain('Presenter View');
  });

  it('startPresenter no-ops when popup blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(() => editor.startPresenter()).not.toThrow();
  });
});
