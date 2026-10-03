create table if not exists public.recovery_cases (
  id text primary key,
  record jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  provider text not null,
  event_id text not null,
  created_at timestamptz not null default now(),
  primary key (provider, event_id)
);

alter table public.recovery_cases enable row level security;
alter table public.webhook_events enable row level security;

-- The application accesses these tables only through the server-side service role.
