/** @deprecated Import from chat-platforms/slack/client or delivery. Re-exports for backward compatibility. */
export {
  isSlackAuthError,
  userFacingSlackDeliveryError,
  resolveSlackToken,
  openDmChannel,
  resolveSlackMemberId,
  listSlackChannels,
  buildArtifactUrl,
  type SlackChannel,
} from '../chat-platforms/slack/client';

export {
  invalidSlackBlocks,
  sendArtifactToSlack,
  resolveSlackTokenForArtifact,
  type SlackDeliveryMode,
  type SlackSendOptions,
  type SlackResult,
} from '../chat-platforms/slack/delivery';
