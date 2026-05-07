export interface PlayerEventPayload {
  event?: string;
  currentTime?: number;
  duration?: number;
  video_id?: string;
}

export interface PlayerEventMessage {
  type: 'PLAYER_EVENT';
  event: PlayerEventPayload;
}
