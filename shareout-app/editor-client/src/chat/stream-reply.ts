// The streaming-reply extractor now lives in @shareout/chat-core so the editor and
// the server-rendered chats (home, create) share one implementation. Re-exported
// here to keep existing importers and tests stable.
export { extractStreamingReply } from '@shareout/chat-core';
