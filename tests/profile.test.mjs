import test from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, validateProfile } from '../src/profile.mjs';
import { probe } from '../src/probes.mjs';
import { configuration } from '../src/monitor.mjs';
import { initialState, observe, publicStatus } from '../src/status-state.mjs';
const profile={id:'sample',components:[{id:'worker',name:'Worker'},{id:'queue',name:'Queue'}],outageComponents:['worker'],targetVariables:{worker:'STATUS_WORKER_URL'},probe:async()=>({worker:'operational',queue:'unknown'})};
test('loads a trusted project profile and rejects incomplete or ambiguous contracts',async()=>{
 assert.equal((await loadProfile(new URL('./fixtures/profile.mjs',import.meta.url).pathname)).id,'example');
 await assert.rejects(loadProfile('relative.mjs'),/Absolute/);
 assert.throws(()=>validateProfile({...profile,components:[profile.components[0],profile.components[0]]}),/component/);
 assert.throws(()=>validateProfile({...profile,outageComponents:[]}),/outage/);
 assert.throws(()=>validateProfile({...profile,outageComponents:['foreign']}),/outage/);
 assert.throws(()=>validateProfile({...profile,components:[{...profile.components[0],secret:'hidden'}]}),/component/);
 assert.throws(()=>validateProfile({...profile,targetVariables:{worker:'SECRET'}}),/target/);
});
test('arbitrary component and target IDs need no built-in product or api/web assumption',async()=>{
 const env={STATUS_STATE_DIRECTORY:'/tmp/example-state',STATUS_BUNDLE_DIRECTORY:'/tmp/example-public',STATUS_HOST:'127.0.0.1',STATUS_PORT:'3456',STATUS_INTERVAL_MS:'5000',STATUS_TIMEOUT_MS:'100',STATUS_VALID_FOR_MS:'20000',STATUS_WORKER_URL:'https://example.com/health'};
 const config=configuration(env,profile);
 assert.deepEqual(await probe(config),{worker:'operational',queue:'unknown'});
 let state=initialState(profile);
 state=observe(state,{worker:'outage',queue:'operational'},1000,profile);
 state=observe(state,{worker:'outage',queue:'operational'},2000,profile);
 assert.equal(publicStatus(state,2000,20000,profile).overall.status,'outage');
 assert.throws(()=>configuration({...env,STATUS_WORKER_URL:'https://example.com/?secret=leak'},profile),/public probe/);
});
test('maintenance requires an explicit project capability and preserves established incidents',()=>{
 const maintained={...profile,maintenance:true};
 let state=observe(initialState(maintained),{worker:'outage',queue:'operational'},1000,maintained);
 state=observe(state,{worker:'outage',queue:'operational'},2000,maintained);
 const id=state.activeIncidents[0].id;
 state=observe(state,{worker:'maintenance',queue:'maintenance'},3000,maintained);
 assert.equal(state.activeIncidents[0].id,id);
 assert.equal(publicStatus(state,3000,20000,maintained).overall.title,'Плановые работы');
 assert.throws(()=>observe(initialState(profile),{worker:'maintenance',queue:'operational'},1000,profile),/observation/);
});
test('profiles can request only configured targets and cannot leak extra observations',async()=>{
 const custom={...profile,probe:async({request})=>request('foreign',{accept:'text/html',maximumBytes:10})};
 await assert.rejects(probe({profile:custom,targets:{worker:'https://example.com/'}}),/Invalid profile probe/);
 assert.throws(()=>observe(initialState(profile),{worker:'operational',queue:'operational',secret:'value'},1000,profile),/observation/);
});
