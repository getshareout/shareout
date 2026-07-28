/**
 * ShareOut SDK Pattern Constants v2.0
 *
 * Defines data attribute names used for the ShareOut HTML specification.
 * Regex-based SDK detection has been removed in favor of manifest-based discovery.
 */

// Binding attributes
export const BINDING_ATTR = 'data-shareout-binding';
export const BINDING_DISPLAY_ATTR = 'data-shareout-display';
export const FORMAT_ATTR = 'data-shareout-format';
export const EDITABLE_ATTR = 'data-shareout-editable';
export const VALIDATION_ATTR = 'data-shareout-validation';

// Page structure attributes
export const PAGE_ATTR = 'data-shareout-page';
export const PAGE_TITLE_ATTR = 'data-shareout-page-title';
export const SECTION_ATTR = 'data-shareout-section';
export const SECTION_TITLE_ATTR = 'data-shareout-section-title';

// Editor: mark a container whose direct children can be drag-reordered.
// Value "x" reorders along a row (flex/grid horizontal); anything else is vertical.
export const SORTABLE_ATTR = 'data-shareout-sortable';
export const TABS_ATTR = 'data-shareout-tabs';
export const TAB_ATTR = 'data-shareout-tab';
export const TAB_TITLE_ATTR = 'data-shareout-tab-title';

// Template attributes
export const TEMPLATE_ATTR = 'data-shareout-template';
export const TEMPLATE_SOURCE_ATTR = 'data-shareout-template-source';
export const TEMPLATE_ITEM_ATTR = 'data-shareout-template-item';

// Chart attributes
export const CHART_ATTR = 'data-shareout-chart';
export const CHART_DATA_ATTR = 'data-shareout-chart-data';
export const CHART_X_ATTR = 'data-shareout-chart-x';
export const CHART_Y_ATTR = 'data-shareout-chart-y';
export const CHART_FILTER_ATTR = 'data-shareout-chart-filter';

// Realtime attributes
export const REALTIME_ATTR = 'data-shareout-realtime';
export const REALTIME_KEY_ATTR = 'data-shareout-realtime-key';
export const REALTIME_ITEM_ATTR = 'data-shareout-realtime-item';

// SDK feature attributes
export const COMMENTS_ATTR = 'data-shareout-comments';
export const AGENT_ATTR = 'data-shareout-agent';
export const SLIDE_ATTR = 'data-shareout-slide';

// =============================================================================
// ACTIONS & EVENTS (Spec v2.1.0 Section 7)
// =============================================================================
export const ACTION_ATTR = 'data-shareout-action';
export const ACTION_TARGET_ATTR = 'data-shareout-action-target';
export const ACTION_TRIGGER_ATTR = 'data-shareout-action-trigger';
export const ACTION_PARAMS_ATTR = 'data-shareout-action-params';
export const ACTION_CONFIRM_ATTR = 'data-shareout-action-confirm';
export const ACTION_DISPLAY_ATTR = 'data-shareout-action-display';
export const ACTIONS_ATTR = 'data-shareout-actions'; // Multiple actions JSON array
export const MODAL_ATTR = 'data-shareout-modal';
export const MODAL_TITLE_ATTR = 'data-shareout-modal-title';

