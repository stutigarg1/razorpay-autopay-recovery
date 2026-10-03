import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, ".env.local");

function parseEnv(contents) {
  const values = new Map();
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#][^=]*)=(.*)$/);
    if (match) {
      values.set(match[1].trim(), match[2].trim());
    }
  }
  return values;
}

function setEnvValue(contents, name, value) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  return pattern.test(contents)
    ? contents.replace(pattern, line)
    : `${contents.trimEnd()}\n${line}\n`;
}

function requireValue(values, name) {
  const value = values.get(name);
  if (!value) {
    throw new Error(`${name} is required in .env.local.`);
  }
  return value;
}

async function elevenLabsRequest(baseUrl, apiKey, endpoint, body) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const result = await response.json();
  if (!response.ok) {
    const detail =
      typeof result?.detail === "string"
        ? result.detail
        : JSON.stringify(result?.detail ?? result);
    throw new Error(`ElevenLabs request failed (${response.status}): ${detail}`);
  }
  return result;
}

async function enableBrowserAuthentication(baseUrl, apiKey, agentId) {
  const response = await fetch(`${baseUrl}/v1/convai/agents/${agentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      platform_settings: {
        auth: { enable_auth: true },
        overrides: {
          conversation_config_override: {
            tts: { speed: true },
            agent: {
              first_message: true,
              language: true,
              prompt: { prompt: true },
            },
          },
        },
      },
      version_description:
        "Enable signed browser sessions and customer-specific recovery context",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Unable to enable ElevenLabs browser authentication (${response.status}).`,
    );
  }
}

async function findExistingAgent(baseUrl, apiKey, name) {
  const response = await fetch(
    `${baseUrl}/v1/convai/agents?page_size=100`,
    { headers: { "xi-api-key": apiKey } },
  );
  if (!response.ok) {
    throw new Error(
      `Unable to list existing ElevenLabs agents (${response.status}).`,
    );
  }
  const result = await response.json();
  const agents = Array.isArray(result.agents) ? result.agents : [];
  return agents.find((agent) => agent?.name === name)?.agent_id;
}

async function resolveTwilioPhoneNumber(sid, token, configuredNumber) {
  const authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  const baseUrl = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const endpoints = [
    `${baseUrl}/IncomingPhoneNumbers.json?PageSize=50`,
    `${baseUrl}/OutgoingCallerIds.json?PageSize=50`,
  ];
  const discovered = new Set();

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, {
      headers: { Authorization: authorization },
    });
    if (!response.ok) {
      throw new Error(`Unable to list Twilio caller IDs (${response.status}).`);
    }
    const result = await response.json();
    const entries = [
      ...(Array.isArray(result.incoming_phone_numbers)
        ? result.incoming_phone_numbers
        : []),
      ...(Array.isArray(result.outgoing_caller_ids)
        ? result.outgoing_caller_ids
        : []),
    ];
    for (const entry of entries) {
      if (typeof entry?.phone_number === "string") {
        discovered.add(entry.phone_number);
      }
    }
  }

  const normalize = (number) => number.replace(/\D/g, "");
  const configuredMatch = [...discovered].find(
    (number) => normalize(number) === normalize(configuredNumber),
  );
  if (configuredMatch) {
    return configuredMatch;
  }

  if (discovered.size === 1) {
    return [...discovered][0];
  }

  if (discovered.size === 0) {
    throw new Error(
      "No purchased Twilio number or verified caller ID exists in this account.",
    );
  }

  throw new Error(
    "Multiple Twilio caller IDs exist. Set TWILIO_PHONE_NUMBER to the purchased or verified caller ID to use.",
  );
}

const originalContents = await readFile(envPath, "utf8");
const values = parseEnv(originalContents);
const apiKey = requireValue(values, "ELEVENLABS_API_KEY");
const twilioSid = requireValue(values, "TWILIO_ACCOUNT_SID");
const twilioToken = requireValue(values, "TWILIO_AUTH_TOKEN");
let twilioPhoneNumber = requireValue(values, "TWILIO_PHONE_NUMBER");
const baseUrl =
  values.get("ELEVENLABS_API_BASE_URL") || "https://api.elevenlabs.io";

let envContents = originalContents;
let agentId = values.get("ELEVENLABS_AGENT_ID");
const agentName = "RecoverAI Autopay Recovery";

