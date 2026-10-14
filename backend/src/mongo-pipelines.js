// Workflow 4 ($facet), as in mongo/03_workflow4_facet.js, optionally scoped to one freelancer.
export function reviewFacet(filter={}){return [
 ...(Object.keys(filter).length?[{$match:filter}]:[]),
 {$facet:{
  rating_distribution:[{$group:{_id:'$rating',review_count:{$sum:1}}},{$sort:{_id:1}},{$project:{_id:0,rating:'$_id',review_count:1}}],
  top_skill_tags:[{$unwind:'$skill_tags'},{$group:{_id:'$skill_tags',tag_count:{$sum:1}}},{$sort:{tag_count:-1,_id:1}},{$limit:10},{$project:{_id:0,skill_tag:'$_id',tag_count:1}}],
  overall_average_rating:[{$group:{_id:null,average_rating:{$avg:'$rating'},total_reviews:{$sum:1}}},{$project:{_id:0,average_rating:{$round:['$average_rating',2]},total_reviews:1}}]
 }}
];}
// Workflow 3 ($geoNear), as in mongo/02_workflow3_geonear.js. At most one current ping per worker, so the result is bounded.
export function nearbyPipeline(lat,lng,now=new Date()){
 const cutoff=new Date(now.getTime()-7200000);
 return [
  {$geoNear:{near:{type:'Point',coordinates:[lng,lat]},key:'location',distanceField:'distance_meters',maxDistance:5000,spherical:true,query:{is_current:true,is_available:true,created_at:{$gte:cutoff}}}}
 ];
}
export const freelancerFilter=id=>({freelancer_id:id});
