// GigTask - Workflow 4: Multi-Faceted Review Analytics
//
// Requirement:
// Use $facet to produce:
//   1. Rating distribution
//   2. Most frequent skill-tags via $unwind
//   3. Overall average worker rating
//
// Run with mongosh after loading GigReviews.

// Uses the database selected in the mongosh connection URL.

// -----------------------------------------------------------------------------
// One $facet stage executes three analytical branches over GigReviews.
// -----------------------------------------------------------------------------
const reviewAnalytics = db.GigReviews.aggregate([
  {
    $facet: {
      // 1) Rating distribution from 1 to 5 stars.
      rating_distribution: [
        {
          $group: {
            _id: "$rating",
            review_count: { $sum: 1 }
          }
        },
        {
          $sort: { _id: 1 }
        },
        {
          $project: {
            _id: 0,
            rating: "$_id",
            review_count: 1
          }
        }
      ],

      // 2) Most frequent skill tags.
      // $unwind converts the skill_tags array into individual values.
      top_skill_tags: [
        {
          $unwind: "$skill_tags"
        },
        {
          $group: {
            _id: "$skill_tags",
            tag_count: { $sum: 1 }
          }
        },
        {
          $sort: {
            tag_count: -1,
            _id: 1
          }
        },
        {
          $limit: 10
        },
        {
          $project: {
            _id: 0,
            skill_tag: "$_id",
            tag_count: 1
          }
        }
      ],

      // 3) Overall worker rating.
      overall_average_rating: [
        {
          $group: {
            _id: null,
            average_rating: { $avg: "$rating" },
            total_reviews: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            average_rating: { $round: ["$average_rating", 2] },
            total_reviews: 1
          }
        }
      ]
    }
  }
]);

print("GigTask multi-faceted review analytics:");
reviewAnalytics.forEach(doc => printjson(doc));

// -----------------------------------------------------------------------------
// Performance proof.
//
// Run the same aggregate with:
//
// db.GigReviews.explain("executionStats").aggregate([...same pipeline...])
//
// Save the raw JSON output in:
// performance/mongo_execution_stats.json
//
// Note:
// Workflow 4 itself is an aggregation over the review collection. The indexes
// created in 01_collections_and_indexes.js are supporting indexes for common
// access patterns; MongoDB may still choose a collection scan for an aggregation
// that intentionally reads the entire GigReviews collection. Do not falsely
// claim an IXSCAN if explain("executionStats") reports COLLSCAN.
// -----------------------------------------------------------------------------
