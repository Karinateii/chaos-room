// End-to-end room flow using two independent Socket.IO clients (like two browser sessions).
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const assert = require('node:assert/strict');
const PORT = 3199;
const base = `http://127.0.0.1:${PORT}`;
let server;
const clients = [];
const latest = new WeakMap();
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function connect() { const s = io(base, { reconnection: false }); clients.push(s); s.on('state', value => latest.set(s, value)); return new Promise((resolve, reject) => { s.once('connect', () => resolve(s)); s.once('connect_error', reject); }); }
function emit(s, event, payload) { return new Promise(resolve => s.emit(event, payload, resolve)); }
function until(s, predicate, timeout = 15000) { const existing=latest.get(s); if(existing&&predicate(existing))return Promise.resolve(existing); return new Promise((resolve, reject) => { const timer=setTimeout(()=>{s.off('state', check);reject(new Error(`Timed out waiting for game state (last: ${JSON.stringify(latest.get(s))})`));},timeout); function check(value){if(predicate(value)){clearTimeout(timer);s.off('state',check);resolve(value);}}s.on('state',check); }); }
async function phase(s, wanted, round) { return until(s, st => st.phase === wanted && (!round || st.round === round)); }
async function main() {
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), ROUND_SECONDS: '15', VOTE_SECONDS: '10', REVEAL_SECONDS: '1' }, stdio: 'ignore' });
  for (let i=0;i<50;i++) { try { const response=await fetch(`${base}/health`); if (response.ok) break; } catch {} await wait(100); }
  if (server.exitCode !== null) throw new Error(`Local server exited with code ${server.exitCode}`);
  const s=await connect(); await run(s);
}
async function run(host0) {
  const hostCreated = await emit(host0, 'createRoom', { name: 'Host' }); assert.ok(hostCreated.code);
  const guest = await connect(); const guestJoin = await emit(guest, 'joinRoom', { code: hostCreated.code, name: 'Guest' }); assert.ok(guestJoin.playerId);
  let state = await until(host0, x => x.phase === 'lobby' && x.players.length === 2);
  // A fresh socket with the stored identity models a page refresh/reconnect.
  host0.disconnect(); const host = await connect(); clients.push(host);
  const hostResume = await emit(host, 'joinRoom', { code: hostCreated.code, playerId: hostCreated.playerId, token: hostCreated.token, name: 'Host' }); assert.equal(hostResume.playerId, hostCreated.playerId);
  state = await until(host, x => x.phase === 'lobby' && x.players.length === 2 && x.players.find(p=>p.id===hostCreated.playerId)?.connected);
  assert.equal(state.players.length, 2, 'reconnect must not create a duplicate player');
  const deniedStart = await emit(guest, 'startGame', { code: hostCreated.code, playerId: guestJoin.playerId, token: guestJoin.token }); assert.match(deniedStart.error, /Only the host/);
  const started = await emit(host, 'startGame', { code: hostCreated.code, playerId: hostCreated.playerId, token: hostCreated.token }); assert.equal(started.ok, true);

  // Round 1: demonstrate correct answer and tied-majority points.
  await phase(host, 'question', 1);
  await emit(host, 'submit', { code: hostCreated.code, playerId: hostCreated.playerId, token: hostCreated.token, value: 1 });
  await emit(guest, 'submit', { code: hostCreated.code, playerId: guestJoin.playerId, token: guestJoin.token, value: 0 });
  state = await phase(host, 'reveal', 1); assert.equal(state.players.find(p=>p.id===hostCreated.playerId).score, 3); assert.equal(state.players.find(p=>p.id===guestJoin.playerId).score, 1);

  // Round 2: challenge submissions and cross-voting.
  await phase(host, 'challenge', 2);
  await emit(host, 'submit', { code: hostCreated.code, playerId: hostCreated.playerId, token: hostCreated.token, value: 'The Floorwich Supreme' });
  await emit(guest, 'submit', { code: hostCreated.code, playerId: guestJoin.playerId, token: guestJoin.token, value: 'Crumbageddon' });
  state = await phase(host, 'vote', 2); const hostText=state.submissions[hostCreated.playerId].text;
  const selfVote = await emit(host, 'vote', { code:hostCreated.code, playerId:hostCreated.playerId, token:hostCreated.token, targetId:hostCreated.playerId }); assert.match(selfVote.error,/cannot vote/);
  await emit(host, 'vote', { code:hostCreated.code, playerId:hostCreated.playerId, token:hostCreated.token, targetId:guestJoin.playerId });
  await emit(guest, 'vote', { code:hostCreated.code, playerId:guestJoin.playerId, token:guestJoin.token, targetId:hostCreated.playerId });
  state = await phase(host, 'results', 2); assert.equal(state.submissions[hostCreated.playerId].text, hostText);

  // Finish rounds 3–5 in order, waiting for each reveal and vote.
  await phase(host, 'question', 3);
  await emit(host, 'submit', { code:hostCreated.code, playerId:hostCreated.playerId, token:hostCreated.token, value:0 });
  await emit(guest, 'submit', { code:hostCreated.code, playerId:guestJoin.playerId, token:guestJoin.token, value:0 });
  await phase(host, 'reveal', 3);
  await phase(host, 'challenge', 4);
  await emit(host, 'submit', { code:hostCreated.code, playerId:hostCreated.playerId, token:hostCreated.token, value:'Host round four' });
  await emit(guest, 'submit', { code:hostCreated.code, playerId:guestJoin.playerId, token:guestJoin.token, value:'Guest round four' });
  await phase(host, 'vote', 4);
  await emit(host, 'vote', { code:hostCreated.code, playerId:hostCreated.playerId, token:hostCreated.token, targetId:guestJoin.playerId });
  await emit(guest, 'vote', { code:hostCreated.code, playerId:guestJoin.playerId, token:guestJoin.token, targetId:hostCreated.playerId });
  await phase(host, 'results', 4);
  await phase(host, 'question', 5);
  await emit(host, 'submit', { code:hostCreated.code, playerId:hostCreated.playerId, token:hostCreated.token, value:0 });
  await emit(guest, 'submit', { code:hostCreated.code, playerId:guestJoin.playerId, token:guestJoin.token, value:0 });
  await phase(host, 'reveal', 5);
  state = await phase(host, 'finished', 5); assert.equal(state.totalRounds,5); assert.ok(state.players.every(p=>p.score>0));
  const deniedClose = await emit(guest,'closeRoom',{code:hostCreated.code,playerId:guestJoin.playerId,token:guestJoin.token});assert.match(deniedClose.error,/Only the host/);
  console.log('PASS: two players joined, host reconnect recovered, non-host controls rejected, and all five rounds scored to a final screen.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{clients.forEach(s=>s.close());if(server)server.kill();});
