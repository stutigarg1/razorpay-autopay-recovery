import { randomUUID } from "node:crypto";
import Razorpay from "razorpay";
import { errorMessage, isRecord, readString } from "@/lib/http";
import { getCase, updateCase } from "@/lib/store";
import type { PaymentOrderResponse } from "@/lib/types";

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

    if (record.status === "recovered") {
      return Response.json(
        { error: "This payment is already confirmed." },
        { status: 409 },
      );
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    let result: PaymentOrderResponse;

    if (keyId && keySecret) {
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      const order = await razorpay.orders.create({
        amount: record.amount * 100,
        currency: "INR",
        receipt: record.id,
        notes: {
          case_id: record.id,
          merchant: record.merchant,
          purpose: "autopay_recovery_demo",
        },
      });

      result = {
        mode: "razorpay",
        orderId: order.id,
        amount: record.amount * 100,
        currency: "INR",
        keyId,
      };
    } else {
      result = {
        mode: "simulated",
        orderId: `order_mock_${randomUUID()}`,
        amount: record.amount * 100,
        currency: "INR",
      };
    }

    await updateCase(record.id, {
      status: "link_sent",
      outcome:
        result.mode === "razorpay"
          ? "Razorpay test order created"
          : "Simulated payment order created",
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
