import type { EditorContext } from '../editor/context';
import { SDK_DETECTION_PATTERNS } from '../sdk-patterns';
import { escapeHtml, rgbToHex } from '../utils';
import { showToast } from '../toast';
import { getElementSelector as buildElementSelector } from '../dom/element-selector';
import { renderCanvas } from '../canvas/render-canvas';
import { renderSelectionHandles } from '../canvas/selection';
import { updateHtmlFromCanvas } from '../history/html-sync';
import { pushUndo } from '../history/undo-redo';
import { PLACEHOLDER_IMAGE_SRC } from './placeholder-image';

export function initPalette(ctx: EditorContext) {
  const basicItems = [
    { icon: 'T', name: 'Text', template: '<p style="color:#1c1917;">Text</p>' },
    { icon: '[]', name: 'Div', template: '<div style="padding:20px;background:#f5f5f4;border:1px solid #e7e5e4;border-radius:12px;">Block</div>' },
    { icon: '[B]', name: 'Button', template: '<button class="so-btn so-btn-primary">Button</button>' },
    { icon: '[I]', name: 'Image', template: `<img src="${PLACEHOLDER_IMAGE_SRC}" style="max-width:100%;border-radius:12px;">` },
    { icon: '=', name: 'Table', template: '<table style="width:100%;border-collapse:collapse;"><tr><th style="border:1px solid #e7e5e4;padding:8px;color:#1c1917;">Header</th></tr><tr><td style="border:1px solid #e7e5e4;padding:8px;color:#1c1917;">Cell</td></tr></table>' },
    { icon: '[=]', name: 'List', template: '<ul style="color:#1c1917;"><li>Item 1</li><li>Item 2</li></ul>' },
  ];

  const palette = document.getElementById('palette-basic');
  if (!palette) return;

  basicItems.forEach(item => {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.draggable = true;
    el.innerHTML = `<span class="palette-item-icon">${item.icon}</span><span>${item.name}</span>`;
    el.dataset.template = item.template;

    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/html', item.template);
    });

    palette.appendChild(el);
  });

  initChartsPalette(ctx);
  initSlidesPalette(ctx);
  initDashboardPalette(ctx);
}

export function initChartsPalette(ctx: EditorContext) {
  const chartItems = [
    {
      icon: '[L]',
      name: 'Line',
      config: { id: 'chart_' + Date.now(), type: 'line', title: 'Line Chart', series: [{ name: 'Series 1', data: [10, 20, 30, 40, 50] }], categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May'], showLegend: true, showGrid: true, responsive: true }
    },
    {
      icon: '[C]',
      name: 'Bar',
      config: { id: 'chart_' + Date.now(), type: 'bar', title: 'Bar Chart', series: [{ name: 'Category A', data: [30, 45, 25, 60, 35] }], categories: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'], showLegend: true, responsive: true }
    },
    {
      icon: '[P]',
      name: 'Pie',
      config: { id: 'chart_' + Date.now(), type: 'pie', title: 'Pie Chart', series: [{ name: 'Distribution', data: [{ x: 'A', y: 30 }, { x: 'B', y: 25 }, { x: 'C', y: 20 }, { x: 'D', y: 15 }, { x: 'E', y: 10 }] }], showLegend: true, legendPosition: 'right', responsive: true }
    },
    {
      icon: '[A]',
      name: 'Area',
      config: { id: 'chart_' + Date.now(), type: 'area', title: 'Area Chart', series: [{ name: 'Traffic', data: [100, 200, 150, 300, 250, 400] }], categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], showLegend: true, showGrid: true, responsive: true }
    },
    {
      icon: '[o]',
      name: 'Scatter',
      config: { id: 'chart_' + Date.now(), type: 'scatter', title: 'Scatter Plot', series: [{ name: 'Dataset', data: [{ x: 1, y: 10 }, { x: 2, y: 15 }, { x: 3, y: 8 }, { x: 4, y: 22 }, { x: 5, y: 18 }] }], showLegend: false, showGrid: true, responsive: true }
    },
    {
      icon: '[O]',
      name: 'Donut',
      config: { id: 'chart_' + Date.now(), type: 'donut', title: 'Progress', series: [{ name: 'Status', data: [{ x: 'Complete', y: 65 }, { x: 'In Progress', y: 25 }, { x: 'Pending', y: 10 }] }], showLegend: true, legendPosition: 'bottom', responsive: true }
    },
  ];

  const palette = document.getElementById('palette-charts');
  if (!palette) return;

  chartItems.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.draggable = true;
    el.innerHTML = `<span class="palette-item-icon">${item.icon}</span><span>${item.name}</span>`;

    // Generate unique ID for each drag
    el.addEventListener('dragstart', (e) => {
      const config = { ...item.config, id: 'chart_' + Date.now() + '_' + idx };
      const template = `<div class="shareout-chart" data-shareout-chart='${JSON.stringify(config)}' style="width:100%;height:300px;"></div>`;
      e.dataTransfer?.setData('text/html', template);
    });

    palette.appendChild(el);
  });
}

export function initSlidesPalette(ctx: EditorContext) {
  const slideTemplates = [
    { icon: '[]', name: 'Blank', template: 'blank' },
    { icon: 'T', name: 'Title', template: 'title' },
    { icon: '[=]', name: 'Content', template: 'content' },
    { icon: '[I]', name: 'Image', template: 'image' },
    { icon: '[+]', name: 'Split', template: 'split' },
  ];

  const palette = document.getElementById('palette-slides');
  if (!palette) return;

  slideTemplates.forEach(item => {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.draggable = true;
    el.innerHTML = `<span class="palette-item-icon">${item.icon}</span><span>${item.name}</span>`;
    el.dataset.slideTemplate = item.template;

    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('slide-template', item.template);
    });

    el.addEventListener('click', () => {
      if (window.presentationEditor) {
        window.presentationEditor.addSlide(item.template);
      }
    });

    palette.appendChild(el);
  });
}

export function initDashboardPalette(ctx: EditorContext) {
  const widgetTypes = [
    { icon: '#', name: 'KPI', type: 'kpi' },
    { icon: '[C]', name: 'Chart', type: 'chart' },
    { icon: '[T]', name: 'Table', type: 'table' },
    { icon: 'T', name: 'Text', type: 'text' },
    { icon: '[v]', name: 'Filter', type: 'filter' },
  ];

  const palette = document.getElementById('palette-dashboard');
  if (!palette) return;

  widgetTypes.forEach(item => {
    const el = document.createElement('div');
    el.className = 'palette-item';
    el.draggable = true;
    el.innerHTML = `<span class="palette-item-icon">${item.icon}</span><span>${item.name}</span>`;
    el.dataset.widgetType = item.type;

    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('widget-type', item.type);
    });

    el.addEventListener('click', () => {
      if (window.dashboardEditor) {
        window.dashboardEditor.addWidget(item.type);
      }
    });

    palette.appendChild(el);
  });
}
