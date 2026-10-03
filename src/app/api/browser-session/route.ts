import { buildAgentPrompt, buildFirstMessage } from "@/lib/recovery-agent";
import { errorMessage, isRecord, readString } from "@/lib/http";
import { getCase, updateCase } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const customerId = readString(body, "customerId");
    if (!customerId) {
      return Response.json({ error: "customerId is required." }, { status: 400 });
    }

    const record = await getCase(customerId);
    if (!record) {
      return Response.json({ error: "Recovery case not found." }, { status: 404 });
    }
    if (record.status === "opted_out" || record.status === "recovered") {
      return Response.json(
        { error: "This recovery case is not eligible for another voice session." },
        { status: 409 },
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    if (!apiKey || !agentId) {
      return Response.json(
        { error: "ElevenLabs browser voice is not configured." },
        { status: 503 },
      );
    }

    const baseUrl =
      process.env.ELEVENLABS_API_BASE_URL ?? "https://api.elevenlabs.io";
    const tokenUrl = new URL(
      `${baseUrl}/v1/convai/conversation/token`,
    );
    tokenUrl.searchParams.set("agent_id", agentId);
    tokenUrl.searchParams.set("participant_name", record.id);

    const response = await fetch(tokenUrl, {
      headers: { "xi-api-key": apiKey },
      cache: "no-store",
    });
    const result: unknown = await response.json();
    if (!response.ok || !isRecord(result)) {
      throw new Error(
        `Unable to create ElevenLabs browser session (${response.status}).`,
      );
    }

    const conversationToken = readString(result, "token");
    const conversationId = readString(result, "conversation_id");
    if (!conversationToken || !conversationId) {
      throw new Error("ElevenLabs did not return a valid browser session.");
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const paymentLink = `${appUrl}/pay/${record.id}`;
    const updated = await updateCase(record.id, {
      status: "calling",
      attempts: record.attempts + 1,
      lastContact: new Date().toISOString(),
      outcome: "Browser voice session initiated",
      conversationId,
    });

    return Response.json({
      conversationToken,
      conversationId,
      case: updated,
      session: {
        userId: record.id,
        dynamicVariables: {
          case_id: record.id,
          customer_name: record.name,
          merchant_name: record.merchant,
          amount_inr: record.amount,
          failure_reason: record.failureReason,
          payment_link: paymentLink,
        },
        overrides: {
          agent: {
            firstMessage: buildFirstMessage(record),
            language: "en",
            prompt: { prompt: buildAgentPrompt(record) },
          },
          tts: { speed: 0.95 },
        },
      },
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
