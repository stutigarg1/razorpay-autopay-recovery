"use client";

import Link from "next/link";
import { useState } from "react";
import type { PaymentOrderResponse, RecoveryCase } from "@/lib/types";

type RazorpaySuccess = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpaySuccess) => void;
  prefill: { name: string };
  notes: { case_id: string };
  theme: { color: string };
};

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => { open: () => void };
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

async function loadRazorpay(): Promise<void> {
  if (window.Razorpay) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay Checkout."));
    document.body.appendChild(script);
  });
}

export function PaymentExperience({ record }: { record: RecoveryCase }) {
  const [state, setState] = useState<
    "idle" | "loading" | "success" | "error"
  >(record.status === "recovered" ? "success" : "idle");
  const [message, setMessage] = useState(
    record.status === "recovered"
      ? "This payment has already been confirmed."
      : "Choose the secure button below to complete the outstanding payment.",
  );

  async function confirmRazorpayPayment(
    response: RazorpaySuccess,
  ): Promise<boolean> {
    const confirmation = await fetch("/api/payments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: record.id,
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      }),
    });
    const result: { error?: string; recovered?: boolean } =
      await confirmation.json();
    if (!confirmation.ok) {
      throw new Error(result.error ?? "Payment confirmation failed.");
    }
    return result.recovered === true;
  }

  async function pay() {
    setState("loading");
    setMessage("Creating a secure payment order...");
    try {
      const response = await fetch("/api/payments/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: record.id }),
      });
      const result = (await response.json()) as PaymentOrderResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to create payment order.");
      }

      if (result.mode === "simulated") {
        const simulated = await fetch("/api/payments/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: record.id }),
        });
        if (!simulated.ok) {
          throw new Error("Simulated payment confirmation failed.");
        }
        setState("success");
        setMessage(
          "Payment confirmed by the simulated webhook. The dashboard now counts this as recovered revenue.",
        );
        return;
      }

      if (!result.keyId) {
        throw new Error("Razorpay public key is missing.");
      }

      await loadRazorpay();
      const checkout = new window.Razorpay({
        key: result.keyId,
        amount: result.amount,
        currency: result.currency,
        name: record.merchant,
        description: `${record.plan} payment recovery`,
        order_id: result.orderId,
        prefill: { name: record.name },
        notes: { case_id: record.id },
        theme: { color: "#6656e8" },
        handler: async (payment) => {
          try {
            const recovered = await confirmRazorpayPayment(payment);
            setState("success");
            setMessage(
              recovered
                ? "Razorpay confirmed that the test payment was captured. Recovery is now confirmed."
                : "Razorpay verified the payment response. Recovery will be counted after the capture webhook arrives.",
            );
          } catch (error) {
            setState("error");
            setMessage(
              error instanceof Error
                ? error.message
                : "Payment confirmation failed.",
            );
          }
        },
      });
      checkout.open();
      setState("idle");
      setMessage("Complete the payment in the Razorpay test checkout.");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error ? error.message : "Unable to process payment.",
      );
    }
  }

  return (
    <main className="payment-shell">
      <section className="payment-card">
        <div className="payment-brand">
          <span className="brand-mark">R</span>
          <div>
            <strong>RecoverAI</strong>
            <small>Secure payment assistance</small>
          </div>
        </div>
        <div className="payment-merchant">
          <span>{record.merchant.slice(0, 1)}</span>
          <div>
            <p>Payment requested by</p>
            <h1>{record.merchant}</h1>
          </div>
        </div>
        <div className="payment-amount">
          <span>Amount due</span>
          <strong>{formatCurrency(record.amount)}</strong>
          <small>{record.plan}</small>
        </div>
        <dl className="payment-details">
          <div>
            <dt>Reference</dt>
            <dd>{record.id}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>Previous autopay attempt was unsuccessful</dd>
          </div>
        </dl>
        <div className={`payment-message payment-message-${state}`}>
          <span>{state === "success" ? "✓" : state === "error" ? "!" : "i"}</span>
          <p>{message}</p>
        </div>
        {state !== "success" ? (
          <button
            className="pay-button"
            onClick={pay}
            disabled={state === "loading"}
          >
            {state === "loading"
              ? "Preparing payment..."
              : `Pay ${formatCurrency(record.amount)} securely`}
          </button>
        ) : (
          <Link className="pay-button success-button" href="/">
            Return to recovery dashboard
          </Link>
        )}
        <div className="payment-safety">
          <strong>Payment safety</strong>
          <p>
            Never share an OTP, UPI PIN, CVV, or banking password over a phone
            call. Payment details are entered only in the hosted checkout.
          </p>
        </div>
        <footer>
          <span>Test/demo transaction</span>
          <span>256-bit encrypted checkout</span>
        </footer>
      </section>
    </main>
  );
}
