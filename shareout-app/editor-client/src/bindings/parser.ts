/**
 * ShareOut Data Binding Parser v2.0
 *
 * Parses binding annotation strings from data-shareout-binding attributes
 * into structured objects for the editor to work with.
 *
 * Supports enhanced attributes:
 * - data-shareout-format: currency, percent, number:2, date:short
 * - data-shareout-editable: true/false
 * - data-shareout-validation: number:min=0:max=100, string:maxLength=50
 */

import {
  BINDING_ATTR,
  BINDING_DISPLAY_ATTR,
  BINDING_TYPE_PATTERNS,
  FORMAT_ATTR,
  EDITABLE_ATTR,
  VALIDATION_ATTR,
} from '../sdk-patterns';

export type BindingType = 'json' | 'table' | 'computed' | 'multi';

export type FormatType = 'currency' | 'percent' | 'number' | 'date' | 'text';

export interface ParsedFormat {
  type: FormatType;
  decimals?: number;
  dateFormat?: 'short' | 'long' | 'iso' | string;
  locale?: string;
  currency?: string;
}

export interface ParsedValidation {
  type: 'number' | 'string' | 'boolean' | 'enum';
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enumValues?: string[];
  required?: boolean;
}

export interface ParsedBinding {
  type: BindingType;
  raw: string;
  // For json bindings
  key?: string;
  // For table bindings
  table?: string;
  operation?: 'row' | 'sum' | 'count' | 'avg' | 'min' | 'max';
  rowId?: string;
  field?: string;
  filter?: Record<string, string>;
  // For computed bindings
  name?: string;
  sources?: string[];
  // For multi bindings
  bindings?: ParsedBinding[];
  combineOperation?: 'sum' | 'diff' | 'product' | 'ratio';
}

export interface BindingInfo {
  binding: string;
  parsed: ParsedBinding;
  display: string | null;
  element: Element;
  format?: ParsedFormat | null;
  editable?: boolean;
  validation?: ParsedValidation | null;
}

/**
 * Parse format attribute: "currency", "percent", "number:2", "date:short"
 */
export function parseFormat(formatStr: string | null): ParsedFormat | null {
  if (!formatStr) return null;

  const parts = formatStr.split(':');
  const type = parts[0] as FormatType;

  switch (type) {
    case 'currency':
      return { type: 'currency', currency: parts[1] || 'USD' };
    case 'percent':
      return { type: 'percent', decimals: parts[1] ? parseInt(parts[1], 10) : 1 };
    case 'number':
      return { type: 'number', decimals: parts[1] ? parseInt(parts[1], 10) : 0 };
    case 'date':
      return { type: 'date', dateFormat: parts[1] || 'short' };
    default:
      return { type: 'text' };
  }
}

/**
 * Parse validation attribute: "number:min=0:max=100", "string:maxLength=50", "enum:a,b,c"
 */
export function parseValidation(validationStr: string | null): ParsedValidation | null {
  if (!validationStr) return null;

  const parts = validationStr.split(':');
  const type = parts[0] as ParsedValidation['type'];
  const result: ParsedValidation = { type };

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('min=')) {
      result.min = parseFloat(part.slice(4));
    } else if (part.startsWith('max=')) {
      result.max = parseFloat(part.slice(4));
    } else if (part.startsWith('minLength=')) {
      result.minLength = parseInt(part.slice(10), 10);
    } else if (part.startsWith('maxLength=')) {
      result.maxLength = parseInt(part.slice(10), 10);
    } else if (part.startsWith('pattern=')) {
      result.pattern = part.slice(8);
    } else if (part === 'required') {
      result.required = true;
    } else if (type === 'enum') {
      result.enumValues = part.split(',');
    }
  }

  return result;
}

/**
 * Parse a filter string back to object
 */
