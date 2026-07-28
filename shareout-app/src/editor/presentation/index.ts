// ShareOut Visual Editor - Presentation Editor Module

export interface Slide {
  id: string;
  title: string;
  html: string;
  background?: SlideBackground;
  transition?: SlideTransition;
  notes?: string;
  hidden?: boolean;
  locked?: boolean;
}

export interface SlideBackground {
  type: 'color' | 'gradient' | 'image';
  value: string;
  opacity?: number;
}

export interface SlideTransition {
  type: 'none' | 'fade' | 'slide' | 'zoom' | 'flip';
  duration: number;
  direction?: 'left' | 'right' | 'up' | 'down';
}

export interface PresentationConfig {
  artifactId: string;
  slides: Slide[];
  currentSlide: number;
  aspectRatio: '16:9' | '4:3' | '16:10';
  theme: string;
}

export function getPresentationEditorScript(): string {
  return `
    class PresentationEditor {
      constructor(config) {
        this.config = config;
        this.slides = config.slides || [];
        this.currentSlide = config.currentSlide || 0;
        this.aspectRatio = config.aspectRatio || '16:9';
        this.handlers = {
          onSlideChange: () => {},
          onSlidesUpdate: () => {},
        };
      }

      renderNavigator(container) {
        container.innerHTML = '';

        const nav = document.createElement('div');
        nav.className = 'slide-navigator';
        nav.innerHTML = '<div class="slide-nav-header"><span>Slides</span><button class="btn-add-slide" title="Add slide">+</button></div><div class="slide-list"></div>';

        const list = nav.querySelector('.slide-list');
        this.slides.forEach((slide, idx) => {
          const item = this.createSlideThumb(slide, idx);
          list.appendChild(item);
        });

        nav.querySelector('.btn-add-slide').addEventListener('click', () => this.addSlide());
        container.appendChild(nav);

        this.initSortable(list);
      }

      createSlideThumb(slide, index) {
        const thumb = document.createElement('div');
        thumb.className = 'slide-thumb' + (index === this.currentSlide ? ' active' : '') + (slide.hidden ? ' hidden' : '');
        thumb.dataset.index = index;

        thumb.innerHTML = \`
          <div class="slide-thumb-number">\${index + 1}</div>
          <div class="slide-thumb-preview">
            <div class="slide-thumb-content">\${slide.title || 'Untitled'}</div>
          </div>
          <div class="slide-thumb-actions">
            <button class="slide-action" data-action="duplicate" title="Duplicate">⧉</button>
            <button class="slide-action" data-action="delete" title="Delete">×</button>
          </div>
        \`;

        thumb.addEventListener('click', (e) => {
          if (!e.target.closest('.slide-action')) {
            this.selectSlide(index);
          }
        });

        thumb.querySelectorAll('.slide-action').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'duplicate') this.duplicateSlide(index);
            if (action === 'delete') this.deleteSlide(index);
          });
        });

        return thumb;
      }

      initSortable(list) {
        let draggedItem = null;
        let draggedIndex = -1;

        list.addEventListener('dragstart', (e) => {
          draggedItem = e.target.closest('.slide-thumb');
          if (!draggedItem) return;
          draggedIndex = parseInt(draggedItem.dataset.index);
          draggedItem.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        list.addEventListener('dragend', () => {
          if (draggedItem) draggedItem.classList.remove('dragging');
          draggedItem = null;
        });

        list.addEventListener('dragover', (e) => {
          e.preventDefault();
          const afterElement = this.getDragAfterElement(list, e.clientY);
          if (afterElement == null) {
            list.appendChild(draggedItem);
          } else {
            list.insertBefore(draggedItem, afterElement);
          }
        });

        list.addEventListener('drop', (e) => {
          e.preventDefault();
          const newIndex = Array.from(list.children).indexOf(draggedItem);
          if (newIndex !== draggedIndex && newIndex >= 0) {
            this.reorderSlide(draggedIndex, newIndex);
          }
        });

        list.querySelectorAll('.slide-thumb').forEach(thumb => {
          thumb.draggable = true;
        });
      }

      getDragAfterElement(list, y) {
        const elements = [...list.querySelectorAll('.slide-thumb:not(.dragging)')];
        return elements.reduce((closest, child) => {
          const box = child.getBoundingClientRect();
          const offset = y - box.top - box.height / 2;
          if (offset < 0 && offset > closest.offset) {
            return { offset, element: child };
          }
          return closest;
        }, { offset: Number.NEGATIVE_INFINITY }).element;
      }

      selectSlide(index) {
        this.currentSlide = index;
        document.querySelectorAll('.slide-thumb').forEach((thumb, i) => {
          thumb.classList.toggle('active', i === index);
        });
        this.handlers.onSlideChange(this.slides[index], index);
      }

      addSlide(template = 'blank') {
        const templates = {
          blank: { title: 'New Slide', html: '<div class="slide"><h1>New Slide</h1></div>' },
          title: { title: 'Title Slide', html: '<div class="slide slide-title"><h1>Title</h1><p>Subtitle</p></div>' },
          content: { title: 'Content', html: '<div class="slide slide-content"><h2>Heading</h2><ul><li>Point 1</li><li>Point 2</li></ul></div>' },
          image: { title: 'Image Slide', html: '<div class="slide slide-image"><img src="" alt=""><p>Caption</p></div>' },
          split: { title: 'Split View', html: '<div class="slide slide-split"><div class="left"><h2>Left</h2></div><div class="right"><h2>Right</h2></div></div>' },
        };

        const tmpl = templates[template] || templates.blank;
        const slide = {
          id: 'slide-' + Date.now(),
          title: tmpl.title,
          html: tmpl.html,
          transition: { type: 'fade', duration: 300 },
        };

        this.slides.splice(this.currentSlide + 1, 0, slide);
        this.handlers.onSlidesUpdate(this.slides);
        this.selectSlide(this.currentSlide + 1);
      }

      duplicateSlide(index) {
        const original = this.slides[index];
        const copy = {
          ...original,
          id: 'slide-' + Date.now(),
          title: original.title + ' (copy)',
        };
        this.slides.splice(index + 1, 0, copy);
        this.handlers.onSlidesUpdate(this.slides);
        this.renderNavigator(document.querySelector('.slide-navigator')?.parentElement);
      }

      deleteSlide(index) {
        if (this.slides.length <= 1) return;
        this.slides.splice(index, 1);
        if (this.currentSlide >= this.slides.length) {
          this.currentSlide = this.slides.length - 1;
        }
        this.handlers.onSlidesUpdate(this.slides);
        this.renderNavigator(document.querySelector('.slide-navigator')?.parentElement);
        this.selectSlide(this.currentSlide);
      }

      reorderSlide(fromIndex, toIndex) {
        const [slide] = this.slides.splice(fromIndex, 1);
        this.slides.splice(toIndex, 0, slide);
        if (this.currentSlide === fromIndex) {
          this.currentSlide = toIndex;
        }
        this.handlers.onSlidesUpdate(this.slides);
      }

      updateSlide(index, updates) {
        this.slides[index] = { ...this.slides[index], ...updates };
        this.handlers.onSlidesUpdate(this.slides);
      }

      renderProperties(container, slide) {
        if (!slide) {
          container.innerHTML = '<div class="no-selection">Select a slide</div>';
          return;
        }

        container.innerHTML = \`
          <div class="prop-section">
            <div class="prop-section-title">Slide</div>
            <div class="prop-row">
              <label>Title</label>
              <input type="text" id="slide-title" value="\${slide.title || ''}">
            </div>
            <div class="prop-row">
              <label>Hidden</label>
              <input type="checkbox" id="slide-hidden" \${slide.hidden ? 'checked' : ''}>
            </div>
          </div>

          <div class="prop-section">
            <div class="prop-section-title">Background</div>
            <div class="prop-row">
              <label>Type</label>
              <select id="slide-bg-type">
                <option value="color" \${slide.background?.type === 'color' ? 'selected' : ''}>Color</option>
                <option value="gradient" \${slide.background?.type === 'gradient' ? 'selected' : ''}>Gradient</option>
                <option value="image" \${slide.background?.type === 'image' ? 'selected' : ''}>Image</option>
              </select>
            </div>
            <div class="prop-row">
              <label>Value</label>
              <input type="text" id="slide-bg-value" value="\${slide.background?.value || '#ffffff'}">
            </div>
          </div>

          <div class="prop-section">
            <div class="prop-section-title">Transition</div>
            <div class="prop-row">
              <label>Type</label>
              <select id="slide-transition">
                <option value="none" \${slide.transition?.type === 'none' ? 'selected' : ''}>None</option>
                <option value="fade" \${slide.transition?.type === 'fade' ? 'selected' : ''}>Fade</option>
                <option value="slide" \${slide.transition?.type === 'slide' ? 'selected' : ''}>Slide</option>
                <option value="zoom" \${slide.transition?.type === 'zoom' ? 'selected' : ''}>Zoom</option>
                <option value="flip" \${slide.transition?.type === 'flip' ? 'selected' : ''}>Flip</option>
              </select>
            </div>
            <div class="prop-row">
              <label>Duration</label>
              <input type="number" id="slide-transition-duration" value="\${slide.transition?.duration || 300}" min="0" max="2000" step="100">
            </div>
          </div>

          <div class="prop-section">
            <div class="prop-section-title">Speaker Notes</div>
            <textarea id="slide-notes" rows="4">\${slide.notes || ''}</textarea>
          </div>
        \`;

        container.querySelector('#slide-title').addEventListener('change', (e) => {
          this.updateSlide(this.currentSlide, { title: e.target.value });
        });

        container.querySelector('#slide-hidden').addEventListener('change', (e) => {
          this.updateSlide(this.currentSlide, { hidden: e.target.checked });
        });

        container.querySelector('#slide-bg-type').addEventListener('change', (e) => {
          const bg = { ...slide.background, type: e.target.value };
          this.updateSlide(this.currentSlide, { background: bg });
        });

        container.querySelector('#slide-bg-value').addEventListener('change', (e) => {
          const bg = { ...slide.background, value: e.target.value };
          this.updateSlide(this.currentSlide, { background: bg });
        });

        container.querySelector('#slide-transition').addEventListener('change', (e) => {
          const trans = { ...slide.transition, type: e.target.value };
          this.updateSlide(this.currentSlide, { transition: trans });
        });

        container.querySelector('#slide-transition-duration').addEventListener('change', (e) => {
          const trans = { ...slide.transition, duration: parseInt(e.target.value) };
          this.updateSlide(this.currentSlide, { transition: trans });
        });

        container.querySelector('#slide-notes').addEventListener('change', (e) => {
          this.updateSlide(this.currentSlide, { notes: e.target.value });
        });
      }

      renderTemplates(container) {
        const templates = [
          { id: 'blank', name: 'Blank', icon: '□' },
          { id: 'title', name: 'Title', icon: 'T' },
          { id: 'content', name: 'Content', icon: '≡' },
          { id: 'image', name: 'Image', icon: '⛶' },
          { id: 'split', name: 'Split', icon: '⧉' },
        ];

        container.innerHTML = templates.map(t => \`
          <div class="slide-template" data-template="\${t.id}" draggable="true">
            <div class="template-icon">\${t.icon}</div>
            <div class="template-name">\${t.name}</div>
          </div>
        \`).join('');

        container.querySelectorAll('.slide-template').forEach(el => {
          el.addEventListener('click', () => this.addSlide(el.dataset.template));
          el.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('slide-template', el.dataset.template);
          });
        });
      }

      startPresenter() {
        const presenterWindow = window.open('', 'presenter', 'width=1200,height=800');
        if (!presenterWindow) return;

        presenterWindow.document.write(\`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Presenter View - \${document.title}</title>
            <style>
              body { margin: 0; font-family: system-ui; background: #1f2937; color: white; display: grid; grid-template-columns: 2fr 1fr; height: 100vh; }
              .current-slide { padding: 20px; display: flex; flex-direction: column; }
              .slide-preview { flex: 1; background: white; border-radius: 8px; overflow: hidden; }
              .slide-preview iframe { width: 100%; height: 100%; border: none; }
              .sidebar { padding: 20px; display: flex; flex-direction: column; gap: 16px; border-left: 1px solid #374151; }
              .next-preview { height: 200px; background: #374151; border-radius: 8px; }
              .notes { flex: 1; background: #374151; border-radius: 8px; padding: 16px; overflow-y: auto; }
              .controls { display: flex; gap: 12px; justify-content: center; }
              .controls button { padding: 12px 24px; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; }
              .controls .btn-prev { background: #6b7280; color: white; }
              .controls .btn-next { background: #3b82f6; color: white; }
              .timer { text-align: center; font-size: 32px; font-family: monospace; }
            </style>
          </head>
          <body>
            <div class="current-slide">
              <div class="slide-preview"><iframe id="current-iframe"></iframe></div>
            </div>
            <div class="sidebar">
              <div class="timer" id="timer">00:00:00</div>
              <div class="next-preview" id="next-preview">Next slide</div>
              <div class="notes" id="notes">Speaker notes</div>
              <div class="controls">
                <button class="btn-prev" id="btn-prev">← Previous</button>
                <button class="btn-next" id="btn-next">Next →</button>
              </div>
            </div>
            <script>
              let currentIndex = \${this.currentSlide};
              const slides = \${JSON.stringify(this.slides)};
              let startTime = Date.now();

              function updateTimer() {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
                const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
                const s = String(elapsed % 60).padStart(2, '0');
                document.getElementById('timer').textContent = h + ':' + m + ':' + s;
              }
              setInterval(updateTimer, 1000);

              function showSlide(idx) {
                currentIndex = idx;
                const slide = slides[idx];
                const iframe = document.getElementById('current-iframe');
                iframe.srcdoc = slide.html;
                document.getElementById('notes').textContent = slide.notes || 'No speaker notes';
                const nextSlide = slides[idx + 1];
                document.getElementById('next-preview').textContent = nextSlide ? 'Next: ' + nextSlide.title : 'End of presentation';
                window.opener?.postMessage({ type: 'slide-change', index: idx }, '*');
              }

              document.getElementById('btn-prev').onclick = () => showSlide(Math.max(0, currentIndex - 1));
              document.getElementById('btn-next').onclick = () => showSlide(Math.min(slides.length - 1, currentIndex + 1));

              window.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight' || e.key === ' ') showSlide(Math.min(slides.length - 1, currentIndex + 1));
                if (e.key === 'ArrowLeft') showSlide(Math.max(0, currentIndex - 1));
              });

              showSlide(currentIndex);
            <\/script>
          </body>
          </html>
        \`);
      }

      on(event, handler) {
        const key = 'on' + event.charAt(0).toUpperCase() + event.slice(1);
        if (this.handlers[key] !== undefined) {
          this.handlers[key] = handler;
        }
      }
    }

    window.PresentationEditor = PresentationEditor;
  `;
}

