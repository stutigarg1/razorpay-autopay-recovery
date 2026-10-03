import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cloneFictionalCases } from "@/lib/seed-data";
import type { RecoveryCase } from "@/lib/types";

type RuntimeState = {
  cases: RecoveryCase[];
  webhookEvents: Set<string>;
};

const runtime = globalThis as typeof globalThis & {
  __autopayRecoveryState?: RuntimeState;
};

function getRuntimeState(): RuntimeState {
  runtime.__autopayRecoveryState ??= {
    cases: cloneFictionalCases(),
    webhookEvents: new Set<string>(),
  };
  return runtime.__autopayRecoveryState;
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url && !serviceRoleKey) {
    return null;
  }

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function seedSupabase(supabase: SupabaseClient): Promise<RecoveryCase[]> {
  const records = cloneFictionalCases();
  const { error } = await supabase.from("recovery_cases").upsert(
    records.map((record) => ({
      id: record.id,
      record,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "id" },
  );

  if (error) {
    throw new Error(`Unable to seed recovery cases: ${error.message}`);
  }

  return records;
}

export async function getCases(): Promise<RecoveryCase[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return structuredClone(getRuntimeState().cases);
  }

  const { data, error } = await supabase
    .from("recovery_cases")
    .select("record")
    .order("id");

  if (error) {
    throw new Error(`Unable to load recovery cases: ${error.message}`);
  }

  if (!data.length) {
    return seedSupabase(supabase);
  }

  return data.map(({ record }) => record as RecoveryCase);
}

export async function getCase(id: string): Promise<RecoveryCase | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const record = getRuntimeState().cases.find((item) => item.id === id);
    return record ? structuredClone(record) : null;
  }

  const { data, error } = await supabase
    .from("recovery_cases")
    .select("record")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load recovery case: ${error.message}`);
  }

  if (!data) {
    const seeded = await seedSupabase(supabase);
    return seeded.find((item) => item.id === id) ?? null;
  }

  return data.record as RecoveryCase;
}

export async function updateCase(
  id: string,
  patch: Partial<RecoveryCase>,
): Promise<RecoveryCase> {
  const current = await getCase(id);
  if (!current) {
    throw new Error(`Recovery case ${id} was not found.`);
  }

  const updated: RecoveryCase = { ...current, ...patch, id: current.id };
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    const state = getRuntimeState();
    state.cases = state.cases.map((item) => (item.id === id ? updated : item));
    return structuredClone(updated);
  }

  const { error } = await supabase.from("recovery_cases").upsert({
    id,
    record: updated,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Unable to update recovery case: ${error.message}`);
  }

  return updated;
}

export async function claimWebhookEvent(
  provider: "razorpay" | "elevenlabs",
  eventId: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    const key = `${provider}:${eventId}`;
    const state = getRuntimeState();
    if (state.webhookEvents.has(key)) {
      return false;
    }
    state.webhookEvents.add(key);
    return true;
  }

  const { error } = await supabase.from("webhook_events").insert({
    provider,
    event_id: eventId,
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  throw new Error(`Unable to record webhook event: ${error.message}`);
}
