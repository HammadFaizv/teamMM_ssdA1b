// GigTask Workflow 3: nearest available workers to a job site.
// Run with: mongosh gigtask_db 02_workflow3_geonear.js (select the database in the connection).
//
// $geoNear must be the first stage. It returns each worker's current ping (is_current) that is available, no older
// than the two-hour TTL window (the TTL monitor can lag a minute) and within 5 km, nearest first.
// The API runs the same pipeline (backend/src/mongo-pipelines.js), then confirms availability in PostgreSQL.
const jobLongitude = 78.35008;
const jobLatitude = 17.45452;
const radiusMeters = 5000;
const resultLimit = 5; // the first result is the closest available worker

const nearestWorkers = db.WorkerLocations.aggregate([
  {
    $geoNear: {
      near: { type: "Point", coordinates: [jobLongitude, jobLatitude] },
      key: "location",
      distanceField: "distance_meters",
      maxDistance: radiusMeters,
      spherical: true,
      query: {
        is_current: true,
        is_available: true,
        created_at: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
      }
    }
  },
  { $limit: resultLimit },
  { $project: { _id: 0, freelancer_id: 1, distance_meters: { $round: ["$distance_meters", 1] }, location: 1, created_at: 1 } }
]);

print("Nearest available workers within 5 km (closest first):");
nearestWorkers.forEach(doc => printjson(doc));

// To capture the plan:
// db.WorkerLocations.explain("executionStats").aggregate([...same pipeline...])
