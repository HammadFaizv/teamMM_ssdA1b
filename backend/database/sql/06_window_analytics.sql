-- Workflow 2: 7-day moving average of completed-contract revenue per freelancer, ranked with DENSE_RANK().
-- Revenue is the contract budget, attributed to the contract's creation day (there is no completion date).
-- Daily revenue per freelancer.
WITH freelancer_daily_revenue AS (
    SELECT
        freelancer_id,
        DATE_TRUNC('day', created_at) AS earning_day,
        SUM(budget) AS total_amount
    FROM contracts
    WHERE status = 'COMPLETED'
    GROUP BY freelancer_id, DATE_TRUNC('day', created_at)
), 
-- 7-day moving average over the recorded revenue days.
seven_day_freelancer_avg AS (
    SELECT
        freelancer_id,
        earning_day,
        total_amount,
        AVG(total_amount) OVER (
            PARTITION BY freelancer_id
            ORDER BY earning_day
            RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW
        ) AS moving_avg_revenue
    FROM freelancer_daily_revenue
),
-- Each freelancer's latest 7-day average.
latest_freelancer_avg AS (
   SELECT DISTINCT ON (freelancer_id)
    freelancer_id,
    earning_day,
    moving_avg_revenue
FROM seven_day_freelancer_avg
ORDER BY freelancer_id, earning_day DESC
)
SELECT
    freelancer_id,
    earning_day,
    moving_avg_revenue,
    DENSE_RANK() OVER (ORDER BY moving_avg_revenue DESC) AS revenue_rank
FROM latest_freelancer_avg
ORDER BY revenue_rank, freelancer_id;
