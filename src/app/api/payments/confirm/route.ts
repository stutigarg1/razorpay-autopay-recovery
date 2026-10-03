import { validatePaymentVerification } from "razorpay/dist/utils/razorpay-utils";
import Razorpay from "razorpay";
import { errorMessage, isRecord, readString } from "@/lib/http";
import { updateCase } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }

    const customerId = readString(body, "customerId");
    const orderId = readString(body, "razorpayOrderId");
    const paymentId = readString(body, "razorpayPaymentId");
    const signature = readString(body, "razorpaySignature");
    const keyId = process.env.RAZORPAY_KEY_ID;
    const secret = process.env.RAZORPAY_KEY_SECRET;

    if (
      !customerId ||
      !orderId ||
      !paymentId ||
      !signature ||
      !keyId ||
      !secret
    ) {
      return Response.json(
        { error: "Payment confirmation fields are incomplete." },
        { status: 400 },
      );
    }

    const valid = validatePaymentVerification(
      { order_id: orderId, payment_id: paymentId },
      signature,
      secret,
    );

    if (!valid) {
      return Response.json(
        { error: "Payment signature validation failed." },
        { status: 401 },
      );
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: secret });
    const payment = await razorpay.payments.fetch(paymentId);
    const captured = payment.status === "captured";
    const updated = await updateCase(
      customerId,
      captured
        ? {
            status: "recovered",
            outcome: "Payment captured and verified through Razorpay",
            recoveredAt: new Date().toISOString(),
            paymentId,
          }
        : {
            status: "link_sent",
            outcome: `Payment signature verified; awaiting capture webhook (${payment.status})`,
            paymentId,
          },
    );

    return Response.json({ case: updated, recovered: captured });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
