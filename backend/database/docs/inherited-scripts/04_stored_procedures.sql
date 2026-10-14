CREATE OR REPLACE PROCEDURE fund_gig(
    p_client_id INTEGER,
    p_freelancer_id INTEGER,
    p_budget DECIMAL(10,2)
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_contract_id INTEGER;
BEGIN

    IF p_budget <= 0 THEN
        RAISE EXCEPTION
            'Gig budget must be greater than zero. Received: %',
            p_budget;
    END IF;

    PERFORM 1
    FROM clients
    WHERE id = p_client_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Client with ID % does not exist',
            p_client_id;
    END IF;

    PERFORM 1
    FROM freelancers
    WHERE id = p_freelancer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Freelancer with ID % does not exist',
            p_freelancer_id;
    END IF;

    UPDATE clients
    SET escrow_balance = escrow_balance + p_budget
    WHERE id = p_client_id;

    INSERT INTO contracts (
        client_id,
        freelancer_id,
        budget,
        status,
        created_at
    )
    VALUES (
        p_client_id,
        p_freelancer_id,
        p_budget,
        'FUNDED'::status,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_contract_id;

    RAISE NOTICE
        'Gig funded successfully. Contract ID: %, Client: %, Freelancer: %, Budget: %',
        v_contract_id,
        p_client_id,
        p_freelancer_id,
        p_budget;

END;
$$;
