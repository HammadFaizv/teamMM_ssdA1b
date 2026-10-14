CREATE OR REPLACE FUNCTION fn_audit_escrow_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.escrow_balance IS DISTINCT FROM NEW.escrow_balance THEN

        INSERT INTO wallet_audit_logs (
            client_id,
            amount_changed,
            action_type,
            balance_after,
            timestamp
        )
        VALUES (
            NEW.id,
            NEW.escrow_balance - OLD.escrow_balance,

            CASE 
                WHEN NEW.escrow_balance > OLD.escrow_balance
                    THEN 'ESCROW_HOLD'::action_type

                WHEN NEW.escrow_balance < OLD.escrow_balance
                    THEN 'ESCROW_RELEASE'::action_type
            END,

            NEW.escrow_balance,
            CURRENT_TIMESTAMP
        );

    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_clients_escrow_audit
ON clients;

CREATE TRIGGER trg_clients_escrow_audit
AFTER UPDATE OF escrow_balance
ON clients
FOR EACH ROW
EXECUTE FUNCTION fn_audit_escrow_balance();
