-- Workflow 1: atomic gig funding. Safe to re-run.
-- Core procedure: the caller owns a REPEATABLE READ transaction (the API does). It refuses weaker isolation, since a
-- procedure cannot change its own. The deduction fires trg_clients_escrow_audit in the same transaction.
CREATE OR REPLACE PROCEDURE fund_gig(p_client_id integer, p_freelancer_id integer, p_budget decimal(10,2), INOUT p_contract_id integer)
LANGUAGE plpgsql AS $$
DECLARE v_balance decimal(10,2); v_available boolean;
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('repeatable read','serializable') THEN
  RAISE EXCEPTION 'fund_gig must run in a REPEATABLE READ transaction (current: %). Use BEGIN ISOLATION LEVEL REPEATABLE READ, or call the 3-argument fund_gig.',current_setting('transaction_isolation') USING ERRCODE='25000';
 END IF;
 IF p_budget IS NULL OR p_budget<=0 THEN RAISE EXCEPTION 'Budget must be greater than zero.' USING ERRCODE='22023'; END IF;
 SELECT escrow_balance INTO v_balance FROM clients WHERE id=p_client_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Client not found.'; END IF;
 SELECT is_available INTO v_available FROM freelancers WHERE id=p_freelancer_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Freelancer not found.'; END IF;
 IF NOT v_available THEN RAISE EXCEPTION 'Worker unavailable. Choose an available freelancer.'; END IF;
 IF v_balance<p_budget THEN RAISE EXCEPTION 'Insufficient balance. Available balance is % INR.',v_balance; END IF;
 UPDATE clients SET escrow_balance=escrow_balance-p_budget WHERE id=p_client_id;
 INSERT INTO contracts(client_id,freelancer_id,budget,status,created_at)
 VALUES(p_client_id,p_freelancer_id,p_budget,'FUNDED',CURRENT_TIMESTAMP) RETURNING id INTO p_contract_id;
END $$;

-- Standalone entry point for psql: own REPEATABLE READ transaction, COMMIT on success, ROLLBACK and re-raise on error.
-- Retries serialization_failure (40001) up to three times. Call it outside an explicit transaction block.
CREATE OR REPLACE PROCEDURE fund_gig(p_client_id integer, p_freelancer_id integer, p_budget decimal(10,2))
LANGUAGE plpgsql AS $$
DECLARE v_id integer; v_attempt integer:=0; v_ok boolean; v_state text; v_message text;
BEGIN
 LOOP
  v_attempt:=v_attempt+1; v_ok:=false;
  COMMIT; -- Ends the transaction that CALL started, so the next one can choose its isolation level.
  SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
  BEGIN -- The EXCEPTION clause rolls back this block's changes; COMMIT/ROLLBACK are not allowed inside it.
   CALL fund_gig(p_client_id,p_freelancer_id,p_budget,v_id);
   v_ok:=true;
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_message=MESSAGE_TEXT;
  END;
  IF v_ok THEN
   COMMIT;
   RAISE NOTICE 'Gig funded successfully. Contract ID: %',v_id;
   RETURN;
  END IF;
  ROLLBACK;
  IF v_state='40001' AND v_attempt<3 THEN CONTINUE; END IF;
  RAISE EXCEPTION '%',v_message USING ERRCODE=v_state;
 END LOOP;
END $$;