function parseFilter(filterStr: string): Record<string, string> | undefined {
  if (!filterStr || filterStr === '*') return undefined;
  const result: Record<string, string> = {};
  filterStr.split(',').forEach(part => {
    const [key, value] = part.split('=');
    if (key && value !== undefined) {
      result[key] = decodeURIComponent(value);
    }
  });
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Parse a binding string into its components
 */
export function parseBinding(binding: string): ParsedBinding {
  if (!binding) {
    return { type: 'computed', raw: '', name: 'unknown' };
  }

  const parts = binding.split(':');
  const type = parts[0] as BindingType;

  switch (type) {
    case 'json':
      return {
        type: 'json',
        raw: binding,
        key: parts.slice(1).join(':'),
      };

    case 'table': {
      const tableName = parts[1];
      const operation = parts[2] as ParsedBinding['operation'];

      if (operation === 'row') {
        return {
          type: 'table',
          raw: binding,
          table: tableName,
          operation: 'row',
          rowId: parts[3],
          field: parts[4],
        };
      }

      return {
        type: 'table',
        raw: binding,
        table: tableName,
        operation,
        field: parts[3],
        filter: parseFilter(parts[4]),
      };
    }

    case 'computed':
      return {
        type: 'computed',
        raw: binding,
        name: parts[1],
        sources: parts[2]?.split('+') || [],
      };

    case 'multi':
      return {
        type: 'multi',
        raw: binding,
        combineOperation: parts[1] as ParsedBinding['combineOperation'],
        bindings: parts[2]?.split('|').map(parseBinding) || [],
      };

    default:
      return {
        type: 'computed',
        raw: binding,
        name: binding,
      };
  }
}

/**
 * Get binding info from an element
 */
export function getElementBinding(element: Element): BindingInfo | null {
  const binding = element.getAttribute(BINDING_ATTR);
  if (!binding) return null;

  const formatAttr = element.getAttribute(FORMAT_ATTR);
  const editableAttr = element.getAttribute(EDITABLE_ATTR);
  const validationAttr = element.getAttribute(VALIDATION_ATTR);

  return {
    binding,
    parsed: parseBinding(binding),
    display: element.getAttribute(BINDING_DISPLAY_ATTR),
    element,
    format: parseFormat(formatAttr),
    editable: editableAttr === 'true',
    validation: parseValidation(validationAttr),
  };
}

/**
 * Find all bound elements in a document
 */
export function findBoundElements(doc: Document): BindingInfo[] {
  const elements = doc.querySelectorAll(`[${BINDING_ATTR}]`);
  const bindings: BindingInfo[] = [];

  elements.forEach(el => {
    const info = getElementBinding(el);
    if (info) bindings.push(info);
  });

  return bindings;
}

/**
 * Get a human-readable description of a binding
 */
export function describeBinding(binding: string | ParsedBinding): string {
  const parsed = typeof binding === 'string' ? parseBinding(binding) : binding;

  switch (parsed.type) {
    case 'json':
      return `JSON: ${parsed.key}`;

    case 'table':
      if (parsed.operation === 'row') {
        return `${parsed.table}.${parsed.field} (row ${parsed.rowId})`;
      }
      const filterDesc = parsed.filter
        ? ` where ${Object.entries(parsed.filter).map(([k, v]) => `${k}=${v}`).join(', ')}`
        : '';
      return `${parsed.operation?.toUpperCase()}(${parsed.table}.${parsed.field})${filterDesc}`;

    case 'computed':
      if (parsed.sources && parsed.sources.length > 0) {
        return `Computed: ${parsed.name} (from ${parsed.sources.length} sources)`;
      }
      return `Computed: ${parsed.name}`;

    case 'multi':
      return `Combined (${parsed.combineOperation}) from ${parsed.bindings?.length || 0} bindings`;

    default:
      return parsed.raw || 'Unknown binding';
  }
}

/**
 * Get the data sources referenced by a binding
 */
export function getBindingSources(binding: ParsedBinding): { type: 'table' | 'json'; name: string }[] {
  const sources: { type: 'table' | 'json'; name: string }[] = [];

  switch (binding.type) {
    case 'json':
      if (binding.key) {
        sources.push({ type: 'json', name: binding.key.split('.')[0] });
      }
      break;

    case 'table':
      if (binding.table) {
        sources.push({ type: 'table', name: binding.table });
      }
      break;

    case 'computed':
      // Parse sources recursively
      binding.sources?.forEach(source => {
        sources.push(...getBindingSources(parseBinding(source)));
      });
      break;

    case 'multi':
      // Parse all sub-bindings
      binding.bindings?.forEach(sub => {
        sources.push(...getBindingSources(sub));
      });
      break;
  }

  // Deduplicate
  const seen = new Set<string>();
  return sources.filter(s => {
    const key = `${s.type}:${s.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Check if an element has any data binding
 */
export function hasBoundData(element: Element): boolean {
  return element.hasAttribute(BINDING_ATTR);
}

/**
 * Create a selector path for a bound element
 */
export function getBoundElementSelector(element: Element): string {
  // Try id first
  if (element.id) {
    return `#${element.id}`;
  }

  // Try data-shareout-binding value as identifier
  const binding = element.getAttribute(BINDING_ATTR);
  if (binding) {
    return `[${BINDING_ATTR}="${binding.replace(/"/g, '\\"')}"]`;
  }

  // Fall back to tag and class
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList).filter(c => !c.startsWith('__'));
  if (classes.length > 0) {
    return `${tag}.${classes[0]}`;
  }

  return tag;
}

/**
 * Format a value according to a ParsedFormat
 */
export function formatValue(value: unknown, format: ParsedFormat | null): string {
  if (value === null || value === undefined) return '';
  if (!format) return String(value);

  const numValue = typeof value === 'number' ? value : parseFloat(String(value));

  switch (format.type) {
    case 'currency':
      return new Intl.NumberFormat(format.locale || 'en-US', {
        style: 'currency',
        currency: format.currency || 'USD',
      }).format(numValue);

    case 'percent':
      return new Intl.NumberFormat(format.locale || 'en-US', {
        style: 'percent',
        minimumFractionDigits: format.decimals ?? 1,
        maximumFractionDigits: format.decimals ?? 1,
      }).format(numValue / 100);

    case 'number':
      return new Intl.NumberFormat(format.locale || 'en-US', {
        minimumFractionDigits: format.decimals ?? 0,
        maximumFractionDigits: format.decimals ?? 0,
      }).format(numValue);

    case 'date':
      const dateValue = value instanceof Date ? value : new Date(String(value));
      if (isNaN(dateValue.getTime())) return String(value);
      switch (format.dateFormat) {
        case 'short':
          return dateValue.toLocaleDateString(format.locale);
        case 'long':
          return dateValue.toLocaleDateString(format.locale, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
          });
        case 'iso':
          return dateValue.toISOString().split('T')[0];
        default:
          return dateValue.toLocaleDateString(format.locale);
      }

    default:
      return String(value);
  }
}

