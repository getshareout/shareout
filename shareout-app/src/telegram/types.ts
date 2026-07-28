// Minimal subset of the Telegram Bot API update payload we consume.
// Full schema: https://core.telegram.org/bots/api#update

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

// A Telegram voice note (mic recording) or arbitrary audio file. Both reference an
// uploaded file via file_id, which we resolve with getFile + download.
export interface TelegramAudio {
  file_id: string;
  /** Length in seconds (Telegram-provided). Used for cost tracking + a sanity cap. */
  duration?: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  voice?: TelegramAudio;
  audio?: TelegramAudio;
}

export interface TelegramCallbackQuery {
  id: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  /** The button's callback_data (we encode "<decision>:<token>"). */
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}
