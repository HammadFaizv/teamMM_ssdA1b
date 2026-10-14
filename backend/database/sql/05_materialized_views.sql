-- Freelancer lifetime earnings: completed contract count and total earnings per freelancer. Safe to re-run.
CREATE MATERIALIZED VIEW IF NOT EXISTS freelancer_lifetime_earnings
AS
SELECT
    f.id AS freelancer_id,
    f.name AS freelancer_name,
    COUNT(c.id) FILTER (WHERE c.status = 'COMPLETED') AS lifetime_completed_contracts,
    COALESCE(SUM(c.budget) FILTER (WHERE c.status = 'COMPLETED'), 0.00) AS lifetime_total_earnings
FROM freelancers f
LEFT JOIN contracts c ON c.freelancer_id = f.id
GROUP BY f.id, f.name;

-- REFRESH ... CONCURRENTLY requires a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_freelancer_lifetime_earnings_pk
ON freelancer_lifetime_earnings (freelancer_id);

CREATE OR REPLACE FUNCTION refresh_freelancer_earnings()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY freelancer_lifetime_earnings;
END;
$$;
