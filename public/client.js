const socket = io();
const welcome = document.querySelector('#welcome');
const game = document.querySelector('#game');
const toast = document.querySelector('#toast');
const roundPill = document.querySelector('#round-pill');
const nameInput = document.querySelector('#name');
const codeInput = document.querySelector('#room-code');
let identity = JSON.parse(localStorage.getItem('chaosIdentity') || 'null');
let currentState = null;
let selectedChoice = null;
let mySubmitted = false;
let myVoted = false;
let lastRound = null;
let lastPhase = null;
let challengeDraft = '';
let renderSignature = '';
let toastTimer;

function notify(message) { toast.textContent = message; toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.hidden = true, 3300); }
function saveIdentity(data) { identity = data; localStorage.setItem('chaosIdentity', JSON.stringify(data)); }
function clearIdentity() { identity = null; localStorage.removeItem('chaosIdentity'); welcome.hidden = false; game.hidden = true; roundPill.hidden = true; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function emitAck(event, payload) { return new Promise(resolve => socket.emit(event, payload, resolve)); }
function credentials() { return { code: identity.code, playerId: identity.playerId, token: identity.token }; }

socket.on('connect', async () => {
  if (!identity) return;
  const reply = await emitAck('joinRoom', { ...identity, code: identity.code, name: identity.name });
  if (reply?.error) { notify(reply.error); clearIdentity(); }
  else saveIdentity({ ...identity, ...reply });
});
socket.on('state', state => { const previous=currentState; currentState = state; if (state.round !== lastRound) { lastRound = state.round; selectedChoice = null; mySubmitted = false; myVoted = false; challengeDraft = ''; }
  if (state.phase !== lastPhase && state.phase === 'vote') { mySubmitted = false; myVoted = false; }
  lastPhase = state.phase; mySubmitted = (state.submittedPlayers||[]).includes(identity?.playerId); myVoted = (state.votedPlayers||[]).includes(identity?.playerId);
  welcome.hidden = true; game.hidden = false; roundPill.hidden = state.phase === 'lobby' || state.phase === 'finished'; roundPill.textContent = `ROUND ${state.round} / ${state.totalRounds}`;
  const {secondsLeft,...view}=state; const signature=JSON.stringify(view);
  if (signature !== renderSignature) { renderSignature=signature; render(state); }
  else if (previous) updateTimer(state);
});
socket.on('closed', ({ message }) => { notify(message); clearIdentity(); });
socket.on('disconnect', () => { if (identity) notify('Connection paused — trying to reconnect…'); });

document.querySelector('#create').addEventListener('click', async () => {
  const name = nameInput.value.trim(); if (!name) return notify('Enter your name first.');
  const reply = await emitAck('createRoom', { name }); if (reply.error) return notify(reply.error);
  saveIdentity({ ...reply, name });
});
document.querySelector('#join').addEventListener('click', async () => {
  const name = nameInput.value.trim(); const code = codeInput.value.trim().toUpperCase();
  if (!name) return notify('Enter your name first.'); if (code.length !== 4) return notify('Room codes have four letters or numbers.');
  const reply = await emitAck('joinRoom', { name, code }); if (reply.error) return notify(reply.error);
  saveIdentity({ ...reply, name });
});
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0,4); });

