-- OPTIONAL example seed — crew runtime quotas per account tier.
--
-- Not a migration. Nothing in migrations/ applies this, and ShareOut runs fine
-- without it: a tier with no row here gets the 'free' numbers from the FALLBACK
-- constant in src/crew/limits.ts, which is what every account gets by default.
--
-- You only need this if you set users.tier to something other than 'free' and want
-- those accounts to get different ceilings.
--
--   wrangler d1 execute DB --local  --file seeds/crew-limits.example.sql
--   wrangler d1 execute DB --remote --file seeds/crew-limits.example.sql
--
-- The numbers below are an example. Pick ceilings that match what your instance can
-- afford to spend on model calls.
--
--   max_crews_per_artifact        how many crews one artifact may define
--   max_concurrent_runs           per-owner cap on simultaneously running crews
--   default_run_budget_micro_usd  spend ceiling for a single run, in millionths of a USD
--   max_iterations_cap            hard stop on agent loop iterations per run
INSERT OR IGNORE INTO plan_crew_limits
  (plan, max_crews_per_artifact, max_concurrent_runs, default_run_budget_micro_usd, max_iterations_cap) VALUES
  ('free',        1,  1,   250000,  8),
  ('pro',         3,  2,  1000000, 16),
  ('team',       10,  5,  5000000, 32),
  ('enterprise', 50, 20, 25000000, 64);

-- There is no billing seed because there is no billing. ShareOut is free, and the
-- subscription tables were dropped in migration 0137 once the paywall removal
-- (#40, #44) left them with no readers. `plan_crew_limits` survives because it is
-- a spend ceiling, not a price: it caps what a crew run may cost you in model
-- calls, which matters on an instance nobody is charged for.
-- See migrations/SCHEMA.md § "12 AI usage metering".
