-- TONBounty indexed read model.
--
-- The chain (contracts/) is the source of truth for value & critical state
-- (escrow balance, deadline, winners, payout). This schema mirrors that state
-- for fast querying and joins it with off-chain content resolved from IPFS
-- (full description text, submission write-ups, categories, search).
--
-- Run against a Supabase/Postgres database, e.g. via the Supabase SQL editor
-- or `supabase db push`.

create table if not exists bounties (
    id                          uuid primary key default gen_random_uuid(),
    onchain_id                  bigint not null unique,
    contract_address            text not null unique,
    creator_address             text not null,

    title                       text not null,
    category                    text not null default 'General',
    tags                        text[] not null default '{}',

    description_cid             text not null,
    description_markdown        text not null default '',

    duration_seconds            integer not null
                                check (duration_seconds in (7200, 14400, 28800, 43200, 86400)),
    created_at                  timestamptz not null default now(),
    deadline                    timestamptz not null,

    winner_slots                smallint not null check (winner_slots > 0),
    reward_per_winner_nanoton   numeric(38, 0) not null check (reward_per_winner_nanoton > 0),

    submission_count            integer not null default 0,
    status                      text not null default 'open'
                                check (status in ('open', 'awaiting_selection', 'completed', 'expired')),

    indexed_at                  timestamptz not null default now()
);

create index if not exists bounties_status_idx on bounties (status);
create index if not exists bounties_category_idx on bounties (category);
create index if not exists bounties_deadline_idx on bounties (deadline);
create index if not exists bounties_search_idx on bounties using gin (
    to_tsvector('english', title || ' ' || coalesce(description_markdown, ''))
);

create table if not exists submissions (
    id                  uuid primary key default gen_random_uuid(),
    bounty_id           uuid not null references bounties (id) on delete cascade,
    submitter_address   text not null,
    proof_cid           text not null,
    proof_preview       text not null default '',
    submitted_at        timestamptz not null default now(),
    is_winner           boolean not null default false,

    unique (bounty_id, submitter_address, proof_cid)
);

create index if not exists submissions_bounty_idx on submissions (bounty_id);

create table if not exists indexer_cursor (
    id              text primary key,
    last_lt         numeric(38, 0) not null default 0,
    last_hash       text,
    updated_at      timestamptz not null default now()
);

insert into indexer_cursor (id, last_lt)
values ('bounty_factory', 0)
on conflict (id) do nothing;
