export type RecoveryStatus =
  | "ready"
  | "calling"
  | "link_sent"
  | "promised"
  | "escalated"
  | "opted_out"
  | "recovered"
  | "failed";

export type RiskLevel = "low" | "medium" | "high";

export type TranscriptTurn = {
  role: "agent" | "customer";
  message: string;
  timestamp: string;
};

export type RecoveryCase = {
  id: string;
  name: string;
  initials: string;
  merchant: string;
  plan: string;
  amount: number;
  failureReason: string;
  failedAt: string;
  status: RecoveryStatus;
  risk: RiskLevel;
  recommendedAction: string;
  scenario: string;
  attempts: number;
  lastContact: string | null;
  phoneLabel: string;
  outcome: string | null;
  conversationId: string | null;
  transcript: TranscriptTurn[];
  recoveredAt: string | null;
  paymentId: string | null;
};

export type PaymentOrderResponse = {
  mode: "razorpay" | "simulated";
  orderId: string;
  amount: number;
  currency: "INR";
  keyId?: string;
};
