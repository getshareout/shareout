/**
 * Composes the workspace shell inline browser script from focused static fragments.
 * Fragments share one IIFE scope — order matters for `var` hoisting and forward references.
 */
import { workspace_client_preamble_JS } from './preamble';
import { workspace_client_rail_resizers_JS } from './rail-resizers';
import { workspace_client_activity_feed_JS } from './activity-feed';
import { workspace_client_tabs_JS } from './tabs';
import { workspace_client_edit_lite_JS } from './edit-lite';
import { workspace_client_inspector_details_JS } from './inspector-details';
import { workspace_client_inspector_activity_JS } from './inspector-activity';
import { workspace_client_inspector_JS } from './inspector';
import { workspace_client_home_views_JS } from './home-views';
import { workspace_client_routing_JS } from './routing';
import { workspace_client_artifact_links_JS } from './artifact-links';
import { workspace_client_agent_dock_JS } from './agent-dock';
import { workspace_client_onboarding_JS } from './onboarding';
import { workspace_client_create_ai_JS } from './create-ai';
import { workspace_client_widget_layout_JS } from './widget-layout';
import { workspace_client_account_menu_JS } from './account-menu';
import { workspace_client_notifications_JS } from './notifications';
import { workspace_client_tooltips_JS } from './tooltips';
import { workspace_client_command_palette_JS } from './command-palette';
import { workspace_client_pwa_shell_JS } from './pwa-shell';
import { RUN_DRAWER_JS } from '../../../../runs/run-drawer-client';

/** Full client hydration script for the workspace shell. */
export const WORKSPACE_CLIENT = [
  workspace_client_preamble_JS,
  workspace_client_rail_resizers_JS,
  workspace_client_activity_feed_JS,
  workspace_client_tabs_JS,
  workspace_client_edit_lite_JS,
  workspace_client_inspector_details_JS,
  workspace_client_inspector_activity_JS,
  workspace_client_inspector_JS,
  workspace_client_home_views_JS,
  workspace_client_routing_JS,
  workspace_client_artifact_links_JS,
  workspace_client_agent_dock_JS,
  workspace_client_onboarding_JS,
  workspace_client_create_ai_JS,
  workspace_client_widget_layout_JS,
  workspace_client_account_menu_JS,
  workspace_client_notifications_JS,
  workspace_client_tooltips_JS,
  workspace_client_command_palette_JS,
  workspace_client_pwa_shell_JS,
  '})();',
  RUN_DRAWER_JS,
].join('');
