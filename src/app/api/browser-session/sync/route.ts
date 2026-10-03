import {
  conversationOutcome,
  transcriptFromElevenLabs,
} from "@/lib/elevenlabs-conversation";
import { errorMessage, isRecord, readString } from "@/lib/http";
import { getCase, updateCase } from "@/lib/store";

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const customerId = readString(body, "customerId");
    const conversationId = readString(body, "conversationId");
    if (!customerId || !conversationId) {
      return Response.json(
        { error: "customerId and conversationId are required." },
        { status: 400 },
      );
    }

    const record = await getCase(customerId);
    if (!record || record.conversationId !== conversationId) {
      return Response.json({ error: "Voice session not found." }, { status: 404 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: "ElevenLabs is not configured." },
        { status: 503 },
      );
    }

    const baseUrl =
      process.env.ELEVENLABS_API_BASE_URL ?? "https://api.elevenlabs.io";
    let conversation: Record<string, unknown> | null = null;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(
        `${baseUrl}/v1/convai/conversations/${conversationId}`,
        {
          headers: { "xi-api-key": apiKey },
          cache: "no-store",
        },
      );
      const result: unknown = await response.json();
      if (!response.ok || !isRecord(result)) {
        throw new Error(
          `Unable to synchronize ElevenLabs conversation (${response.status}).`,
        );
      }
      conversation = result;
      if (readString(result, "status") === "done") {
        break;
      }
      await wait(750);
    }

    if (!conversation) {
      throw new Error("Conversation synchronization returned no data.");
    }

    const userId = readString(conversation, "user_id");
    if (userId && userId !== customerId) {
      return Response.json(
        { error: "Conversation ownership validation failed." },
        { status: 403 },
      );
    }

    const transcript = transcriptFromElevenLabs(conversation);
    const outcome = conversationOutcome(conversation);
    const stillProcessing = readString(conversation, "status") !== "done";
    const updated = await updateCase(customerId, {
      status: stillProcessing
        ? "calling"
        : outcome.successful
          ? "link_sent"
          : "escalated",
      outcome: stillProcessing
        ? "Voice session ended; ElevenLabs analysis is processing"
        : outcome.summary,
      transcript,
    });

    return Response.json({ case: updated, processing: stillProcessing });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