// Action types: navigate, submit, insert, update, delete, toggle, set, call, open, close
export const ACTION_TYPES = [
  'navigate',
  'submit',
  'insert',
  'update',
  'delete',
  'toggle',
  'set',
  'call',
  'open',
  'close',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

// Trigger events: click, submit, change, blur, hover, load
export const ACTION_TRIGGERS = ['click', 'submit', 'change', 'blur', 'hover', 'load'] as const;
export type ActionTrigger = (typeof ACTION_TRIGGERS)[number];

// =============================================================================
// CONDITIONAL RENDERING (Spec v2.1.0 Section 8)
// =============================================================================
export const IF_ATTR = 'data-shareout-if';
export const IF_DISPLAY_ATTR = 'data-shareout-if-display';
export const HIDE_ATTR = 'data-shareout-hide';
export const HIDE_DISPLAY_ATTR = 'data-shareout-hide-display';
export const SHOW_ATTR = 'data-shareout-show';
export const SHOW_DISPLAY_ATTR = 'data-shareout-show-display';
export const SWITCH_ATTR = 'data-shareout-switch';
export const SWITCH_DISPLAY_ATTR = 'data-shareout-switch-display';
export const CASE_ATTR = 'data-shareout-case';
export const CASE_DISPLAY_ATTR = 'data-shareout-case-display';
export const CASE_DEFAULT_ATTR = 'data-shareout-case-default';

// Condition operators
export const CONDITION_OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'contains', 'empty', '!empty'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

// =============================================================================
// FORMS & INPUTS (Spec v2.1.0 Section 9)
// =============================================================================
export const FORM_ATTR = 'data-shareout-form';
export const FORM_TITLE_ATTR = 'data-shareout-form-title';
export const FORM_SUBMIT_ATTR = 'data-shareout-form-submit';
export const FORM_TARGET_ATTR = 'data-shareout-form-target';
export const FORM_RESET_ATTR = 'data-shareout-form-reset';
export const FIELD_ATTR = 'data-shareout-field';
export const FIELD_LABEL_ATTR = 'data-shareout-field-label';
export const FIELD_REQUIRED_ATTR = 'data-shareout-field-required';
export const FIELDGROUP_ATTR = 'data-shareout-fieldgroup';
export const FIELDGROUP_TITLE_ATTR = 'data-shareout-fieldgroup-title';
export const ERROR_ATTR = 'data-shareout-error';
export const OPTIONS_SOURCE_ATTR = 'data-shareout-options-source';
export const OPTIONS_VALUE_ATTR = 'data-shareout-options-value';
export const OPTIONS_LABEL_ATTR = 'data-shareout-options-label';
export const OPTIONS_DISPLAY_ATTR = 'data-shareout-options-display';
export const OPTIONS_ATTR = 'data-shareout-options'; // Static options from JSON

// =============================================================================
// NAVIGATION & ROUTING (Spec v2.1.0 Section 10)
// =============================================================================
export const NAV_ATTR = 'data-shareout-nav';
export const NAV_TITLE_ATTR = 'data-shareout-nav-title';
export const NAV_TYPE_ATTR = 'data-shareout-nav-type';
export const NAV_COLLAPSIBLE_ATTR = 'data-shareout-nav-collapsible';
export const LINK_ATTR = 'data-shareout-link';
export const LINK_DISPLAY_ATTR = 'data-shareout-link-display';
export const LINK_ACTIVE_CLASS_ATTR = 'data-shareout-link-active-class';
export const NAV_GROUP_ATTR = 'data-shareout-nav-group';
export const NAV_GROUP_TITLE_ATTR = 'data-shareout-nav-group-title';
export const NAV_GROUP_COLLAPSED_ATTR = 'data-shareout-nav-group-collapsed';
export const BREADCRUMB_ATTR = 'data-shareout-breadcrumb';
export const BREADCRUMB_DISPLAY_ATTR = 'data-shareout-breadcrumb-display';
export const BREADCRUMB_CURRENT_ATTR = 'data-shareout-breadcrumb-current';
export const TRANSITION_ATTR = 'data-shareout-transition';
export const TRANSITION_DURATION_ATTR = 'data-shareout-transition-duration';
export const DEEPLINK_ATTR = 'data-shareout-deeplink';
export const DEEPLINK_DISPLAY_ATTR = 'data-shareout-deeplink-display';

// Link target types: page:X, section:X, tab:X, external:X, modal:X, history:back/forward
export const LINK_TARGET_TYPES = ['page', 'section', 'tab', 'external', 'modal', 'history'] as const;
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number];

// Page transition types
export const TRANSITION_TYPES = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom'] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

// Binding type patterns for parsing
export const BINDING_TYPE_PATTERNS = {
  json: /^json:/,
  table: /^table:/,
  computed: /^computed:/,
  multi: /^multi:/,
} as const;

