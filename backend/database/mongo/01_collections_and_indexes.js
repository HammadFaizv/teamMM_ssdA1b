// GigTask (Project 5) MongoDB collections, validators and indexes.
//
//   Portfolios       flexible freelancer skills and certifications
//   GigReviews       ratings, skill tags, timestamps
//   WorkerLocations  real-time worker pings as GeoJSON Points
//
// Run with: mongosh gigtask_db 01_collections_and_indexes.js (select the database in the connection, safe to re-run).
// freelancer_id is the integer id of the freelancer in PostgreSQL, so documents join to SQL rows without conversion.

function ensureCollection(name, options) {
  if (db.getCollectionNames().includes(name)) db.runCommand({ collMod: name, ...options });
  else db.createCollection(name, options);
}

// -----------------------------------------------------------------------------
// 1. Portfolios
// -----------------------------------------------------------------------------
ensureCollection("Portfolios", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["freelancer_id", "skills", "certifications"],
      properties: {
        freelancer_id: { bsonType: ["int", "long"], description: "freelancers.id in PostgreSQL" },
        name: { bsonType: "string" },
        skills: { bsonType: "array", items: { bsonType: "string" } },
        certifications: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["name"],
            properties: {
              name: { bsonType: "string" },
              issuer: { bsonType: "string" },
              year: { bsonType: ["int", "long"] }
            }
          }
        },
        projects: {
          bsonType: "array",
          items: {
            bsonType: "object",
            properties: {
              title: { bsonType: "string" },
              description: { bsonType: "string" },
              completed_at: { bsonType: "date" }
            }
          }
        }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

// One portfolio per freelancer.
db.Portfolios.createIndex({ freelancer_id: 1 }, { unique: true, name: "uq_portfolios_freelancer_id" });
db.Portfolios.createIndex({ skills: 1 }, { name: "idx_portfolios_skills" });

// -----------------------------------------------------------------------------
// 2. GigReviews
// -----------------------------------------------------------------------------
ensureCollection("GigReviews", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["freelancer_id", "rating", "skill_tags", "created_at"],
      properties: {
        freelancer_id: { bsonType: ["int", "long"] },
        contract_id: { bsonType: ["int", "long"], description: "contracts.id in PostgreSQL" },
        rating: { bsonType: ["int", "long", "double"], minimum: 1, maximum: 5 },
        review_text: { bsonType: "string" },
        skill_tags: { bsonType: "array", items: { bsonType: "string" } },
        created_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

// One freelancer's reviews, newest first.
db.GigReviews.createIndex({ freelancer_id: 1, created_at: -1 }, { name: "idx_gigrevs_freelancer_created" });
db.GigReviews.createIndex({ rating: 1 }, { name: "idx_gigrevs_rating" });

// -----------------------------------------------------------------------------
// 3. WorkerLocations
//
// Every ping is kept as history until the TTL removes it. Exactly one ping per worker is marked
// is_current: the worker's latest position, which $geoNear searches. A new ping clears the old flag first.
// -----------------------------------------------------------------------------
ensureCollection("WorkerLocations", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["freelancer_id", "is_available", "location", "created_at"],
      properties: {
        freelancer_id: { bsonType: ["int", "long"] },
        is_available: { bsonType: "bool" },
        is_current: { bsonType: "bool" },
        location: {
          bsonType: "object",
          required: ["type", "coordinates"],
          properties: {
            type: { enum: ["Point"] },
            coordinates: {
              bsonType: "array",
              minItems: 2,
              maxItems: 2,
              items: { bsonType: ["double", "int", "long"] }
            }
          }
        },
        created_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

// Required: 2dsphere index on the GeoJSON location.
db.WorkerLocations.createIndex({ location: "2dsphere" }, { name: "idx_workerlocations_2dsphere" });

// Required: documents expire two hours (7200 seconds) after created_at.
db.WorkerLocations.createIndex({ created_at: 1 }, { expireAfterSeconds: 7200, name: "idx_workerlocations_ttl_2h" });

// Supporting: $geoNear over current pings only, so it never reads the pings' history.
db.WorkerLocations.createIndex(
  { location: "2dsphere" },
  { name: "idx_current_worker_geo", partialFilterExpression: { is_current: true } }
);

// Supporting: at most one current ping per worker, enforced by the database (the Mongo counterpart of idx_active_gig).
db.WorkerLocations.createIndex(
  { freelancer_id: 1 },
  { unique: true, name: "uq_workerlocations_current", partialFilterExpression: { is_current: true } }
);

print("GigTask MongoDB collections and indexes are ready.");
