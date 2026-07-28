import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { ChatReplyPort } from '../../../src/chat-platforms/types';

const resolveArtifactAccessForUser = vi.hoisted(() => vi.fn());
const renderArtifactImage = vi.hoisted(() => vi.fn());
const renderArtifactPdf = vi.hoisted(() => vi.fn());

vi.mock('../../../src/chat-agent/access', () => ({ resolveArtifactAccessForUser }));
vi.mock('../../../src/screenshots', () => ({ renderArtifactImage, renderArtifactPdf }));

import { sendSnapshotTool, sendPdfTool } from '../../../src/chat-agent/tools/media';

const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ name: 'Sales Dashboard' }) }) }) },
} as unknown as Env;

function mockReply(): ChatReplyPort & {
  sendImage: ReturnType<typeof vi.fn>;
  sendFile: ReturnType<typeof vi.fn>;
  sendTyping: ReturnType<typeof vi.fn>;
} {
  return {
    sendText: vi.fn(),
    sendTyping: vi.fn(),
    sendImage: vi.fn().mockResolvedValue(true),
    sendFile: vi.fn().mockResolvedValue(true),
    sendArtifactCards: vi.fn(),
    askConfirmation: vi.fn(),
  };
}

beforeEach(() => {
  resolveArtifactAccessForUser.mockReset();
  renderArtifactImage.mockReset();
  renderArtifactPdf.mockReset();
  resolveArtifactAccessForUser.mockResolvedValue({ role: 'owner', workspaceId: null, viewerScope: null });
});
afterEach(() => vi.restoreAllMocks());

describe('send_snapshot tool', () => {
  it('denies when the user has no access (no render, no send)', async () => {
    resolveArtifactAccessForUser.mockResolvedValue(null);
    const reply = mockReply();
    const out = await sendSnapshotTool.execute({ env, userId: 'user_1', reply }, { artifact_id: 'art_1' }) as { error?: string };
    expect(out.error).toMatch(/access/i);
    expect(renderArtifactImage).not.toHaveBeenCalled();
    expect(reply.sendImage).not.toHaveBeenCalled();
  });

  it('renders and sends via ChatReplyPort on the happy path', async () => {
    renderArtifactImage.mockResolvedValue(new ArrayBuffer(16));
    const reply = mockReply();
    const out = await sendSnapshotTool.execute({ env, userId: 'user_1', reply }, { artifact_id: 'art_1' }) as { sent?: boolean };
    expect(out.sent).toBe(true);
    expect(reply.sendImage).toHaveBeenCalledOnce();
    expect(reply.sendImage.mock.calls[0][1]).toBe('sales-dashboard.png');
  });

  it('errors when rendering fails', async () => {
    renderArtifactImage.mockResolvedValue(null);
    const reply = mockReply();
    const out = await sendSnapshotTool.execute({ env, userId: 'user_1', reply }, { artifact_id: 'art_1' }) as { error?: string };
    expect(out.error).toBeTruthy();
    expect(reply.sendImage).not.toHaveBeenCalled();
  });

  it('errors when no reply port or chatId', async () => {
    renderArtifactImage.mockResolvedValue(new ArrayBuffer(16));
    const out = await sendSnapshotTool.execute({ env, userId: 'user_1' }, { artifact_id: 'art_1' }) as { error?: string };
    expect(out.error).toMatch(/chat session/i);
  });
});

describe('send_pdf tool', () => {
  it('renders and sends a PDF via ChatReplyPort', async () => {
    renderArtifactPdf.mockResolvedValue(new ArrayBuffer(32));
    const reply = mockReply();
    const out = await sendPdfTool.execute({ env, userId: 'user_1', reply }, { artifact_id: 'art_1' }) as { sent?: boolean };
    expect(out.sent).toBe(true);
    expect(reply.sendFile).toHaveBeenCalledOnce();
    expect(reply.sendFile.mock.calls[0][1]).toBe('sales-dashboard.pdf');
    expect(reply.sendFile.mock.calls[0][2]).toBe('application/pdf');
  });
});
