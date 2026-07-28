import type { ChatPlatform, PlatformId } from './types';

const platforms = new Map<PlatformId, ChatPlatform>();

export function registerPlatform(platform: ChatPlatform): void {
  platforms.set(platform.id, platform);
}

export function getPlatform(id: PlatformId): ChatPlatform | null {
  return platforms.get(id) ?? null;
}
