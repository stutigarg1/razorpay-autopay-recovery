import { RecoveryDashboard } from "@/components/recovery-dashboard";
import { VoiceProvider } from "@/components/voice-provider";
import { getCases } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cases = await getCases();
  return (
    <VoiceProvider>
      <RecoveryDashboard initialCases={cases} />
    </VoiceProvider>
  );
}
