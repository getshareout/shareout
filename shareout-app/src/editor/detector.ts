// ShareOut Visual Editor - Component Detection Framework

import type { SDKComponentType, ChartLibrary, DetectedComponent, DetectedChart } from './types';

export interface DetectionResult {
  sdkComponents: DetectedComponent[];
  charts: DetectedChart[];
  widgets: DetectedWidget[];
}

export interface DetectedWidget {
  type: 'kpi' | 'table' | 'filter' | 'embed';
  selector: string;
  config?: Record<string, unknown>;
}

// SDK detection patterns
const SDK_PATTERNS: Record<SDKComponentType, RegExp[]> = {
  json: [
    /sdk\.json\.set\s*\(/gi,
    /sdk\.json\.get\s*\(/gi,
    /shareout\.json/gi,
  ],
  table: [
    /sdk\.table\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi,
    /shareout\.table\s*\(/gi,
    /new\s+ShareOutTable\s*\(/gi,
  ],
  blobs: [
    /sdk\.blobs\.upload/gi,
    /sdk\.blobs\.get/gi,
    /sdk\.blobs\.list/gi,
    /shareout\.blobs/gi,
  ],
  comments: [
    /sdk\.comments/gi,
    /shareout\.comments/gi,
    /data-shareout-comments/gi,
  ],
  realtime: [
    /sdk\.realtime\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gi,
    /shareout\.realtime/gi,
    /new\s+ShareOutRealtime\s*\(/gi,
  ],
  sheets: [
    /sdk\.sheets\.connect/gi,
    /sdk\.sheets\.sync/gi,
    /shareout\.sheets/gi,
  ],
  github: [
    /sdk\.github\.export/gi,
    /sdk\.github\.sync/gi,
    /shareout\.github/gi,
  ],
  collaborators: [
    /sdk\.collaborators/gi,
    /shareout\.collaborators/gi,
  ],
  agent: [
    /sdk\.agent\.configure/gi,
    /sdk\.agent\.chat/gi,
    /shareout\.agent/gi,
    /data-shareout-agent/gi,
  ],
  slides: [
    /sdk\.slides/gi,
    /shareout\.slides/gi,
    /data-shareout-slide/gi,
    /class\s*=\s*['"][^'"]*shareout-slide/gi,
  ],
  binding: [
    /data-shareout-binding\s*=\s*['"]([^'"]+)['"]/gi,
    /Bindings\.(wrap|attr|editable)\s*\(/gi,
  ],
};

// Chart library detection patterns
const CHART_PATTERNS: Record<ChartLibrary, { patterns: RegExp[] }> = {
  chartjs: {
    patterns: [
      /new\s+Chart\s*\(/gi,
      /Chart\.register\s*\(/gi,
    ],
  },
  echarts: {
    patterns: [
      /echarts\.init\s*\(/gi,
      /\.setOption\s*\(/gi,
    ],
  },
  recharts: {
    patterns: [
      /<LineChart/gi,
      /<BarChart/gi,
      /<PieChart/gi,
      /<AreaChart/gi,
      /<ScatterChart/gi,
      /<RadarChart/gi,
      /from\s+['"]recharts['"]/gi,
    ],
  },
  plotly: {
    patterns: [
      /Plotly\.newPlot\s*\(/gi,
      /Plotly\.react\s*\(/gi,
    ],
  },
  d3: {
    patterns: [
      /d3\.select\s*\(/gi,
      /d3\.selectAll\s*\(/gi,
    ],
  },
  apexcharts: {
    patterns: [
      /new\s+ApexCharts\s*\(/gi,
      /ApexCharts\.exec\s*\(/gi,
    ],
  },
};

// Widget detection patterns
const WIDGET_PATTERNS = {
  kpi: [
    /class\s*=\s*['"][^'"]*kpi-card/gi,
    /class\s*=\s*['"][^'"]*metric-card/gi,
    /data-widget\s*=\s*['"]kpi['"]/gi,
  ],
  table: [
    /<table[^>]*data-sortable/gi,
    /<table[^>]*data-filterable/gi,
    /class\s*=\s*['"][^'"]*data-table/gi,
  ],
  filter: [
    /data-filter-target/gi,
    /class\s*=\s*['"][^'"]*filter-widget/gi,
  ],
  embed: [
    /<iframe[^>]*src\s*=/gi,
    /data-embed-type/gi,
  ],
};

export function detectComponents(html: string): DetectionResult {
  const sdkComponents = detectSDKComponents(html);
  const charts = detectCharts(html);
  const widgets = detectWidgets(html);

  return { sdkComponents, charts, widgets };
}

function detectSDKComponents(html: string): DetectedComponent[] {
  const components: DetectedComponent[] = [];
  const seen = new Set<string>();

  for (const [type, patterns] of Object.entries(SDK_PATTERNS)) {
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(html)) !== null) {
        const componentType = type as SDKComponentType;
        const key = `${componentType}:${match.index}`;

        if (!seen.has(key)) {
          seen.add(key);

          const component: DetectedComponent = {
            type: componentType,
            selector: findNearestSelector(html, match.index),
            config: extractSDKConfig(html, match.index, componentType),
          };

          // Extract name for table/realtime
          if ((componentType === 'table' || componentType === 'realtime') && match[1]) {
            component.name = match[1];
          }

          components.push(component);
        }
      }
    }
  }

  return deduplicateComponents(components);
}

function detectCharts(html: string): DetectedChart[] {
  const charts: DetectedChart[] = [];
  const seen = new Set<string>();

  for (const [library, config] of Object.entries(CHART_PATTERNS)) {
    const chartLib = library as ChartLibrary;

    // Check usage patterns
    for (const pattern of config.patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(html)) !== null) {
        const key = `${chartLib}:${match.index}`;

        if (!seen.has(key)) {
          seen.add(key);

          const chart: DetectedChart = {
            library: chartLib,
            selector: findNearestSelector(html, match.index),
            chartType: inferChartType(html, match.index, chartLib),
          };

          charts.push(chart);
        }
      }
    }
  }

  return deduplicateCharts(charts);
}

function detectWidgets(html: string): DetectedWidget[] {
  const widgets: DetectedWidget[] = [];
  const seen = new Set<string>();

  for (const [type, patterns] of Object.entries(WIDGET_PATTERNS)) {
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(html)) !== null) {
        const widgetType = type as 'kpi' | 'table' | 'filter' | 'embed';
        const key = `${widgetType}:${match.index}`;

        if (!seen.has(key)) {
          seen.add(key);

          widgets.push({
            type: widgetType,
            selector: findNearestSelector(html, match.index),
          });
        }
      }
    }
  }

  return widgets;
}

function findNearestSelector(html: string, position: number): string {
  // Look backwards for the nearest element with an id or class
  const before = html.substring(Math.max(0, position - 500), position);

  // Find last id attribute
  const idMatch = before.match(/id\s*=\s*['"]([^'"]+)['"]/gi);
  if (idMatch) {
    const lastId = idMatch[idMatch.length - 1];
    const id = lastId.match(/id\s*=\s*['"]([^'"]+)['"]/i);
    if (id) return `#${id[1]}`;
  }

  // Find last class attribute
  const classMatch = before.match(/class\s*=\s*['"]([^'"]+)['"]/gi);
  if (classMatch) {
    const lastClass = classMatch[classMatch.length - 1];
    const cls = lastClass.match(/class\s*=\s*['"]([^'"]+)['"]/i);
    if (cls) {
      const classes = cls[1].split(/\s+/).filter(c => c && !c.startsWith('__'));
      if (classes.length > 0) return `.${classes[0]}`;
    }
  }

  // Find nearest tag
  const tagMatch = before.match(/<(\w+)[^>]*$/);
  if (tagMatch) return tagMatch[1];

  return 'body';
}

function extractSDKConfig(
  html: string,
  position: number,
  type: SDKComponentType
): Record<string, unknown> | undefined {
  // Extract configuration from SDK calls
  const after = html.substring(position, position + 1000);

  // Look for object literal after the match
  const configMatch = after.match(/\(\s*\{([^}]+)\}/);
  if (configMatch) {
    try {
      // Simple key-value extraction (not full JSON parsing)
      const configStr = configMatch[1];
      const config: Record<string, unknown> = {};

      const pairs = configStr.match(/(\w+)\s*:\s*(['"][^'"]*['"]|\d+|true|false)/g);
      if (pairs) {
        for (const pair of pairs) {
          const [key, value] = pair.split(/\s*:\s*/);
          if (key && value) {
            config[key] = value.replace(/['"]/g, '');
          }
        }
      }

      return Object.keys(config).length > 0 ? config : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function inferChartType(
  html: string,
  position: number,
  library: ChartLibrary
): string | undefined {
  const context = html.substring(Math.max(0, position - 100), position + 200);

  const typePatterns: Record<string, RegExp> = {
    line: /line|timeseries/i,
    bar: /bar|column/i,
    pie: /pie|doughnut|donut/i,
    area: /area|stacked/i,
    scatter: /scatter|point/i,
    radar: /radar|spider/i,
    gauge: /gauge|meter/i,
    funnel: /funnel/i,
    heatmap: /heatmap|heat/i,
    treemap: /treemap|tree/i,
  };

  for (const [type, pattern] of Object.entries(typePatterns)) {
    if (pattern.test(context)) {
      return type;
    }
  }

  return undefined;
}

function deduplicateComponents(components: DetectedComponent[]): DetectedComponent[] {
  const seen = new Map<string, DetectedComponent>();

  for (const comp of components) {
    const key = `${comp.type}:${comp.name || ''}:${comp.selector}`;
    if (!seen.has(key)) {
      seen.set(key, comp);
    }
  }

  return Array.from(seen.values());
}

function deduplicateCharts(charts: DetectedChart[]): DetectedChart[] {
  const seen = new Map<string, DetectedChart>();

  for (const chart of charts) {
    const key = `${chart.library}:${chart.selector}`;
    if (!seen.has(key)) {
      seen.set(key, chart);
    }
  }

  return Array.from(seen.values());
}

// Generate editor panel configuration for detected components
export function getComponentEditorConfig(component: DetectedComponent): {
  title: string;
  icon: string;
  fields: { name: string; type: string; label: string }[];
} {
  const configs: Record<SDKComponentType, ReturnType<typeof getComponentEditorConfig>> = {
    json: {
      title: 'JSON Store',
      icon: '📦',
      fields: [
        { name: 'key', type: 'text', label: 'Key' },
        { name: 'value', type: 'json', label: 'Value' },
      ],
    },
    table: {
      title: `Table: ${component.name || 'Untitled'}`,
      icon: '📊',
      fields: [
        { name: 'columns', type: 'columns', label: 'Columns' },
        { name: 'data', type: 'tabledata', label: 'Data' },
        { name: 'realtime', type: 'checkbox', label: 'Enable real-time sync' },
      ],
    },
    blobs: {
      title: 'File Manager',
      icon: '📁',
      fields: [
        { name: 'files', type: 'filelist', label: 'Files' },
        { name: 'upload', type: 'upload', label: 'Upload' },
      ],
    },
    comments: {
      title: 'Comments',
      icon: '💬',
      fields: [
        { name: 'enabled', type: 'checkbox', label: 'Enable comments' },
        { name: 'anonymous', type: 'checkbox', label: 'Allow anonymous' },
        { name: 'maxDepth', type: 'number', label: 'Max reply depth' },
      ],
    },
    realtime: {
      title: `Realtime: ${component.name || 'Document'}`,
      icon: '⚡',
      fields: [
        { name: 'docId', type: 'text', label: 'Document ID' },
        { name: 'presence', type: 'checkbox', label: 'Show presence' },
      ],
    },
    sheets: {
      title: 'Google Sheets',
      icon: '📑',
      fields: [
        { name: 'spreadsheetId', type: 'text', label: 'Spreadsheet ID' },
        { name: 'range', type: 'text', label: 'Range' },
        { name: 'syncMode', type: 'select', label: 'Sync Mode' },
      ],
    },
    github: {
      title: 'GitHub Export',
      icon: '🐙',
      fields: [
        { name: 'repo', type: 'text', label: 'Repository' },
        { name: 'branch', type: 'text', label: 'Branch' },
        { name: 'autoSync', type: 'checkbox', label: 'Auto-sync' },
      ],
    },
    collaborators: {
      title: 'Collaborators',
      icon: '👥',
      fields: [
        { name: 'users', type: 'userlist', label: 'Users' },
        { name: 'invite', type: 'email', label: 'Invite' },
      ],
    },
    agent: {
      title: 'AI Agent',
      icon: '🤖',
      fields: [
        { name: 'systemPrompt', type: 'textarea', label: 'System Prompt' },
        { name: 'model', type: 'select', label: 'Model' },
        { name: 'enabled', type: 'checkbox', label: 'Enable chat' },
      ],
    },
    slides: {
      title: 'Presentation',
      icon: '🎬',
      fields: [
        { name: 'slides', type: 'slidelist', label: 'Slides' },
        { name: 'transition', type: 'select', label: 'Transition' },
        { name: 'autoplay', type: 'checkbox', label: 'Auto-play' },
      ],
    },
    binding: {
      title: `Data Binding: ${component.name || 'Value'}`,
      icon: '🔗',
      fields: [
        { name: 'source', type: 'text', label: 'Data Source' },
        { name: 'binding', type: 'text', label: 'Binding Expression' },
        { name: 'display', type: 'text', label: 'Display Name' },
        { name: 'editable', type: 'checkbox', label: 'Editable' },
      ],
    },
  };

  return configs[component.type];
}
