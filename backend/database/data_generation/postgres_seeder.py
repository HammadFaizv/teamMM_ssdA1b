import argparse
import random
from datetime import datetime
from decimal import Decimal
import os

from faker import Faker
import psycopg2
from psycopg2.extras import execute_values


fake = Faker()



# Configuration


DEFAULT_CLIENTS = 10_000
DEFAULT_FREELANCERS = 5_000
DEFAULT_CONTRACTS = 60_000
DEFAULT_AUDITS = 150_000

DEFAULT_SEED = 42


# Database connection


def get_connection():
    if os.getenv("DATABASE_URL"):
        return psycopg2.connect(os.environ["DATABASE_URL"])
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST", "localhost"),
        port=os.getenv("POSTGRES_PORT", "5432"),
        database=os.getenv("POSTGRES_DB", "gigtask_db"),
        user=os.getenv("POSTGRES_USER", "postgres"),
        password=os.getenv("POSTGRES_PASSWORD")
    )



# Generate clients


def generate_clients(count):
    clients = []

    for client_id in range(1, count + 1):
        clients.append((
            client_id,
            fake.name(),
            Decimal(str(round(random.uniform(500, 50000), 2))),
            fake.date_time_between(
                start_date="-2y",
                end_date="now"
            )
        ))

    return clients



# Generate freelancers


def generate_freelancers(count):

    freelancers = []

    cities = [
        (13.0827, 80.2707),   # Chennai
        (12.9716, 77.5946),   # Bengaluru
        (17.3850, 78.4867),   # Hyderabad
        (19.0760, 72.8777),   # Mumbai
        (28.6139, 77.2090),   # Delhi
    ]

    for freelancer_id in range(1, count + 1):

        base_lat, base_lon = random.choice(cities)

        latitude = round(
            base_lat + random.uniform(-0.15, 0.15),
            4
        )

        longitude = round(
            base_lon + random.uniform(-0.15, 0.15),
            4
        )

        freelancers.append((
            freelancer_id,
            fake.name(),
            Decimal(str(latitude)),
            Decimal(str(longitude)),
            random.choice([True, True, True, False])
        ))

    return freelancers


# Generate contracts


def generate_contracts(
    count,
    clients,
    freelancers
):

    contracts = []

    client_ids = [client[0] for client in clients]
    freelancer_ids = [freelancer[0] for freelancer in freelancers]

    active_freelancers = set()

    for contract_id in range(1, count + 1):

        client_id = random.choice(client_ids)
        freelancer_id = random.choice(freelancer_ids)

        possible_statuses = [
            "FUNDED",
            "COMPLETED"
        ]

        if freelancer_id not in active_freelancers:
            possible_statuses.append("IN_PROGRESS")

        if len(possible_statuses) == 3:
            status = random.choices(
                possible_statuses,
                weights=[20, 60, 20],
                k=1
            )[0]
        else:
            status = random.choices(
                possible_statuses,
                weights=[25, 75],
                k=1
            )[0]

        if status == "IN_PROGRESS":
            active_freelancers.add(freelancer_id)

        contracts.append((
            contract_id,
            client_id,
            freelancer_id,
            Decimal(str(round(
                random.uniform(100, 10000),
                2
            ))),
            status,
            fake.date_time_between(
                start_date="-2y",
                end_date="now"
            )
        ))

    return contracts


# Insert clients


def insert_clients(cur, clients):

    print("Inserting clients...")

    execute_values(
        cur,
        """
        INSERT INTO clients
        (
            id,
            name,
            escrow_balance,
            created_at
        )
        VALUES %s
        """,
        clients,
        page_size=5000
    )


# Insert freelancers


def insert_freelancers(cur, freelancers):

    print("Inserting freelancers...")

    execute_values(
        cur,
        """
        INSERT INTO freelancers
        (
            id,
            name,
            latitude,
            longitude,
            is_available
        )
        VALUES %s
        """,
        freelancers,
        page_size=5000
    )


# Insert contracts


def insert_contracts(cur, contracts):

    print("Inserting contracts...")

    execute_values(
        cur,
        """
        INSERT INTO contracts
        (
            id,
            client_id,
            freelancer_id,
            budget,
            status,
            created_at
        )
        VALUES %s
        """,
        contracts,
        page_size=5000
    )



# Generate escrow activity


def generate_escrow_activity(
    cur,
    count,
    clients
):

    print("Generating escrow activity through trigger...")

    if count <= 0:
        return 0

    balances = {
        client[0]: client[2]
        for client in clients
    }

    client_ids = list(balances.keys())

    generated = 0

    for i in range(count):

        client_id = random.choice(client_ids)
        current_balance = balances[client_id]

       

        should_hold = (
            current_balance > Decimal("100.00")
            and random.random() < 0.60
        )

        if should_hold:

            max_amount = min(
                current_balance,
                Decimal("5000.00")
            )

            if max_amount < Decimal("10.00"):
                continue

            amount = Decimal(
                str(round(
                    random.uniform(
                        10,
                        float(max_amount)
                    ),
                    2
                ))
            )

            new_balance = current_balance - amount

        else:

            amount = Decimal(
                str(round(
                    random.uniform(10, 500),
                    2
                ))
            )

            new_balance = current_balance + amount

     
        cur.execute(
            """
            UPDATE clients
            SET escrow_balance = %s
            WHERE id = %s
            """,
            (
                new_balance,
                client_id
            )
        )

        if cur.rowcount != 1:
            raise RuntimeError(
                f"Failed to update client {client_id}"
            )

        balances[client_id] = new_balance
        generated += 1

    return generated


