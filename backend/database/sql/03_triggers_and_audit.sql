-- GigTask audit logging. Safe to re-run.

-- AFTER UPDATE OF escrow_balance on clients: record every balance change in wallet_audit_logs.
CREATE OR REPLACE FUNCTION fn_audit_escrow_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.escrow_balance IS DISTINCT FROM NEW.escrow_balance THEN
        INSERT INTO wallet_audit_logs (client_id, amount_changed, action_type, balance_after, timestamp)
        VALUES (
            NEW.id,
            NEW.escrow_balance - OLD.escrow_balance,
            CASE WHEN NEW.escrow_balance < OLD.escrow_balance
                 THEN 'ESCROW_HOLD'::action_type
                 ELSE 'ESCROW_RELEASE'::action_type
            END,
            NEW.escrow_balance,
            CURRENT_TIMESTAMP
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_escrow_audit ON clients;
CREATE TRIGGER trg_clients_escrow_audit
AFTER UPDATE OF escrow_balance ON clients
FOR EACH ROW
EXECUTE FUNCTION fn_audit_escrow_balance();

-- The audit record is immutable: rows can be inserted but never changed or deleted.
CREATE OR REPLACE FUNCTION fn_protect_audit_logs()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'wallet_audit_logs is append-only.' USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_audit_logs_immutable ON wallet_audit_logs;
CREATE TRIGGER trg_wallet_audit_logs_immutable
BEFORE UPDATE OR DELETE ON wallet_audit_logs
FOR EACH ROW
EXECUTE FUNCTION fn_protect_audit_logs();

-- Names used by earlier revisions of this trigger.
DROP TRIGGER IF EXISTS trg_api_audit_append_only ON wallet_audit_logs;
DROP FUNCTION IF EXISTS api_protect_audit();
