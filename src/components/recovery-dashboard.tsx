"use client";

import { useConversation } from "@elevenlabs/react";
import { useMemo, useRef, useState } from "react";
import type {
  RecoveryCase,
  RecoveryStatus,
  TranscriptTurn,
} from "@/lib/types";

type RecoveryDashboardProps = {
  initialCases: RecoveryCase[];
};

type BrowserSessionResponse = {
  error?: string;
  conversationToken?: string;
  conversationId?: string;
  case?: RecoveryCase;
  session?: {
    userId: string;
    dynamicVariables: Record<string, string | number | boolean>;
    overrides: {
      agent: {
        firstMessage: string;
        language: "en";
        prompt: { prompt: string };
      };
      tts: { speed: number };
    };
  };
};

const statusLabels: Record<RecoveryStatus, string> = {
  ready: "Ready",
  calling: "Calling",
  link_sent: "Link sent",
  promised: "Promise to pay",
  escalated: "Escalated",
  opted_out: "Opted out",
  recovered: "Recovered",
  failed: "Unresolved",
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "Not contacted";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function RecoveryDashboard({
  initialCases,
}: RecoveryDashboardProps) {
  const [cases, setCases] = useState(initialCases);
  const [selectedId, setSelectedId] = useState(initialCases[0]?.id ?? "");
  const [filter, setFilter] = useState<"all" | "open" | "recovered">("all");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<TranscriptTurn[]>([]);
  const [activeVoiceRecord, setActiveVoiceRecord] =
    useState<RecoveryCase | null>(null);
  const activeRecordRef = useRef<RecoveryCase | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const sessionStartedAtRef = useRef<number>(0);

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      conversationIdRef.current = conversationId;
      setNotice("ElevenLabs browser voice session connected.");
    },
    onMessage: ({ message, role }) => {
      const elapsed = Math.max(
        0,
        Math.floor((Date.now() - sessionStartedAtRef.current) / 1000),
      );
      setLiveTranscript((current) => [
        ...current,
        {
          role: role === "agent" ? "agent" : "customer",
          message,
          timestamp: `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`,
        },
      ]);
    },
    onError: (message) => {
      setVoiceError(message);
      setNotice(`Voice session error: ${message}`);
    },
    onDisconnect: () => {
      const record = activeRecordRef.current;
      const conversationId = conversationIdRef.current;
      if (record && conversationId) {
        void syncVoiceSession(record.id, conversationId);
      }
    },
  });

  const visibleCases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return cases.filter((record) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "recovered" && record.status === "recovered") ||
        (filter === "open" && record.status !== "recovered");
      const matchesSearch =
        !query ||
        record.name.toLowerCase().includes(query) ||
        record.merchant.toLowerCase().includes(query) ||
        record.failureReason.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [cases, filter, search]);

  const selected =
    cases.find((record) => record.id === selectedId) ?? cases[0] ?? null;
  const outstanding = cases
    .filter((record) => record.status !== "recovered")
    .reduce((sum, record) => sum + record.amount, 0);
  const recovered = cases
    .filter((record) => record.status === "recovered")
    .reduce((sum, record) => sum + record.amount, 0);
  const contacted = cases.filter((record) => record.lastContact).length;
  const recoveryRate = Math.round(
    (cases.filter((record) => record.status === "recovered").length /
      Math.max(cases.length, 1)) *
      100,
  );

  function replaceCase(updated: RecoveryCase) {
    setCases((current) =>
      current.map((record) => (record.id === updated.id ? updated : record)),
    );
  }

  async function syncVoiceSession(
    customerId: string,
    conversationId: string,
  ) {
    try {
      const response = await fetch("/api/browser-session/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, conversationId }),
      });
      const result: { error?: string; case?: RecoveryCase; processing?: boolean } =
        await response.json();
      if (!response.ok || !result.case) {
        throw new Error(result.error ?? "Unable to synchronize voice session.");
      }
      replaceCase(result.case);
      setNotice(
        result.processing
          ? "Voice session saved; ElevenLabs analysis is still processing."
          : "Voice transcript and outcome synchronized.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Unable to synchronize voice session.",
      );
    }
  }

  async function startVoiceSession(record: RecoveryCase) {
    setBusyId(record.id);
    setNotice(null);
    setVoiceError(null);
    setLiveTranscript([]);
    setVoiceOpen(true);
    setActiveVoiceRecord(record);
    activeRecordRef.current = record;
    conversationIdRef.current = null;
    sessionStartedAtRef.current = Date.now();

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const response = await fetch("/api/browser-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: record.id }),
      });
      const result: BrowserSessionResponse = await response.json();
      if (
        !response.ok ||
        !result.case ||
        !result.conversationToken ||
        !result.conversationId ||
        !result.session
      ) {
        throw new Error(
          result.error ?? "Unable to start ElevenLabs voice session.",
        );
      }

      replaceCase(result.case);
      setSelectedId(result.case.id);
      conversationIdRef.current = result.conversationId;
      conversation.startSession({
        conversationToken: result.conversationToken,
        connectionType: "webrtc",
        userId: result.session.userId,
        dynamicVariables: result.session.dynamicVariables,
        overrides: result.session.overrides,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Voice session failed.";
      setVoiceError(message);
      setNotice(message);
    } finally {
      setBusyId(null);
    }
  }

  function endVoiceSession() {
    conversation.endSession();
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <div>
            <strong>RecoverAI</strong>
            <span>Autopay operations</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className="nav-item active" href="#overview">
            <span className="nav-icon">⌁</span>Overview
          </a>
          <a className="nav-item" href="#cases">
            <span className="nav-icon">◎</span>Recovery cases
            <span className="nav-count">{cases.length}</span>
          </a>
          <a className="nav-item" href="#analytics">
            <span className="nav-icon">↗</span>Analytics
          </a>
          <a className="nav-item" href="#setup">
            <span className="nav-icon">◇</span>Integrations
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="live-dot" />
          <div>
            <strong>Demo safeguards on</strong>
            <p>Browser voice uses microphone permission and fictional data.</p>
          </div>
        </div>
        <div className="operator">
          <span className="operator-avatar">PM</span>
          <div>
            <strong>Priya Menon</strong>
            <span>Payment Operations</span>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Payment recovery workspace</p>
            <h1>Good afternoon, Priya</h1>
            <p>Here is how your autopay recovery queue is performing.</p>
          </div>
          <div className="topbar-actions">
            <span className="environment-pill">
              <span className="live-dot" />
              Safe demo mode
            </span>
            <button className="icon-button" aria-label="Notifications">
              <span>◌</span>
              <i />
            </button>
          </div>
        </header>

        {notice ? (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss message">
              ×
            </button>
          </div>
        ) : null}

        <section className="metric-grid" id="overview">
          <article className="metric-card metric-featured">
            <div className="metric-heading">
              <span>Outstanding revenue</span>
              <span className="metric-icon">₹</span>
            </div>
            <strong>{formatCurrency(outstanding)}</strong>
            <p>
              <b>{cases.filter((record) => record.status !== "recovered").length}</b>{" "}
              unresolved fictional payments
            </p>
          </article>
          <article className="metric-card">
            <div className="metric-heading">
              <span>Recovered revenue</span>
              <span className="trend positive">+12.4%</span>
            </div>
            <strong>{formatCurrency(recovered)}</strong>
            <p>Confirmed by payment status, not conversation intent</p>
          </article>
          <article className="metric-card">
            <div className="metric-heading">
              <span>Customers contacted</span>
              <span className="metric-icon soft">☎</span>
            </div>
            <strong>
              {contacted}
              <small> / {cases.length}</small>
            </strong>
            <p>Across live and simulated recovery attempts</p>
          </article>
          <article className="metric-card">
            <div className="metric-heading">
              <span>Recovery rate</span>
              <span className="trend positive">verified</span>
            </div>
            <strong>{recoveryRate}%</strong>
            <div className="progress-track">
              <span style={{ width: `${recoveryRate}%` }} />
            </div>
            <p>Based only on confirmed successful payments</p>
          </article>
        </section>

        <section className="content-grid" id="cases">
          <div className="queue-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recovery queue</p>
                <h2>Failed autopay cases</h2>
              </div>
              <div className="view-filters" aria-label="Filter cases">
                {(["all", "open", "recovered"] as const).map((value) => (
                  <button
                    className={filter === value ? "active" : ""}
                    key={value}
                    onClick={() => setFilter(value)}
                  >
                    {value[0].toUpperCase() + value.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="queue-toolbar">
              <label className="search-box">
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search customer, merchant, or failure"
                />
              </label>
              <span>{visibleCases.length} records</span>
            </div>
            <div className="case-list">
              {visibleCases.map((record) => (
                <button
                  className={`case-row ${selected?.id === record.id ? "selected" : ""}`}
                  key={record.id}
                  onClick={() => setSelectedId(record.id)}
                >
                  <span className={`avatar risk-${record.risk}`}>
                    {record.initials}
                  </span>
                  <span className="case-identity">
                    <strong>{record.name}</strong>
                    <small>
                      {record.merchant} · {record.plan}
                    </small>
                  </span>
                  <span className="case-failure">
                    <strong>{record.failureReason}</strong>
                    <small>{formatDate(record.failedAt)}</small>
                  </span>
                  <span className="case-amount">
                    <strong>{formatCurrency(record.amount)}</strong>
                    <small>{record.attempts} attempt(s)</small>
                  </span>
                  <span className={`status status-${record.status}`}>
                    {statusLabels[record.status]}
                  </span>
                  <span className="row-arrow">›</span>
                </button>
              ))}
              {!visibleCases.length ? (
                <div className="empty-state">No recovery cases match this view.</div>
              ) : null}
            </div>
          </div>

          {selected ? (
            <aside className="detail-card">
              <div className="detail-accent" />
              <div className="detail-header">
                <span className={`avatar large risk-${selected.risk}`}>
                  {selected.initials}
                </span>
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.id}</p>
                </div>
                <span className={`status status-${selected.status}`}>
                  {statusLabels[selected.status]}
                </span>
              </div>

              <div className="amount-panel">
                <span>Outstanding payment</span>
                <strong>{formatCurrency(selected.amount)}</strong>
                <small>
                  {selected.merchant} · {selected.plan}
                </small>
              </div>

              <dl className="detail-list">
                <div>
                  <dt>Failure reason</dt>
                  <dd>{selected.failureReason}</dd>
                </div>
                <div>
                  <dt>Scenario</dt>
                  <dd>{selected.scenario}</dd>
                </div>
                <div>
                  <dt>Recommended action</dt>
                  <dd>{selected.recommendedAction}</dd>
                </div>
                <div>
                  <dt>Last contact</dt>
                  <dd>{formatDate(selected.lastContact)}</dd>
                </div>
              </dl>

              <div className="action-stack">
                <button
                  className="primary-action"
                  disabled={
                    busyId === selected.id ||
                    selected.status === "opted_out" ||
                    selected.status === "recovered"
                  }
                  onClick={() => startVoiceSession(selected)}
                >
                  <span>◉</span>
                  {busyId === selected.id
                    ? "Connecting voice..."
                    : "Start browser voice session"}
                </button>
                <a className="secondary-action" href={`/pay/${selected.id}`}>
                  Open secure payment page
                  <span>↗</span>
                </a>
              </div>

              <div className="guardrail">
                <span>✓</span>
                <p>
                  <strong>Protected conversation</strong>
                  No OTP, PIN, CVV, or card details are collected by voice.
                </p>
              </div>

              <div className="outcome-section">
                <div className="mini-heading">
                  <h3>Latest outcome</h3>
                  {selected.conversationId ? <span>Transcript ready</span> : null}
                </div>
                <p className="outcome-copy">
                  {selected.outcome ?? "No recovery conversation recorded yet."}
                </p>
                {selected.transcript.length ? (
                  <div className="transcript">
                    {selected.transcript.map((turn, index) => (
                      <div className={`turn turn-${turn.role}`} key={`${turn.timestamp}-${index}`}>
                        <span>{turn.role === "agent" ? "AI" : "CU"}</span>
                        <p>{turn.message}</p>
                        <time>{turn.timestamp}</time>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </aside>
          ) : null}
        </section>

        <footer className="demo-footer" id="setup">
          <p>
            <strong>Hackathon demo:</strong> 10 fictional records · no real customer
            data · microphone access is user initiated
          </p>
          <span>ElevenLabs Browser Voice · Razorpay Test Mode · Supabase</span>
        </footer>
      </section>

      {voiceOpen ? (
        <div className="voice-overlay" role="dialog" aria-modal="true">
          <section className="voice-modal">
            <div className="voice-modal-header">
              <div>
                <p className="eyebrow">ElevenLabs live session</p>
                <h2>{activeVoiceRecord?.name ?? "Recovery conversation"}</h2>
              </div>
              <span className={`voice-status voice-${conversation.status}`}>
                {conversation.status}
              </span>
            </div>

            <div className={`voice-orb ${conversation.isSpeaking ? "speaking" : ""}`}>
              <span />
              <i />
              <b>AI</b>
            </div>
            <div className="voice-mode">
              {conversation.status === "connected"
                ? conversation.isSpeaking
                  ? "Asha is speaking"
                  : "Listening to you"
                : conversation.status === "connecting"
                  ? "Connecting securely..."
                  : "Session disconnected"}
            </div>

            <div className="voice-safety">
              This is an automated browser voice session. Never share an OTP,
              UPI PIN, CVV, card PIN, or banking password.
            </div>

            {voiceError ? <p className="voice-error">{voiceError}</p> : null}

            <div className="live-transcript">
              {liveTranscript.length ? (
                liveTranscript.map((turn, index) => (
                  <div
                    className={`turn turn-${turn.role}`}
                    key={`${turn.timestamp}-${index}`}
                  >
                    <span>{turn.role === "agent" ? "AI" : "YOU"}</span>
                    <p>{turn.message}</p>
                    <time>{turn.timestamp}</time>
                  </div>
                ))
              ) : (
                <p className="voice-placeholder">
                  The live transcript will appear after the conversation starts.
                </p>
              )}
            </div>

            <div className="voice-actions">
              {conversation.status === "connected" ||
              conversation.status === "connecting" ? (
                <button className="end-session" onClick={endVoiceSession}>
                  End voice session
                </button>
              ) : (
                <button
                  className="secondary-action close-session"
                  onClick={() => setVoiceOpen(false)}
                >
                  Close
                </button>
              )}
              {activeVoiceRecord ? (
                <a
                  className="secondary-action"
                  href={`/pay/${activeVoiceRecord.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open payment page ↗
                </a>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
