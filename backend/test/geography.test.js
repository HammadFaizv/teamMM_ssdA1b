import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_CITY,seedPosition} from '../src/geography.js';
function distance(a,b){const rad=d=>d*Math.PI/180;const x=Math.sin(rad(a.latitude-b.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(a.longitude-b.longitude)/2)**2;return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
test('Hyderabad seeds stay within 10 km and the demo origin has available workers within 5 km',()=>{assert.equal(BASE_CITY.name,'Hyderabad');const workers=Array.from({length:48},(_,i)=>({id:i+1,...seedPosition(i+1),available:i%3!==0}));for(const w of workers)assert.ok(distance(w,BASE_CITY)<=10);assert.ok(workers.filter(w=>w.available&&distance(w,BASE_CITY)<=5).length>=5);});