function render(state) {
  const me = state.players.find(p => p.id === identity?.playerId);
  if (state.phase === 'lobby') return renderLobby(state);
  if (state.phase === 'finished') return renderFinished(state);
  const isChallenge = state.type === 'challenge';
  const title = state.phase === 'vote' ? 'Pick the funniest answer.' : state.phase === 'results' ? 'Challenge results' : state.phase === 'reveal' ? 'The answer reveal' : isChallenge ? 'Your challenge' : 'Make your pick';
  let content = '';
  if (state.phase === 'question') content = renderQuestion(state);
  else if (state.phase === 'challenge') content = renderChallenge(state);
  else if (state.phase === 'vote') content = renderVote(state);
  else if (state.phase === 'reveal' || state.phase === 'results') content = renderReveal(state);
  game.innerHTML = `<div class="eyebrow">${isChallenge ? 'SILLY CHALLENGE' : 'MULTIPLE CHOICE'}</div><div class="room-heading"><div><h2>${title}</h2><div class="subheading">${escapeHtml(state.message || '')}</div></div>${identity?.playerId===state.hostId?'<button class="small-button" id="close-room">Close room</button>':''}</div><div class="timer"><div class="timer-track"><div class="timer-fill" style="width:${Math.max(0, Math.min(100, state.secondsLeft / (state.phase === 'vote' ? 20 : 30) * 100))}%"></div></div><div class="timer-count">${state.secondsLeft}s</div></div><div class="prompt">${escapeHtml(state.prompt || '')}</div>${content}<div class="scoreboard">${scoreboard(state.players, identity?.playerId)}</div>`;
  bindGameActions(state);
}
function updateTimer(state) { const count=game.querySelector('.timer-count'), fill=game.querySelector('.timer-fill'); if(count)count.textContent=`${state.secondsLeft}s`; if(fill)fill.style.width=`${Math.max(0,Math.min(100,state.secondsLeft/(state.phase==='vote'?20:30)*100))}%`; }
function renderLobby(state) {
  const isHost = identity?.playerId === state.hostId;
  game.innerHTML = `<div class="eyebrow">ROOM LOBBY</div><div class="room-heading"><div><h2>Gather your chaos crew.</h2><p class="subheading">Share this code with 1–3 friends.</p></div><button class="room-code" id="copy-code" title="Copy room code">${state.code} ⧉</button></div><div class="players">${state.players.map(p => `<div class="player"><div class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div><div class="player-name">${escapeHtml(p.name)}</div><div class="status">${p.connected ? 'READY' : 'RECONNECTING'}</div>${p.id === state.hostId ? '<span class="tag">HOST</span>' : ''}</div>`).join('')}</div>${isHost ? `<button id="start" class="primary" ${state.players.filter(p=>p.connected).length < 2 ? 'disabled' : ''}>Start game <span>↗</span></button><button id="close-room" class="small-button" style="width:100%;margin-top:8px">Close room</button><p class="hint">${state.players.filter(p=>p.connected).length < 2 ? 'Waiting for at least one more player…' : 'Everyone is here. Let the nonsense begin.'}</p>` : '<div class="locked">Waiting for the host to start…</div>'}<p class="fine-print">Room code <b>${state.code}</b> · 5 rounds · 30 seconds each</p>`;
  document.querySelector('#copy-code')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.code); notify('Room code copied!'); } catch { notify(`Share room code: ${state.code}`); } });
  document.querySelector('#start')?.addEventListener('click', async () => { const r = await emitAck('startGame', credentials()); if (r.error) notify(r.error); });
  document.querySelector('#close-room')?.addEventListener('click', closeRoom);
}
function renderQuestion(state) {
  if (mySubmitted) return `<div class="locked">Your answer is locked in. Waiting for everyone else…</div>`;
  return `<div class="choices">${state.options.map((o,i) => `<button class="choice ${selectedChoice===i?'selected':''}" data-choice="${i}"><span class="choice-letter">${String.fromCharCode(65+i)}</span>${escapeHtml(o)}</button>`).join('')}</div><button id="submit-answer" class="primary" ${selectedChoice===null?'disabled':''}>Lock in my answer <span>↗</span></button>`;
}
function renderChallenge() { return mySubmitted ? `<div class="locked">Your challenge is submitted. Get ready to vote!</div>` : `<textarea id="challenge-answer" maxlength="120" rows="3" placeholder="Your answer (max 120 characters)">${escapeHtml(challengeDraft)}</textarea><button id="submit-answer" class="primary">Submit my answer <span>↗</span></button>`; }
function renderVote(state) {
  if (myVoted) return `<div class="locked">Your vote is locked in. Waiting for the crew…</div>`;
  return `<div class="responses">${Object.entries(state.submissions||{}).filter(([id])=>id!==identity?.playerId).map(([id,v])=>{const p=state.players.find(x=>x.id===id);return `<div class="response"><button data-vote="${id}"><strong>${escapeHtml(p?.name||'Player')}</strong>${escapeHtml(v.text||'')}</button></div>`}).join('')}</div><p class="hint">You can’t vote for your own answer.</p>`;
}
function renderReveal(state) {
  if (state.type === 'question') return `<div class="locked">${state.options.map((o,i)=>`${i===state.answer?'✅':'▫️'} ${escapeHtml(o)}`).join('<br>')}<br><br>Correct = 2 points · Matching the majority = 1 point</div>`;
  const votes=state.votes||{}; const counts={}; Object.values(votes).forEach(id=>counts[id]=(counts[id]||0)+1); const max=Math.max(0,...Object.values(counts)); return `<div class="responses">${Object.entries(state.submissions||{}).map(([id,v])=>{const p=state.players.find(x=>x.id===id);const wins=state.phase==='results'&&max>0&&counts[id]===max;return `<div class="response"><strong>${escapeHtml(p?.name||'Player')} ${wins?' · +2 FUNNIEST':''}</strong>${escapeHtml(v.text||'')}</div>`}).join('')}</div><p class="hint">Submitted challenge = 1 point</p>`;
}
function scoreboard(players, myId) { return [...players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="player"><div class="score">${String(i+1).padStart(2,'0')}</div><div class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</div><div class="player-name">${escapeHtml(p.name)}${p.id===myId?' (you)':''}</div><div class="score">${p.score} pts</div></div>`).join(''); }
function renderFinished(state) { const sorted=[...state.players].sort((a,b)=>b.score-a.score);const winners=sorted.filter(p=>p.score===sorted[0]?.score);game.innerHTML=`<div class="eyebrow">GAME OVER</div><div class="winner"><div class="trophy">🏆</div><h2>${winners.length===1?`${escapeHtml(winners[0].name)} wins!`:'It’s a tie!'}</h2><p>${winners.map(p=>escapeHtml(p.name)).join(' & ')} ${winners.length===1?'wins':'share the win'} with ${sorted[0]?.score||0} points.</p></div><h3>Final scoreboard</h3><div class="scoreboard">${scoreboard(state.players,identity?.playerId)}</div><p class="hint">The host can close the room. Refresh to start or join another game.</p>${identity?.playerId===state.hostId?'<button id="close-room" class="small-button" style="width:100%">Close room</button>':''}`;document.querySelector('#close-room')?.addEventListener('click',closeRoom); }
function bindGameActions(state) {
  game.querySelector('#challenge-answer')?.addEventListener('input', e=>{challengeDraft=e.target.value;});
  game.querySelectorAll('[data-choice]').forEach(b=>b.addEventListener('click',()=>{selectedChoice=Number(b.dataset.choice);render(state);}));
  game.querySelectorAll('[data-vote]').forEach(b=>b.addEventListener('click',async()=>{const r=await emitAck('vote',{...credentials(),targetId:b.dataset.vote});if(r.error)notify(r.error);else{myVoted=true;render(state);}}));
  game.querySelector('#submit-answer')?.addEventListener('click',async()=>{const value=state.type==='question'?selectedChoice:game.querySelector('#challenge-answer')?.value;const r=await emitAck('submit',{...credentials(),value});if(r.error)notify(r.error);else{mySubmitted=true;render(state);}});
  game.querySelector('#close-room')?.addEventListener('click',closeRoom);
}
async function closeRoom(){const r=await emitAck('closeRoom',credentials());if(r.error)notify(r.error);}
