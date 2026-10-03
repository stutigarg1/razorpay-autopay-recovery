import { isRecord, readString } from "@/lib/http";
import type { TranscriptTurn } from "@/lib/types";

export function transcriptFromElevenLabs(
  data: Record<string, unknown>,
): TranscriptTurn[] {
  if (!Array.isArray(data.transcript)) {
    return [];
  }

  return data.transcript.flatMap((turn): TranscriptTurn[] => {
    if (!isRecord(turn)) {
      return [];
    }
    const role = readString(turn, "role");
    const message = readString(turn, "message");
    const seconds = turn.time_in_call_secs;
    if ((role !== "agent" && role !== "user") || !message) {
      return [];
    }
    const time = typeof seconds === "number" ? seconds : 0;
    return [
      {
        role: role === "agent" ? "agent" : "customer",
        message,
        timestamp: `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(Math.floor(time % 60)).padStart(2, "0")}`,
      },
    ];
  });
}

export function conversationOutcome(data: Record<string, unknown>): {
  summary: string;
  successful: boolean;
} {
  const analysis = isRecord(data.analysis) ? data.analysis : null;
  return {
    summary:
      (analysis && readString(analysis, "transcript_summary")) ??
      "Voice session completed; review transcript",
    successful:
      analysis !== null &&
      readString(analysis, "call_successful") === "success",
  };
}
