import { randomUUID } from "node:crypto";
import { errorMessage, isRecord, readString } from "@/lib/http";
import { updateCase } from "@/lib/store";

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

    const updated = await updateCase(customerId, {
      status: "recovered",
      outcome: "Payment confirmed by simulated webhook",
      recoveredAt: new Date().toISOString(),
      paymentId: `pay_mock_${randomUUID()}`,
    });

    return Response.json({ case: updated });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
