// All game state lives on the server so every connected player sees the same match.
const http = require('http');
const { randomUUID, randomInt } = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS || 30);
const REVEAL_SECONDS = Number(process.env.REVEAL_SECONDS || 5);
const VOTE_SECONDS = Number(process.env.VOTE_SECONDS || 20);
const rooms = new Map();

const rounds = [
  { type: 'question', prompt: 'Which animal would make the most chaotic office manager?', options: ['A raccoon', 'A goose', 'A tiny horse', 'An octopus'], answer: 1 },
  { type: 'challenge', prompt: 'Invent a dramatic name for a sandwich that fell on the floor. Keep it kind and short.' },
  { type: 'question', prompt: 'What is the worst thing to hear from your GPS?', options: ['“Good luck.”', '“I have no idea.”', '“We need to talk.”', '“The road is a suggestion.”'], answer: 2 },
  { type: 'challenge', prompt: 'Describe your superhero power if it only worked on Tuesdays. One short sentence.' },
  { type: 'question', prompt: 'Which object would be the rudest if it could talk?', options: ['A printer', 'A mirror', 'A chair', 'A fridge'], answer: 0 }
];

const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
  if (req.url === '/socket.io/socket.io.js') return;
  const path = req.url === '/' ? '/index.html' : req.url;
  if (!['/index.html', '/style.css', '/client.js'].includes(path)) { res.writeHead(404); return res.end('Not found'); }
  const fs = require('fs');
  const file = require('path').join(__dirname, 'public', path.slice(1));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); return res.end('Could not load game'); }
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'text/javascript' : 'text/html';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache' }); res.end(data);
  });
});
const io = new Server(server, { serveClient: true, cors: { origin: true } });

function makeCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''); } while (rooms.has(code));
  return code;
}
function publicState(room) {
  return {
    code: room.code, phase: room.phase, round: room.roundIndex + 1, totalRounds: rounds.length,
    secondsLeft: room.secondsLeft, hostId: room.hostId,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected })),
    submittedPlayers: [...room.submissions.keys()], votedPlayers: [...room.votes.keys()],
    prompt: room.phase === 'lobby' ? null : rounds[room.roundIndex]?.prompt,
    type: room.phase === 'lobby' ? null : rounds[room.roundIndex]?.type,
    options: room.phase === 'question' ? rounds[room.roundIndex].options : null,
    submissions: room.phase === 'reveal' || room.phase === 'vote' || room.phase === 'results' || room.phase === 'finished' ? Object.fromEntries(room.submissions) : null,
    answer: ['reveal', 'results', 'finished'].includes(room.phase) && rounds[room.roundIndex].type === 'question' ? rounds[room.roundIndex].answer : null,
    votes: ['results', 'finished'].includes(room.phase) && rounds[room.roundIndex].type === 'challenge' ? Object.fromEntries(room.votes) : null,
    message: room.message || ''
  };
}
function broadcast(room) { io.to(room.code).emit('state', publicState(room)); }
function stopTimer(room) { if (room.timer) clearInterval(room.timer); room.timer = null; }
function setTimer(room, seconds, callback) {
  stopTimer(room); room.secondsLeft = seconds;
  room.timer = setInterval(() => { room.secondsLeft -= 1; if (room.secondsLeft <= 0) { room.secondsLeft = 0; stopTimer(room); callback(); } else broadcast(room); }, 1000);
}
function removeEmptyRoom(room) { if (![...room.players.values()].some(p => p.connected)) { stopTimer(room); rooms.delete(room.code); } }
function finishOrNext(room) {
  if (room.roundIndex >= rounds.length - 1) { room.phase = 'finished'; room.message = 'That is the end of the chaos!'; stopTimer(room); broadcast(room); }
  else { room.roundIndex += 1; room.submissions.clear(); room.votes.clear(); room.phase = rounds[room.roundIndex].type; room.message = ''; setTimer(room, ROUND_SECONDS, () => endTimedPhase(room)); broadcast(room); }
}
function revealQuestion(room) { room.phase = 'reveal'; room.secondsLeft = 0; room.message = 'Answers are in!';
  const r = rounds[room.roundIndex];
  const picked = [...room.submissions.values()].filter(v => Number.isInteger(v.choice)).map(v => v.choice);
  if (picked.length) { const counts = new Map(); picked.forEach(n => counts.set(n, (counts.get(n) || 0) + 1)); const max = Math.max(...counts.values()); const popular = [...counts].filter(([, n]) => n === max).map(([i]) => i);
    for (const [id, v] of room.submissions) { const p = room.players.get(id); if (!p) continue; if (v.choice === r.answer) p.score += 2; if (popular.includes(v.choice)) p.score += 1; }
  }
  broadcast(room); room.timer = setTimeout(() => finishOrNext(room), REVEAL_SECONDS * 1000);
}
function revealChallenge(room) { room.phase = 'vote'; room.secondsLeft = VOTE_SECONDS; room.message = 'Vote for the funniest answer!'; broadcast(room);
  room.timer = setInterval(() => { room.secondsLeft -= 1; if (room.secondsLeft <= 0 || room.votes.size >= [...room.players.values()].filter(p => p.connected).length) { stopTimer(room); resolveChallenge(room); } else broadcast(room); }, 1000);
}
function resolveChallenge(room) { room.phase = 'results'; room.secondsLeft = 0;
  for (const id of room.submissions.keys()) { const p = room.players.get(id); if (p) p.score += 1; }
  const counts = new Map(); for (const id of room.votes.values()) counts.set(id, (counts.get(id) || 0) + 1);
  if (counts.size) { const max = Math.max(...counts.values()); for (const [id, n] of counts) if (n === max) { const p = room.players.get(id); if (p) p.score += 2; } }
  broadcast(room); room.timer = setTimeout(() => finishOrNext(room), REVEAL_SECONDS * 1000);
}
function endTimedPhase(room) { if (rounds[room.roundIndex].type === 'question') revealQuestion(room); else revealChallenge(room); }

