import { ShareOutError } from '../../../shareout-error';
import type { SdkClient } from '../../../core/sdk-client';
import type { PresentationVersion, Slide, VersionDiff } from '../types';

/** Named snapshots of a deck with restore and diff support. */
export class PresentationVersionsManager {
  private _subscribers: Set<(versions: PresentationVersion[]) => void> = new Set();
  private _cached: PresentationVersion[] = [];

  constructor(
    private sdk: SdkClient,
    private presId: string,
  ) {}

  async list(): Promise<PresentationVersion[]> {
    const result = await this.sdk._internalFetch<{ versions: PresentationVersion[]; count: number }>(
      `/slides/${encodeURIComponent(this.presId)}/versions`,
    );
    this._cached = result.versions;
    return result.versions;
  }

  async create(name: string, description?: string): Promise<PresentationVersion> {
    const version = await this.sdk._internalFetch<PresentationVersion>(
      `/slides/${encodeURIComponent(this.presId)}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      },
    );
    this._cached.unshift(version);
    this.notifySubscribers();
    return version;
  }

  async get(versionId: string): Promise<PresentationVersion & { snapshot: Slide[] }> {
    return this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/versions/${encodeURIComponent(versionId)}`,
    );
  }

  async restore(versionId: string): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST' },
    );
  }

  async delete(versionId: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(
        `/slides/${encodeURIComponent(this.presId)}/versions/${encodeURIComponent(versionId)}`,
        { method: 'DELETE' },
      );
      this._cached = this._cached.filter((v) => v.id !== versionId);
      this.notifySubscribers();
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'VERSION_NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  async diff(fromId: string, toId: string): Promise<VersionDiff> {
    return this.sdk._internalFetch<VersionDiff>(
      `/slides/${encodeURIComponent(this.presId)}/versions/diff?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
    );
  }

  subscribe(handler: (versions: PresentationVersion[]) => void): () => void {
    this._subscribers.add(handler);
    return () => this._subscribers.delete(handler);
  }

  private notifySubscribers(): void {
    this._subscribers.forEach((fn) => fn(this._cached));
  }
}
