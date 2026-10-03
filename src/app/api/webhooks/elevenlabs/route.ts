import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import {
  conversationOutcome,
  transcriptFromElevenLabs,
} from "@/lib/elevenlabs-conversation";
import { errorMessage, isRecord, readString } from "@/lib/http";
import { claimWebhookEvent, getCase, updateCase } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("elevenlabs-signature");
    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;

    if (!signature || !secret) {
      return Response.json(
        { error: "Webhook authentication is not configured." },
        { status: 401 },
      );
    }

    const client = new ElevenLabsClient();
    const constructed: unknown = await client.webhooks.constructEvent(
      rawBody,
      signature,
      secret,
    );

    if (!isRecord(constructed)) {
      return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
    }

    const type = readString(constructed, "type");
    const data = constructed.data;
    if (!isRecord(data)) {
      return Response.json({ received: true, ignored: true });
    }

    const conversationId = readString(data, "conversation_id");
    if (!conversationId) {
      return Response.json({ received: true, ignored: true });
    }

    if (!(await claimWebhookEvent("elevenlabs", `${type}:${conversationId}`))) {
      return Response.json({ received: true, duplicate: true });
    }

    const initiation = data.conversation_initiation_client_data;
    const dynamicVariables =
      isRecord(initiation) && isRecord(initiation.dynamic_variables)
        ? initiation.dynamic_variables
        : null;
    const caseId =
      (dynamicVariables && readString(dynamicVariables, "case_id")) ??
      readString(data, "user_id");

    if (!caseId || !(await getCase(caseId))) {
      return Response.json({ received: true, ignored: true });
    }

    if (type === "call_initiation_failure") {
      await updateCase(caseId, {
        status: "failed",
        outcome: `Call failed: ${readString(data, "failure_reason") ?? "unknown"}`,
        conversationId,
      });
      return Response.json({ received: true });
    }

    if (type !== "post_call_transcription") {
      return Response.json({ received: true, ignored: true });
    }

    const outcome = conversationOutcome(data);

    await updateCase(caseId, {
      status: outcome.successful ? "link_sent" : "escalated",
      outcome: outcome.summary,
      conversationId,
      transcript: transcriptFromElevenLabs(data),
    });

    return Response.json({ received: true });
  } catch (error) {
    const message = errorMessage(error);
    const status = message.toLowerCase().includes("signature") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
