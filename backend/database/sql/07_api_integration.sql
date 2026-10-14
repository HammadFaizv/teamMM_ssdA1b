-- Objects that exist only for the web API. Everything the assignment asks for is in 01 to 06. Safe to re-run.

-- Idempotency records: a retried funding request returns the stored response instead of charging again.
CREATE TABLE IF NOT EXISTS api_funding_requests (
 request_key varchar(100) PRIMARY KEY,
 actor_id integer NOT NULL REFERENCES clients(id), payload jsonb NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
-- The API deletes records older than a day, so this table stays small.
CREATE INDEX IF NOT EXISTS idx_api_funding_requests_created ON api_funding_requests(created_at);

CREATE TABLE IF NOT EXISTS api_metadata(key text PRIMARY KEY,value timestamptz NOT NULL);

-- Contracts only move forward: FUNDED -> IN_PROGRESS -> COMPLETED.
CREATE OR REPLACE FUNCTION api_forward_contract_status() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NOT ((OLD.status='FUNDED' AND NEW.status='IN_PROGRESS') OR (OLD.status='IN_PROGRESS' AND NEW.status='COMPLETED')) THEN
  RAISE EXCEPTION 'Only forward status transitions are allowed.';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_api_forward_contract_status ON contracts;
CREATE TRIGGER trg_api_forward_contract_status BEFORE UPDATE OF status ON contracts
FOR EACH ROW EXECUTE FUNCTION api_forward_contract_status();

-- Refresh button: one refresh at a time, and remember when it last succeeded for the "last refreshed" label.
CREATE OR REPLACE FUNCTION api_refresh_earnings() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(41725,1);
 PERFORM refresh_freelancer_earnings();
 INSERT INTO api_metadata(key,value) VALUES('earnings_refreshed',clock_timestamp())
 ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value;
END $$;
