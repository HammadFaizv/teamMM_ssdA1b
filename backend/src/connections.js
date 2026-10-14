import pg from 'pg';
import {MongoClient} from 'mongodb';
pg.types.setTypeParser(1114,value=>new Date(value.replace(' ','T')+'Z'));
export function createConnections(config){
 const pool=new pg.Pool(config.postgres);
 pool.on('error',()=>console.error('An idle PostgreSQL connection failed. Check database availability.'));
 // MongoClient connects lazily; SQL screens can work while MongoDB is unavailable.
 const mongo=new MongoClient(config.mongoUri,{serverSelectionTimeoutMS:8000,connectTimeoutMS:8000});
 return {pool,mongo: mongo.db(config.mongoDb),close:()=>Promise.allSettled([pool.end(),mongo.close()])};
}