/**
 * Validate a value against a ParsedValidation
 */
export function validateValue(value: unknown, validation: ParsedValidation | null): string | null {
  if (!validation) return null;

  if (validation.required && (value === null || value === undefined || value === '')) {
    return 'This field is required';
  }

  if (value === null || value === undefined || value === '') {
    return null; // Empty non-required field is valid
  }

  switch (validation.type) {
    case 'number': {
      const num = typeof value === 'number' ? value : parseFloat(String(value));
      if (isNaN(num)) return 'Must be a number';
      if (validation.min !== undefined && num < validation.min) {
        return `Must be at least ${validation.min}`;
      }
      if (validation.max !== undefined && num > validation.max) {
        return `Must be at most ${validation.max}`;
      }
      break;
    }

    case 'string': {
      const str = String(value);
      if (validation.minLength !== undefined && str.length < validation.minLength) {
        return `Must be at least ${validation.minLength} characters`;
      }
      if (validation.maxLength !== undefined && str.length > validation.maxLength) {
        return `Must be at most ${validation.maxLength} characters`;
      }
      if (validation.pattern) {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(str)) {
          return 'Invalid format';
        }
      }
      break;
    }

    case 'enum': {
      if (validation.enumValues && !validation.enumValues.includes(String(value))) {
        return `Must be one of: ${validation.enumValues.join(', ')}`;
      }
      break;
    }
  }

  return null;
}

export { BINDING_ATTR, BINDING_DISPLAY_ATTR, FORMAT_ATTR, EDITABLE_ATTR, VALIDATION_ATTR };
