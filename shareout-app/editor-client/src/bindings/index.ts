/**
 * ShareOut Data Bindings Module
 *
 * Provides utilities for working with data-shareout-binding annotations
 * in the visual editor.
 */

export {
  parseBinding,
  getElementBinding,
  findBoundElements,
  describeBinding,
  getBindingSources,
  hasBoundData,
  getBoundElementSelector,
  BINDING_ATTR,
  BINDING_DISPLAY_ATTR,
} from './parser';

export type {
  BindingType,
  ParsedBinding,
  BindingInfo,
} from './parser';

export {
  isDataBoundElement,
  getBindingDescription,
  showVariablePopover,
  hideVariablePopover,
} from './variable-popover';
