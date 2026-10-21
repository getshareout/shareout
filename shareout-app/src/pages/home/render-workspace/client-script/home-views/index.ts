/**
 * Home pane views — composed from focused client-script fragments.
 * Fragments share one IIFE scope with the rest of WORKSPACE_CLIENT (order matters).
 */
import { workspace_client_home_views_artifactsBrowser_JS } from './artifacts-browser';
import { workspace_client_home_views_cardActions_JS } from './card-actions';
import { workspace_client_home_views_cardMenu_JS } from './card-menu';
import { workspace_client_home_views_schedules_JS } from './schedules';
import { workspace_client_home_views_autoForms_JS } from './auto-forms';
import { workspace_client_home_views_analytics_JS } from './analytics';
import { workspace_client_home_views_datasets_JS } from './datasets';
import { workspace_client_home_views_connectors_JS } from './connectors';
import { workspace_client_home_views_connect_JS } from './connect';
import { workspace_client_home_views_modalsForms_JS } from './modals-forms';
import { workspace_client_home_views_adminCore_JS } from './admin';
import { workspace_client_home_views_invite_JS } from './invite';
import { workspace_client_home_views_assets_JS } from './assets';
import { workspace_client_home_views_deliveries_JS } from './deliveries';
import { workspace_client_home_views_lensRouting_JS } from './lens-routing';

/** Boot home-views script (rail lenses). Admin, Knowledge, Catalog, Crew, Library are lazy chunks. */
export const workspace_client_home_views_JS = [
  workspace_client_home_views_artifactsBrowser_JS,
  workspace_client_home_views_cardActions_JS,
  workspace_client_home_views_cardMenu_JS,
  workspace_client_home_views_schedules_JS,
  workspace_client_home_views_autoForms_JS,
  workspace_client_home_views_analytics_JS,
  workspace_client_home_views_datasets_JS,
  workspace_client_home_views_connectors_JS,
  workspace_client_home_views_connect_JS,
  workspace_client_home_views_modalsForms_JS,
  workspace_client_home_views_adminCore_JS,
  workspace_client_home_views_invite_JS,
  workspace_client_home_views_assets_JS,
  workspace_client_home_views_deliveries_JS,
  workspace_client_home_views_lensRouting_JS,
].join('');
