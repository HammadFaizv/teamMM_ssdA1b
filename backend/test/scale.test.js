import test from 'node:test';
import assert from 'node:assert/strict';
import {personName,SCALE} from '../scripts/seed-scale.js';
test('assignment scale targets and realistic unique names without digits',()=>{
 assert.ok(SCALE.contracts>=50000&&SCALE.audits>=100000&&SCALE.pings>=500000);
 const names=Array.from({length:SCALE.clients+SCALE.freelancers},(_,i)=>personName(i));
 assert.equal(new Set(names).size,names.length);assert.ok(names.every(n=>!/[0-9]/.test(n)&&n.split(' ').length>=2));
});
