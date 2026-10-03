import { randomUUID } from "node:crypto";
import { buildAgentPrompt, buildFirstMessage, mockTranscript } from "@/lib/recovery-agent";
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

    if (record.status === "opted_out") {
      return Response.json(
        { error: "This customer has opted out of recovery calls." },
        { status: 409 },
      );
    }

    if (record.status === "recovered") {
      return Response.json(
        { error: "This payment is already recovered." },
        { status: 409 },
      );
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
    const authorizedNumber = process.env.AUTHORIZED_DEMO_PHONE_NUMBER;
    const paymentLink = `${process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin}/pay/${record.id}`;

    if (!apiKey || !agentId || !phoneNumberId || !authorizedNumber) {
      const conversationId = `mock-${randomUUID()}`;
      const updated = await updateCase(record.id, {
        status: "link_sent",
        attempts: record.attempts + 1,
        lastContact: new Date().toISOString(),
        outcome: "Simulated call completed; secure link requested",
        conversationId,
        transcript: mockTranscript(record),
      });

      return Response.json({
        mode: "simulated",
        conversationId,
        case: updated,
        message:
          "Provider credentials are not configured, so the safe simulated call flow was used.",
      });
    }

    const baseUrl =
      process.env.ELEVENLABS_API_BASE_URL ?? "https://api.elevenlabs.io";
    const response = await fetch(
      `${baseUrl}/v1/convai/twilio/outbound-call`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          agent_id: agentId,
          agent_phone_number_id: phoneNumberId,
          to_number: authorizedNumber,
          call_recording_enabled: false,
          telephony_call_config: {
            ringing_timeout_secs: 40,
            twilio_call_recording_enabled: false,
          },
          conversation_initiation_client_data: {
            user_id: record.id,
            dynamic_variables: {
              case_id: record.id,
              customer_name: record.name,
              merchant_name: record.merchant,
              amount_inr: String(record.amount),
              failure_reason: record.failureReason,
              payment_link: paymentLink,
            },
            conversation_config_override: {
              conversation: { max_duration_seconds: 240 },
              agent: {
                first_message: buildFirstMessage(record),
                language: "en",
                prompt: {
                  prompt: buildAgentPrompt(record),
                  llm: "gpt-4o-mini",
                },
              },
              tts: {
                model_id: "eleven_flash_v2",
                speed: 0.95,
              },
            },
          },
        }),
      },
    );

    const result: unknown = await response.json();
    if (!response.ok || !isRecord(result)) {
      throw new Error(`ElevenLabs call initiation failed (${response.status}).`);
    }

    const conversationId = readString(result, "conversation_id");
    if (!conversationId) {
      throw new Error("ElevenLabs did not return a conversation ID.");
    }

    const updated = await updateCase(record.id, {
      status: "calling",
      attempts: record.attempts + 1,
      lastContact: new Date().toISOString(),
      outcome: "Outbound call initiated",
      conversationId,
    });

    return Response.json({
      mode: "live",
      conversationId,
      case: updated,
      message: "Live call initiated to the configured authorized number.",
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
