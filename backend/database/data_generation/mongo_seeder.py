"""Seeds MongoDB (Portfolios, GigReviews, WorkerLocations) for GigTask.

Run after mongo/01_collections_and_indexes.js. Documents refer to PostgreSQL freelancers by their
integer id (1..--freelancers), so run postgres_seeder.py with the same --freelancers value.

Repeatable: the three collections are emptied first, so running it twice gives the same counts.
WorkerLocations: --locations pings spread evenly over the workers; each worker's last ping is the
only one marked is_current (the unique partial index requires at most one).
Pings are timestamped within the last hour, so they stay inside the two-hour TTL window for a while.
"""
import argparse
import random
import os
from datetime import datetime, timedelta, timezone

from faker import Faker
from pymongo import MongoClient

fake = Faker()

# MongoDB connection

def get_database():
    mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
    mongo_db = os.getenv("MONGO_DB", "gigtask_db")
    client = MongoClient(mongo_uri)
    return client[mongo_db]

# Geographic regions
CITIES = [
    {"name": "Chennai", "lat": 13.0827, "lon": 80.2707},
    {"name": "Bengaluru", "lat": 12.9716, "lon": 77.5946},
    {"name": "Hyderabad", "lat": 17.3850, "lon": 78.4867},
    {"name": "Mumbai", "lat": 19.0760, "lon": 72.8777},
    {"name": "Delhi", "lat": 28.6139, "lon": 77.2090},
]

SKILLS = [
    "Plumbing", "Electrical", "Delivery", "Carpentry", "Cleaning",
    "Painting", "Repair", "Moving", "Assembly", "Maintenance",
]

CERTIFICATIONS = [
    "Safety Certified", "Licensed Technician", "First Aid",
    "Equipment Certified", "Professional Training",
]


# Portfolio documents: one per freelancer

def generate_portfolios(freelancer_count):

    documents = []

    for freelancer_id in range(1, freelancer_count + 1):

        documents.append({
            "freelancer_id": freelancer_id,

            "bio": fake.paragraph(),

            "skills": random.sample(SKILLS, k=random.randint(2, 5)),

            "certifications": [
                {
                    "name": name,
                    "issuer": fake.company(),
                    "year": random.randint(2018, 2026)
                }
                for name in random.sample(CERTIFICATIONS, k=random.randint(0, 3))
            ],

            "projects": [
                {
                    "title": fake.sentence(nb_words=4),
                    "description": fake.paragraph(nb_sentences=2),
                    "completed_at": fake.date_time_between(
                        start_date="-2y",
                        end_date="now",
                        tzinfo=timezone.utc
                    )
                }
                for _ in range(random.randint(0, 3))
            ],

            "created_at": fake.date_time_between(
                start_date="-2y",
                end_date="now",
                tzinfo=timezone.utc
            )
        })

    return documents


# Review documents

def generate_reviews(count, freelancer_count):

    documents = []

    for _ in range(count):

        documents.append({
            "freelancer_id": random.randint(1, freelancer_count),

            "rating": random.randint(1, 5),

            "skill_tags": random.sample(SKILLS, k=random.randint(1, 3)),

            "review_text": fake.sentence(),

            "created_at": fake.date_time_between(
                start_date="-1y",
                end_date="now",
                tzinfo=timezone.utc
            )
        })

    return documents


# Worker location pings

def generate_location_pings(start, stop, freelancer_count, total):

    """Pings start..stop-1 of `total`. Ping n belongs to worker n % freelancer_count + 1;
    the final freelancer_count pings are every worker's latest, and are marked is_current."""

    now = datetime.now(timezone.utc)
    rounds = max(1, total // freelancer_count)
    documents = []

    for n in range(start, stop):

        freelancer_id = n % freelancer_count + 1
        is_current = n >= total - freelancer_count
        city = CITIES[freelancer_id % len(CITIES)]

        # Older rounds are older in time: the first round is just under an hour old.
        age_seconds = (
            random.randint(0, 300)
            if is_current
            else int((rounds - 1 - n // freelancer_count) * 3000 / rounds) + random.randint(301, 600)
        )

        documents.append({
            "freelancer_id": freelancer_id,

            "location": {
                "type": "Point",

                "coordinates": [
                    city["lon"] + random.uniform(-0.15, 0.15),
                    city["lat"] + random.uniform(-0.15, 0.15)
                ]
            },

            "is_available": random.choice([True, True, True, False]),

            "is_current": is_current,

            "created_at": now - timedelta(seconds=age_seconds)
        })

    return documents


# Main seeding function

def seed_database(freelancer_count, review_count, location_count):

    if location_count < freelancer_count:
        raise SystemExit("--locations must be at least --freelancers (every worker needs one current ping).")

    db = get_database()

    for name in ("Portfolios", "GigReviews", "WorkerLocations"):
        db[name].delete_many({})

    print("Generating portfolios...")
    db["Portfolios"].insert_many(generate_portfolios(freelancer_count))
    print(f"Inserted {freelancer_count:,} portfolios.")

    print("Generating reviews...")
    batch_size = 5_000
    for start in range(0, review_count, batch_size):
        db["GigReviews"].insert_many(
            generate_reviews(min(batch_size, review_count - start), freelancer_count)
        )
    print(f"Inserted {review_count:,} reviews.")

    print("Generating worker locations...")
    for start in range(0, location_count, batch_size):
        stop = min(start + batch_size, location_count)
        db["WorkerLocations"].insert_many(
            generate_location_pings(start, stop, freelancer_count, location_count),
            ordered=False
        )
        print(f"Inserted {stop:,}/{location_count:,}")

    print("\nMongoDB seeding completed!")


# Command-line arguments

if __name__ == "__main__":

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--freelancers",
        type=int,
        default=5000,
        help="Number of PostgreSQL freelancers (ids 1..N); match postgres_seeder.py"
    )

    parser.add_argument(
        "--reviews",
        type=int,
        default=100000
    )

    parser.add_argument(
        "--locations",
        type=int,
        default=600000
    )

    args = parser.parse_args()

    seed_database(
        args.freelancers,
        args.reviews,
        args.locations
    )
