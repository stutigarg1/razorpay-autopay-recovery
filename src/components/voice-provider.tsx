"use client";

import { ConversationProvider } from "@elevenlabs/react";

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  return <ConversationProvider>{children}</ConversationProvider>;
}