io.on('connection', socket => {
  socket.on('createRoom', ({ name } = {}, ack = () => {}) => {
    const clean = String(name || '').trim().slice(0, 16); if (!clean) return ack({ error: 'Enter a display name first.' });
    const code = makeCode(), id = randomUUID(), token = randomUUID();
    const room = { code, hostId: id, players: new Map([[id, { id, token, name: clean, score: 0, connected: true, socketId: socket.id }]]), phase: 'lobby', roundIndex: -1, secondsLeft: 0, submissions: new Map(), votes: new Map(), timer: null, message: '' };
    rooms.set(code, room); socket.join(code); ack({ code, playerId: id, token }); broadcast(room);
  });
  socket.on('joinRoom', ({ code, name, playerId, token } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').toUpperCase()); if (!room) return ack({ error: 'Room not found. Check the code and try again.' });
    let player = playerId && room.players.get(playerId);
    if (player && player.token !== token) player = null;
    if (!player) {
      if (room.phase !== 'lobby') return ack({ error: 'This game has already started. Rejoin from the same browser that first joined.' });
      if (room.players.size >= 4) return ack({ error: 'This room is full (4 players).' });
      const clean = String(name || '').trim().slice(0, 16); if (!clean) return ack({ error: 'Enter a display name first.' });
      const id = randomUUID(); player = { id, token: randomUUID(), name: clean, score: 0, connected: true, socketId: socket.id }; room.players.set(id, player);
    } else {
      if (player.socketId && player.socketId !== socket.id) io.sockets.sockets.get(player.socketId)?.leave(room.code);
      player.connected = true; player.socketId = socket.id;
    }
    socket.join(room.code); ack({ code: room.code, playerId: player.id, token: player.token }); broadcast(room);
  });
  socket.on('startGame', ({ code, playerId, token } = {}, ack = () => {}) => {
    const room = rooms.get(code); const host = room?.players.get(playerId);
    if (!room || room.hostId !== playerId || host?.token !== token) return ack({ error: 'Only the host can start this game.' });
    if (room.phase !== 'lobby') return ack({ error: 'This game has already started.' });
    if ([...room.players.values()].filter(p => p.connected).length < 2) return ack({ error: 'At least two players must be connected.' });
    room.roundIndex = 0; room.phase = rounds[0].type; room.message = ''; setTimer(room, ROUND_SECONDS, () => endTimedPhase(room)); broadcast(room); ack({ ok: true });
  });
  socket.on('submit', ({ code, playerId, token, value } = {}, ack = () => {}) => {
    const room = rooms.get(code), player = room?.players.get(playerId); if (!room || !player || player.token !== token || !player.connected) return ack({ error: 'Please rejoin the room.' });
    if (room.phase !== 'question' && room.phase !== 'challenge') return ack({ error: 'Submissions are closed.' });
    if (room.submissions.has(playerId)) return ack({ error: 'Your answer is already locked in.' });
    const round = rounds[room.roundIndex];
    if (round.type === 'question' && (!Number.isInteger(value) || value < 0 || value >= round.options.length)) return ack({ error: 'Choose one of the answers.' });
    const text = round.type === 'challenge' ? String(value || '').trim().slice(0, 120) : '';
    if (round.type === 'challenge' && !text) return ack({ error: 'Write a short answer before submitting.' });
    room.submissions.set(playerId, round.type === 'question' ? { choice: value } : { text });
    if ([...room.players.values()].filter(p => p.connected).every(p => room.submissions.has(p.id))) { stopTimer(room); endTimedPhase(room); }
    else broadcast(room);
    ack({ ok: true });
  });
  socket.on('vote', ({ code, playerId, token, targetId } = {}, ack = () => {}) => {
    const room = rooms.get(code), player = room?.players.get(playerId); if (!room || room.phase !== 'vote' || !player || player.token !== token) return ack({ error: 'Voting is closed.' });
    if (playerId === targetId) return ack({ error: 'You cannot vote for yourself.' });
    if (!room.submissions.has(targetId)) return ack({ error: 'That response is not available.' });
    if (room.votes.has(playerId)) return ack({ error: 'Your vote is already locked in.' });
    room.votes.set(playerId, targetId);
    if ([...room.players.values()].filter(p => p.connected && p.id !== targetId).every(p => room.votes.has(p.id))) { stopTimer(room); resolveChallenge(room); }
    else broadcast(room);
    ack({ ok: true });
  });
  socket.on('closeRoom', ({ code, playerId, token } = {}, ack = () => {}) => {
    const room = rooms.get(code), host = room?.players.get(playerId);
    if (!room || room.hostId !== playerId || host?.token !== token) return ack({ error: 'Only the host can close this room.' });
    stopTimer(room); io.to(code).emit('closed', { message: 'The host closed this room.' }); rooms.delete(code); ack({ ok: true });
  });
  socket.on('disconnect', () => { for (const room of rooms.values()) { const p = [...room.players.values()].find(x => x.socketId === socket.id); if (p) { p.connected = false; p.socketId = null; broadcast(room); setTimeout(() => { if (!rooms.has(room.code)) return; const current = room.players.get(p.id); if (current && !current.connected) { room.players.delete(p.id); if (!room.players.size) removeEmptyRoom(room); else broadcast(room); } }, 120000); } } });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Chaos Room listening on port ${PORT}`));