// Legacy SDK detection patterns (deprecated: use manifest-based discovery instead)
// Kept for backward compatibility with existing code
export const SDK_DETECTION_PATTERNS: Record<string, RegExp> = {
  json: /sdk\.json\.get\(['"`]([^'"`]+)['"`]\)/,
  table: /sdk\.table\(['"`]([^'"`]+)['"`]\)/,
  blob: /sdk\.blob\(['"`]([^'"`]+)['"`]\)/,
  comments: /sdk\.comments\(\)/,
  agent: /sdk\.agent\(\)/,
  realtime: /sdk\.realtime\(['"`]([^'"`]+)['"`]\)/,
};

export type BindingType = keyof typeof BINDING_TYPE_PATTERNS;

// All ShareOut data attributes for easy detection
export const ALL_SHAREOUT_ATTRS = [
  // Bindings
  BINDING_ATTR,
  BINDING_DISPLAY_ATTR,
  FORMAT_ATTR,
  EDITABLE_ATTR,
  VALIDATION_ATTR,
  // Page structure
  PAGE_ATTR,
  PAGE_TITLE_ATTR,
  SECTION_ATTR,
  SECTION_TITLE_ATTR,
  TABS_ATTR,
  TAB_ATTR,
  TAB_TITLE_ATTR,
  // Templates
  TEMPLATE_ATTR,
  TEMPLATE_SOURCE_ATTR,
  TEMPLATE_ITEM_ATTR,
  // Charts
  CHART_ATTR,
  CHART_DATA_ATTR,
  CHART_X_ATTR,
  CHART_Y_ATTR,
  CHART_FILTER_ATTR,
  // Realtime
  REALTIME_ATTR,
  REALTIME_KEY_ATTR,
  REALTIME_ITEM_ATTR,
  // SDK features
  COMMENTS_ATTR,
  AGENT_ATTR,
  SLIDE_ATTR,
  // Actions
  ACTION_ATTR,
  ACTION_TARGET_ATTR,
  ACTION_TRIGGER_ATTR,
  ACTION_PARAMS_ATTR,
  ACTION_CONFIRM_ATTR,
  ACTION_DISPLAY_ATTR,
  ACTIONS_ATTR,
  MODAL_ATTR,
  MODAL_TITLE_ATTR,
  // Conditionals
  IF_ATTR,
  IF_DISPLAY_ATTR,
  HIDE_ATTR,
  HIDE_DISPLAY_ATTR,
  SHOW_ATTR,
  SHOW_DISPLAY_ATTR,
  SWITCH_ATTR,
  SWITCH_DISPLAY_ATTR,
  CASE_ATTR,
  CASE_DISPLAY_ATTR,
  CASE_DEFAULT_ATTR,
  // Forms
  FORM_ATTR,
  FORM_TITLE_ATTR,
  FORM_SUBMIT_ATTR,
  FORM_TARGET_ATTR,
  FORM_RESET_ATTR,
  FIELD_ATTR,
  FIELD_LABEL_ATTR,
  FIELD_REQUIRED_ATTR,
  FIELDGROUP_ATTR,
  FIELDGROUP_TITLE_ATTR,
  ERROR_ATTR,
  OPTIONS_SOURCE_ATTR,
  OPTIONS_VALUE_ATTR,
  OPTIONS_LABEL_ATTR,
  OPTIONS_DISPLAY_ATTR,
  OPTIONS_ATTR,
  // Navigation
  NAV_ATTR,
  NAV_TITLE_ATTR,
  NAV_TYPE_ATTR,
  NAV_COLLAPSIBLE_ATTR,
  LINK_ATTR,
  LINK_DISPLAY_ATTR,
  LINK_ACTIVE_CLASS_ATTR,
  NAV_GROUP_ATTR,
  NAV_GROUP_TITLE_ATTR,
  NAV_GROUP_COLLAPSED_ATTR,
  BREADCRUMB_ATTR,
  BREADCRUMB_DISPLAY_ATTR,
  BREADCRUMB_CURRENT_ATTR,
  TRANSITION_ATTR,
  TRANSITION_DURATION_ATTR,
  DEEPLINK_ATTR,
  DEEPLINK_DISPLAY_ATTR,
] as const;
