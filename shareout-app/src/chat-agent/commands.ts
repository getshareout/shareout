import type { PlatformId } from '../chat-platforms/types';
import { getPlatform } from '../chat-platforms/registry';

/** Map a slash/agent command name to an agent prompt, or null if unknown. */
export function commandToAgentPrompt(command: string, args: string): string | null {
  switch (command) {
    case 'alerts':
      return 'List my metric alerts.';
    case 'schedules':
    case 'jobs':
      return 'List my scheduled sends.';
    case 'snapshot':
      return args
        ? `Send me a snapshot image of this page: ${args}`
        : 'Send me a snapshot image of a page. Ask which page if you need to.';
    case 'pdf':
      return args
        ? `Send me a PDF of this page: ${args}`
        : 'Send me a PDF of a page. Ask which page if you need to.';
    case 'refresh':
      return args
        ? `Run the live data for this page and summarize the fresh numbers: ${args}`
        : 'Run live data for a page. Ask which page if you need to.';
    case 'share':
      return args
        ? `Share a page with these instructions: ${args}`
        : 'Help me share a page. Ask which page and email address if you need to.';
    case 'edit':
      return args
        ? `Edit a page with these instructions: ${args}`
        : 'Help me edit a page. Ask which page and what change if you need to.';
    case 'crew':
      return args
        ? `Ask the page crew to do this: ${args}`
        : 'Help me ask a page crew to work. Ask which page and task if you need to.';
    default:
      return null;
  }
}

export function botFeatureFlag(platform: PlatformId): string {
  if (platform === 'web') return 'ai.web_agent';
  return getPlatform(platform)?.featureFlag ?? `ai.${platform}_bot`;
}

export function botDisabledMessage(platform: PlatformId): string {
  switch (platform) {
    case 'slack':
      return 'The Slack assistant isn’t enabled for your account right now.';
    case 'web':
      return 'The workspace assistant isn’t available here.';
    default:
      return 'The Telegram assistant isn’t enabled for your account right now.';
  }
}
