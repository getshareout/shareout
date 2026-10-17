// Templates: save an artifact or folder as a scrubbed, versioned template; install it
// into any workspace it reaches; update installed copies non-destructively.
// Provisioning calls installTemplateSet() to seed a new workspace.
export * from './types';
export { TemplateError, isTemplateError } from './errors';
export { snapshotSource, previewOf, buildSetup, type Snapshot, type SnapshotOptions, type Excluded } from './snapshot';
export {
  addVersion, canManage, canSee, createTemplate, deleteTemplate, getTemplate, isAdmin, listTemplates, loadItemFiles,
  loadVersion, parseTags, readPreviewImage, scopeAllows, sharedWith, tagsOf, updateMeta, validateShares,
} from './store';
export {
  applyUpdate, installInfo, installTemplate, installTemplateSet, planUpdate, setupStatus,
  type InstallResult, type InstallTarget, type TemplateSetResult, type UpdatePlan,
} from './install';
export { resolveTokens, tokenizeLinks, dropLinks } from './links';
export { redactSecrets, scanText } from './scan';