if (!agentId) {
  agentId = await findExistingAgent(baseUrl, apiKey, agentName);
}

if (!agentId) {
  const agent = await elevenLabsRequest(baseUrl, apiKey, "/v1/convai/agents/create", {
      name: agentName,
      tags: ["hackathon", "autopay-recovery", "demo"],
      conversation_config: {
        asr: {
          provider: "scribe_realtime",
          quality: "high",
          keywords: ["Razorpay", "autopay", "UPI", "mandate", "INR"],
        },
        turn: {
          turn_timeout: 8,
          turn_eagerness: "patient",
          silence_end_call_timeout: 20,
        },
        conversation: {
          max_duration_seconds: 240,
        },
        tts: {
          model_id: "eleven_flash_v2",
          speed: 0.95,
        },
        agent: {
          first_message:
            "Hello, I am Asha, an automated payment assistance agent. May I confirm who I am speaking with?",
          language: "en",
          prompt: {
            llm: "gpt-4o-mini",
            prompt:
              "You are Asha, an automated payment recovery assistant. Confirm identity before disclosing payment details. Never request an OTP, UPI PIN, card PIN, CVV, full card number, bank password, or account balance. Never take payment details by voice. Use the secure hosted payment link. Respect cancellation, disputes, callbacks, wrong-person responses, and call opt-outs. Never claim a payment succeeded without backend confirmation. Begin in English and naturally follow the customer into Hindi or Hinglish.",
          },
        },
      },
      platform_settings: {
        summary_language: "en",
        data_collection: {
          recovery_outcome: {
            type: "string",
            description:
              "One of: payment_link_requested, promise_to_pay, callback_requested, dispute, cancellation, wrong_person, opted_out, no_answer, unresolved.",
          },
          promised_payment_date: {
            type: "string",
            description:
              "The promised payment date in ISO format when explicitly provided, otherwise empty.",
          },
        },
      },
    });

  if (!agent.agent_id) {
    throw new Error("ElevenLabs did not return an agent ID.");
  }
  agentId = agent.agent_id;
  envContents = setEnvValue(envContents, "ELEVENLABS_AGENT_ID", agentId);
  await writeFile(envPath, envContents, "utf8");
  console.log("Created ElevenLabs recovery agent.");
} else {
  envContents = setEnvValue(envContents, "ELEVENLABS_AGENT_ID", agentId);
  await writeFile(envPath, envContents, "utf8");
  console.log("Using existing ElevenLabs recovery agent.");
}

await enableBrowserAuthentication(baseUrl, apiKey, agentId);
console.log("Enabled authenticated browser voice sessions.");

let phoneNumberId = values.get("ELEVENLABS_PHONE_NUMBER_ID");
if (!phoneNumberId) {
  try {
    twilioPhoneNumber = await resolveTwilioPhoneNumber(
      twilioSid,
      twilioToken,
      twilioPhoneNumber,
    );
    envContents = setEnvValue(
      envContents,
      "TWILIO_PHONE_NUMBER",
      twilioPhoneNumber,
    );
    const phone = await elevenLabsRequest(
      baseUrl,
      apiKey,
      "/v1/convai/phone-numbers",
      {
        provider: "twilio",
        label: "RecoverAI Hackathon Caller",
        phone_number: twilioPhoneNumber,
        sid: twilioSid,
        token: twilioToken,
        agent_id: agentId,
        enable_sms: false,
      },
    );

    if (!phone.phone_number_id) {
      throw new Error("ElevenLabs did not return a phone-number ID.");
    }
    phoneNumberId = phone.phone_number_id;
    envContents = setEnvValue(
      envContents,
      "ELEVENLABS_PHONE_NUMBER_ID",
      phoneNumberId,
    );
    console.log("Imported the Twilio number into ElevenLabs.");
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("No purchased Twilio number") ||
        error.message.includes("Multiple Twilio caller IDs"))
    ) {
      console.log(
        "Skipped optional PSTN provisioning; browser voice remains available.",
      );
    } else {
      throw error;
    }
  }
} else {
  console.log("Using existing ElevenLabs phone-number integration.");
}

await writeFile(envPath, envContents, "utf8");
console.log("ElevenLabs provisioning completed.");