# Reset sequences


def reset_sequences(cur):
    print("Synchronizing PostgreSQL sequences...")

    tables = ["clients", "freelancers", "contracts", "wallet_audit_logs"]

    for table in tables:
        cur.execute(
            f"""
            SELECT setval(
                pg_get_serial_sequence('{table}', 'id'),
                COALESCE((SELECT MAX(id) FROM {table}), 1),
                EXISTS (SELECT 1 FROM {table})
            );
            """
        )


# Validation


def validate_seed(cur):

    print("\nValidating seeded data...")

    cur.execute("SELECT COUNT(*) FROM clients")
    client_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM freelancers")
    freelancer_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM contracts")
    contract_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(*) FROM wallet_audit_logs")
    audit_count = cur.fetchone()[0]

    cur.execute(
        """
        SELECT
            COUNT(*) FILTER (
                WHERE action_type = 'ESCROW_HOLD'
            ),
            COUNT(*) FILTER (
                WHERE action_type = 'ESCROW_RELEASE'
            )
        FROM wallet_audit_logs
        """
    )

    hold_count, release_count = cur.fetchone()

    print("------------------------------------------")
    print(f"Clients:             {client_count:,}")
    print(f"Freelancers:         {freelancer_count:,}")
    print(f"Contracts:           {contract_count:,}")
    print(f"Wallet audit logs:   {audit_count:,}")
    print(f"  ESCROW_HOLD:       {hold_count:,}")
    print(f"  ESCROW_RELEASE:    {release_count:,}")
    print("------------------------------------------")


# Seed database


def seed_database(
    clients_count,
    freelancers_count,
    contracts_count,
    audits_count,
    seed
):

    random.seed(seed)
    Faker.seed(seed)

    conn = None
    cur = None

    try:

        conn = get_connection()
        cur = conn.cursor()

        print("==========================================")
        print("GigTask PostgreSQL Data Seeder")
        print("==========================================")
        print(f"Clients:       {clients_count:,}")
        print(f"Freelancers:   {freelancers_count:,}")
        print(f"Contracts:     {contracts_count:,}")
        print(f"Audit logs:    {audits_count:,}")
        print(f"Random seed:   {seed}")
        print("==========================================")

      
        # Generate base data
      

        print("\nGenerating clients...")
        clients = generate_clients(clients_count)

        print("Generating freelancers...")
        freelancers = generate_freelancers(freelancers_count)

        print("Generating contracts...")
        contracts = generate_contracts(
            contracts_count,
            clients,
            freelancers
        )

        # Insert base data
     

        insert_clients(cur, clients)

        insert_freelancers(cur, freelancers)

        insert_contracts(cur, contracts)



        audit_rows_generated = generate_escrow_activity(
            cur,
            audits_count,
            clients
        )

        print(
            f"Trigger-generated audit events: "
            f"{audit_rows_generated:,}"
        )

    
        # Synchronize sequences
   

        reset_sequences(cur)

     
        # Validate before commit
      

        validate_seed(cur)

   
        # Commit
      

        conn.commit()

        print("\n==========================================")
        print("PostgreSQL seeding completed successfully!")
        print("==========================================")
        print(f"Clients inserted:       {len(clients):,}")
        print(f"Freelancers inserted:   {len(freelancers):,}")
        print(f"Contracts inserted:     {len(contracts):,}")
        print(
            f"Audit events generated: "
            f"{audit_rows_generated:,}"
        )
        print("==========================================")

    except Exception as e:

        if conn:
            conn.rollback()

        print("\nERROR:", e)
        raise

    finally:

        if cur:
            cur.close()

        if conn:
            conn.close()



# Command-line arguments


if __name__ == "__main__":

    parser = argparse.ArgumentParser(
        description="GigTask PostgreSQL data generator"
    )

    parser.add_argument(
        "--clients",
        type=int,
        default=DEFAULT_CLIENTS
    )

    parser.add_argument(
        "--freelancers",
        type=int,
        default=DEFAULT_FREELANCERS
    )

    parser.add_argument(
        "--contracts",
        type=int,
        default=DEFAULT_CONTRACTS
    )

    parser.add_argument(
        "--audits",
        type=int,
        default=DEFAULT_AUDITS
    )

    parser.add_argument(
        "--seed",
        type=int,
        default=DEFAULT_SEED
    )

    args = parser.parse_args()

    seed_database(
        clients_count=args.clients,
        freelancers_count=args.freelancers,
        contracts_count=args.contracts,
        audits_count=args.audits,
        seed=args.seed
    )

