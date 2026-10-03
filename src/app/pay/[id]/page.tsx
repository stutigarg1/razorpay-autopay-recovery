import { notFound } from "next/navigation";
import { PaymentExperience } from "@/components/payment-experience";
import { getCase } from "@/lib/store";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const record = await getCase(id);

  if (!record) {
    notFound();
  }

  return <PaymentExperience record={record} />;
}
