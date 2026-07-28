/** Slide deck helper used by the slides palette. */

export interface Slide {
  id: string;
  title: string;
  html: string;
  hidden?: boolean;
}

type SlideTemplateId = 'blank' | 'title' | 'content' | 'image' | 'split';

const SLIDE_TEMPLATES: Record<SlideTemplateId, Omit<Slide, 'id'>> = {
  blank: { title: 'New Slide', html: '<div class="slide"><h1>New Slide</h1></div>' },
  title: { title: 'Title Slide', html: '<div class="slide"><h1>Title</h1><p>Subtitle</p></div>' },
  content: {
    title: 'Content',
    html: '<div class="slide"><h2>Heading</h2><ul><li>Point</li></ul></div>',
  },
  image: { title: 'Image', html: '<div class="slide"><img src="" alt=""><p>Caption</p></div>' },
  split: { title: 'Split', html: '<div class="slide"><div class="left"></div><div class="right"></div></div>' },
};

export class PresentationEditor {
  slides: Slide[];
  currentSlide: number;
  handlers: { onSlideChange: (slide: Slide, index: number) => void; onSlidesUpdate: (slides: Slide[]) => void };

  constructor(config: { slides?: Slide[]; currentSlide?: number }) {
    this.slides = config.slides ?? [];
    this.currentSlide = config.currentSlide ?? 0;
    this.handlers = { onSlideChange: () => {}, onSlidesUpdate: () => {} };
  }

  addSlide(template: string = 'blank'): void {
    const tpl = SLIDE_TEMPLATES[template as SlideTemplateId] ?? SLIDE_TEMPLATES.blank;
    const slide: Slide = { id: `slide-${Date.now()}`, ...tpl };
    this.slides.splice(this.currentSlide + 1, 0, slide);
    this.handlers.onSlidesUpdate(this.slides);
  }

  selectSlide(index: number): void {
    this.currentSlide = index;
    document.querySelectorAll('.slide-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === index);
    });
    this.handlers.onSlideChange(this.slides[index], index);
  }

  updateSlide(index: number, updates: Partial<Slide>): void {
    this.slides[index] = { ...this.slides[index], ...updates };
    this.handlers.onSlidesUpdate(this.slides);
  }

  deleteSlide(index: number): void {
    if (this.slides.length <= 1) return;
    this.slides.splice(index, 1);
    if (this.currentSlide >= this.slides.length) {
      this.currentSlide = this.slides.length - 1;
    }
    this.handlers.onSlidesUpdate(this.slides);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const key = ('on' + event.charAt(0).toUpperCase() + event.slice(1)) as keyof typeof this.handlers;
    if (key in this.handlers) {
      (this.handlers as Record<string, (...args: unknown[]) => void>)[key] = handler;
    }
  }
}
