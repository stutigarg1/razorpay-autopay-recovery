import { createHmac, timingSafeEqual } from "node:crypto";
import { errorMessage, isRecord, readString } from "@/lib/http";
import { claimWebhookEvent, updateCase } from "@/lib/store";

function validSignature(body: string, received: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature");
    const eventId = request.headers.get("x-razorpay-event-id");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !eventId || !secret) {
      return Response.json(
        { error: "Webhook authentication is not configured." },
        { status: 401 },
      );
    }

    if (!validSignature(rawBody, signature, secret)) {
      return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    if (!(await claimWebhookEvent("razorpay", eventId))) {
      return Response.json({ received: true, duplicate: true });
    }

    const payload: unknown = JSON.parse(rawBody);
    if (!isRecord(payload) || readString(payload, "event") !== "payment.captured") {
      return Response.json({ received: true, ignored: true });
    }

    const nestedPayload = payload.payload;
    if (!isRecord(nestedPayload) || !isRecord(nestedPayload.payment)) {
      return Response.json({ received: true, ignored: true });
    }

    const payment = nestedPayload.payment.entity;
    if (!isRecord(payment) || !isRecord(payment.notes)) {
      return Response.json({ received: true, ignored: true });
    }

    const caseId = readString(payment.notes, "case_id");
    const paymentId = readString(payment, "id");
    if (!caseId || !paymentId) {
      return Response.json({ received: true, ignored: true });
    }

    await updateCase(caseId, {
      status: "recovered",
      outcome: "Payment captured and confirmed by Razorpay webhook",
      recoveredAt: new Date().toISOString(),
      paymentId,
    });

    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
