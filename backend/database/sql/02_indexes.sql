-- GigTask indexes. Safe to re-run.

-- One IN_PROGRESS contract per freelancer (several FUNDED ones are allowed).
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_gig ON contracts (freelancer_id) WHERE status = 'IN_PROGRESS';

-- Foreign-key lookups; (freelancer_id, created_at) also serves freelancer_id alone.
CREATE INDEX IF NOT EXISTS idx_contracts_client_id ON contracts (client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_freelancer_id_created_at ON contracts (freelancer_id, created_at);

-- Workflow 2: completed revenue per freelancer and day, as an index-only scan.
CREATE INDEX IF NOT EXISTS idx_completed_revenue_cover
  ON contracts (freelancer_id, created_at) INCLUDE (budget) WHERE status = 'COMPLETED';

-- One client's audit history in date order (also the client_id foreign-key index).
CREATE INDEX IF NOT EXISTS idx_wallet_audit_logs_client_timestamp ON wallet_audit_logs (client_id, timestamp, id);

-- Replaced by the indexes above.
DROP INDEX IF EXISTS idx_completed_gig;
DROP INDEX IF EXISTS idx_contracts_freelancer_id;
DROP INDEX IF EXISTS idx_wallet_audit_logs_client_id;
DROP INDEX IF EXISTS idx_api_audit_client_date;