export function getPresentationStyles(): string {
  return `
    .slide-navigator {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .slide-nav-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
      font-weight: 500;
    }

    .btn-add-slide {
      width: 24px;
      height: 24px;
      border: none;
      background: var(--accent);
      color: white;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
    }

    .slide-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .slide-thumb {
      display: flex;
      gap: 8px;
      padding: 8px;
      background: var(--bg-secondary);
      border: 2px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .slide-thumb:hover {
      background: var(--bg-tertiary);
    }

    .slide-thumb.active {
      border-color: var(--accent);
    }

    .slide-thumb.hidden {
      opacity: 0.5;
    }

    .slide-thumb.dragging {
      opacity: 0.5;
    }

    .slide-thumb-number {
      font-size: 11px;
      color: var(--text-muted);
      width: 16px;
      flex-shrink: 0;
    }

    .slide-thumb-preview {
      flex: 1;
      min-height: 48px;
      background: white;
      border-radius: 3px;
      padding: 4px;
      font-size: 10px;
      overflow: hidden;
    }

    .slide-thumb-actions {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .slide-action {
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 3px;
      font-size: 12px;
    }

    .slide-action:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .slide-template {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 12px 8px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .slide-template:hover {
      background: var(--bg-tertiary);
      border-color: var(--accent);
    }

    .template-icon {
      font-size: 24px;
      color: var(--text-secondary);
    }

    .template-name {
      font-size: 11px;
      color: var(--text-muted);
    }
  `;
}
