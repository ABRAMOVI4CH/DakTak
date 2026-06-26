import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join } from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 3001);
const DIST = join(fileURLToPath(new URL(".", import.meta.url)), "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mp3": "audio/mpeg",
};

const httpServer = createServer(async (req, res) => {
  let filePath = join(DIST, req.url === "/" ? "index.html" : req.url);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

httpServer.listen(PORT, () => {
  console.log(`DakTak running on http://localhost:${PORT}`);
});

// ── Constants ──

const tickRate = 60;
const sendRate = 30;
const matchPointLimit = 10;
const tileSize = 2;
const tileCount = 12;
const worldSize = tileCount * tileSize;
const bonusLegLength = tileSize * 5.6;
const wallLength = tileSize * 5.6;
const wallHeight = tileSize * 3.5;
const wallWidth = tileSize;
const wallOffset = 0.22;
const towerPlayerY = wallHeight + 0.15;
const playerOrder = ["blue", "red", "blueTower", "redTower"];
const spotAngle = 0.16 * 0.96;
const maxLightDistance = worldSize * 4;

// ── Rooms ──

const rooms = new Map();
let lastRoomId = 0;
let lastClientId = 0;
const allClients = new Map();

function createRoom(name, adminId) {
  const roomId = String(++lastRoomId);
  const room = {
    id: roomId,
    name: String(name).slice(0, 24) || `Комната ${roomId}`,
    adminClientId: adminId,
    status: "lobby",
    clients: new Map(),
    players: {
      blue: createPlayer("blue", "field", -worldSize / 2 + 1.6, 0, -worldSize / 2 + 1.6),
      red: createPlayer("red", "field", worldSize / 2 - 1.6, 0, worldSize / 2 - 1.6),
      blueTower: createPlayer("blue", "tower", worldSize / 2 + wallOffset + wallWidth / 2, towerPlayerY, worldSize / 2 + wallOffset - wallLength * 0.55, "red"),
      redTower: createPlayer("red", "tower", -worldSize / 2 - wallOffset - wallWidth / 2, towerPlayerY, -worldSize / 2 - wallOffset + wallLength * 0.55, "blue"),
    },
    score: { blue: 0, red: 0 },
    goalState: { blue: false, red: false },
    round: { status: "playing", resetAt: 0, startedAt: 0 },
    lastGoal: null,
    tickInterval: null,
    sendInterval: null,
    kickInterval: null,
    countdownInterval: null,
  };
  rooms.set(roomId, room);
  return room;
}

function destroyRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearInterval(room.tickInterval);
  clearInterval(room.sendInterval);
  clearInterval(room.kickInterval);
  rooms.delete(roomId);
}

function startRoomGame(room) {
  if (room.status === "playing" || room.status === "countdown") return;
  room.status = "countdown";
  room.score = { blue: 0, red: 0 };
  room.goalState = { blue: false, red: false };
  room.lastGoal = null;

  // Tell all clients to show countdown, assign their slots
  room.clients.forEach((client) => {
    if (client.activeId) {
      send(client.socket, { type: "gameStarted", activeId: client.activeId });
    }
  });

  // Broadcast countdown: 3, 2, 1
  let count = 3;
  broadcastToRoom(room, { type: "countdown", value: count });

  room.countdownInterval = setInterval(() => {
    count--;
    if (count > 0) {
      broadcastToRoom(room, { type: "countdown", value: count });
    } else {
      clearInterval(room.countdownInterval);
      room.countdownInterval = null;

      room.status = "playing";
      resetRoomRound(room);

      room.tickInterval = setInterval(() => updateRoomGame(room, 1 / tickRate), 1000 / tickRate);
      room.sendInterval = setInterval(() => broadcastRoomState(room), 1000 / sendRate);
      room.kickInterval = setInterval(() => kickInactiveRoomClients(room), 2000);

      broadcastToRoom(room, { type: "countdown", value: 0 });
      broadcastRoomState(room);
    }
  }, 1000);
}

function stopRoomGame(room) {
  clearInterval(room.tickInterval);
  clearInterval(room.sendInterval);
  clearInterval(room.kickInterval);
  clearInterval(room.countdownInterval);
  room.tickInterval = null;
  room.sendInterval = null;
  room.kickInterval = null;
  room.countdownInterval = null;
  room.status = "lobby";
  room.round = { status: "playing", resetAt: 0, startedAt: 0 };
}

function getRoomSlotCount(room) {
  let count = 0;
  room.clients.forEach((c) => { if (c.activeId) count++; });
  return count;
}

function getClientByPlayerIdInRoom(room, playerId) {
  return [...room.clients.values()].find((c) => c.activeId === playerId);
}

function removeClientFromRoom(client) {
  const room = client.room;
  if (!room) return;

  room.clients.delete(client.socket);
  client.activeId = null;
  client.room = null;

  // If room is empty, destroy it
  if (room.clients.size === 0) {
    if (room.status === "playing") stopRoomGame(room);
    destroyRoom(room.id);
    broadcastRoomList();
    return;
  }

  // If admin left, reassign
  if (room.adminClientId === client.id) {
    const next = [...room.clients.values()][0];
    if (next) room.adminClientId = next.id;
  }

  broadcastLobbyState(room);
  broadcastRoomList();
}

// ── Connection ──

wss.on("connection", (socket) => {
  const id = ++lastClientId;
  const client = {
    id,
    socket,
    nickname: null,
    isTalking: false,
    activeId: null,
    room: null,
    input: { seq: 0, x: 0, y: 0, isRunning: true },
    lastProcessedSeq: 0,
    lastMessageAt: Date.now(),
  };

  allClients.set(socket, client);
  send(socket, { type: "welcome", clientId: id });
  sendRoomList(socket);

  socket.on("message", (raw) => {
    client.lastMessageAt = Date.now();
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "nickname") {
      client.nickname = String(message.nickname || "").slice(0, 16) || null;
      if (client.room) broadcastLobbyState(client.room);
    }

    if (message.type === "listRooms") {
      sendRoomList(socket);
    }

    if (message.type === "createRoom") {
      if (client.room) removeClientFromRoom(client);
      const room = createRoom(message.name, client.id);
      client.room = room;
      room.clients.set(socket, client);
      send(socket, { type: "roomJoined", roomId: room.id, roomName: room.name, isAdmin: true });
      broadcastLobbyState(room);
      broadcastRoomList();
    }

    if (message.type === "joinRoom") {
      const room = rooms.get(String(message.roomId));
      if (!room) {
        send(socket, { type: "roomError", error: "Комната не найдена" });
        return;
      }
      if (room.status === "playing") {
        send(socket, { type: "roomError", error: "Игра уже идёт" });
        return;
      }
      if (getRoomSlotCount(room) >= 4 && !room.clients.has(socket)) {
        send(socket, { type: "roomError", error: "Комната заполнена" });
        return;
      }
      if (client.room) removeClientFromRoom(client);
      client.room = room;
      room.clients.set(socket, client);
      send(socket, { type: "roomJoined", roomId: room.id, roomName: room.name, isAdmin: room.adminClientId === client.id });
      broadcastLobbyState(room);
      broadcastRoomList();
    }

    if (message.type === "leaveRoom") {
      if (client.room) {
        const room = client.room;
        if (room.status === "playing") {
          // Going back to lobby from game
          send(socket, { type: "backToLobby" });
        }
        removeClientFromRoom(client);
        sendRoomList(socket);
      }
    }

    if (message.type === "pickSlot") {
      const room = client.room;
      if (!room || room.status !== "lobby") return;
      const slotId = message.slotId;
      if (!playerOrder.includes(slotId)) return;

      const occupier = getClientByPlayerIdInRoom(room, slotId);
      if (occupier && occupier !== client) {
        send(socket, { type: "slotRejected", reason: "occupied" });
        return;
      }

      // If clicking same slot, deselect
      if (client.activeId === slotId) {
        client.activeId = null;
      } else {
        client.activeId = slotId;
      }

      broadcastLobbyState(room);

      // Auto-start if 4 slots filled
      if (getRoomSlotCount(room) >= 4) {
        startRoomGame(room);
      }
    }

    if (message.type === "devStart") {
      const room = client.room;
      if (!room || room.status !== "lobby") return;
      if (room.adminClientId !== client.id) return;
      if (getRoomSlotCount(room) < 1) return;
      startRoomGame(room);
    }

    // ── In-game messages (only when in a playing room) ──

    if (message.type === "input") {
      const room = client.room;
      if (!room || room.status !== "playing" || !client.activeId) return;

      client.input.seq = Number(message.seq) || client.input.seq;
      client.input.x = clamp(Number(message.x) || 0, -1, 1);
      client.input.y = clamp(Number(message.y) || 0, -1, 1);
      client.input.jump = Boolean(message.jump);
      client.input.isRunning = Boolean(message.isRunning);

      const slot = room.players[client.activeId];
      if (!slot) return;

      let yaw = Number(message.lookYaw) || 0;
      yaw = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (yaw > Math.PI) yaw -= Math.PI * 2;
      slot.lookYaw = yaw;
      slot.lookPitch = clamp(Number(message.lookPitch) || 0, -1.2, 0.42);
    }

    // Voice
    if (message.type === "voiceTalking") {
      client.isTalking = Boolean(message.talking);
      if (client.room) {
        broadcastToRoom(client.room, { type: "voiceTalking", clientId: id, activeId: client.activeId, nickname: client.nickname, talking: client.isTalking });
      }
    }

    if (message.type === "voiceOffer" || message.type === "voiceAnswer" || message.type === "voiceIce") {
      const targetEntry = [...allClients.entries()].find(([, c]) => c.id === message.targetId);
      if (targetEntry) {
        send(targetEntry[0], { ...message, fromId: id });
      }
    }
  });

  socket.on("close", () => {
    if (client.room) {
      const room = client.room;
      broadcastToRoom(room, { type: "voiceLeft", clientId: id });
      removeClientFromRoom(client);
    }
    allClients.delete(socket);
  });
});

// ── Room game logic ──

function kickInactiveRoomClients(room) {
  const now = Date.now();
  room.clients.forEach((client) => {
    if (!client.activeId) return;
    if (now - client.lastMessageAt > 10000) {
      send(client.socket, { type: "kicked", reason: "inactivity" });
      client.socket.close();
    }
  });
}

function createPlayer(color, type, x, y, z, corner = null) {
  return {
    color,
    type,
    corner,
    x,
    y,
    z,
    lookYaw: 0,
    lookPitch: 0,
    rotationY: 0,
    bodyTilt: 0,
    vy: 0,
  };
}

function updateRoomGame(room, delta) {
  if (room.round.status === "goal") {
    if (Date.now() >= room.round.resetAt) {
      resetRoomRound(room);
    }
    return;
  }

  if (room.round.status === "matchEnd") {
    if (Date.now() >= room.round.resetAt) {
      resetRoomMatch(room);
    }
    return;
  }

  room.clients.forEach((client) => {
    const slot = room.players[client.activeId];
    if (!slot) return;

    const maxSpeed = client.input.isRunning ? 7.2 : 4.2;
    const speed = client.input.x || client.input.y ? maxSpeed * Math.min(Math.hypot(client.input.x, client.input.y), 1) : 0;
    const lookDir = getSlotLookDirection(slot);
    const fwdX = lookDir.x;
    const fwdZ = lookDir.z;
    const moveX = (-client.input.y) * fwdX - client.input.x * fwdZ;
    const moveZ = (-client.input.y) * fwdZ + client.input.x * fwdX;
    const moveLen = Math.hypot(moveX, moveZ);
    const velocityX = moveLen > 0.001 ? (moveX / moveLen) * speed : 0;
    const velocityZ = moveLen > 0.001 ? (moveZ / moveLen) * speed : 0;
    const nextPosition = movePlayerWithBarriers(slot, slot.x, slot.z, velocityX * delta, velocityZ * delta);

    slot.x = nextPosition.x;
    slot.z = nextPosition.z;
    // Jump physics (field players only)
    if (slot.type !== "tower") {
      const groundY = 0;
      const onGround = slot.y <= groundY + 0.001;
      if (client.input.jump && onGround) {
        slot.vy = 7;
      }
      slot.vy -= 22 * delta;
      slot.y += slot.vy * delta;
      if (slot.y <= groundY) {
        slot.y = groundY;
        slot.vy = 0;
      }
    } else {
      slot.y = towerPlayerY;
    }
    client.lastProcessedSeq = client.input.seq;

    if (speed > 0.05) {
      slot.rotationY = Math.atan2(velocityX, velocityZ);
      slot.bodyTilt = Math.sin(Date.now() * 0.012) * 0.035;
    } else {
      slot.bodyTilt *= 0.84;
    }
  });

  updateRoomGoals(room);
}

function updateRoomGoals(room) {
  if (room.round.status !== "playing") return;

  const events = [
    getGoalEventForPlayer(room, "blue", "red"),
    getGoalEventForPlayer(room, "red", "blue"),
  ].filter(Boolean);

  const event = events[0];
  if (event && !room.goalState[event.team]) {
    room.goalState[event.team] = true;
    room.score[event.team] += event.points;
    room.lastGoal = {
      team: event.team,
      label: event.team === "blue" ? "ГОЛ СИНИХ" : "ГОЛ КРАСНЫХ",
      points: event.points,
      at: Date.now(),
    };

    if (room.score[event.team] >= matchPointLimit) {
      room.lastGoal.label = event.team === "blue" ? "СИНИЕ ПОБЕДИЛИ" : "КРАСНЫЕ ПОБЕДИЛИ";
      room.round.status = "matchEnd";
      room.round.resetAt = Date.now() + 5000;
    } else {
      room.round.status = "goal";
      room.round.resetAt = Date.now() + 5000;
    }
  }

  ["blue", "red"].forEach((team) => {
    if (!events.some((event) => event.team === team)) {
      room.goalState[team] = false;
    }
  });
}

function resetRoomRound(room) {
  const p = room.players;
  p.blue.x = -worldSize / 2 + 1.6; p.blue.y = 0; p.blue.z = -worldSize / 2 + 1.6;
  p.blue.rotationY = 0; p.blue.bodyTilt = 0; p.blue.lookYaw = 0; p.blue.lookPitch = 0;

  p.red.x = worldSize / 2 - 1.6; p.red.y = 0; p.red.z = worldSize / 2 - 1.6;
  p.red.rotationY = Math.PI; p.red.bodyTilt = 0; p.red.lookYaw = 0; p.red.lookPitch = 0;

  p.blueTower.x = worldSize / 2 + wallOffset + wallWidth / 2;
  p.blueTower.y = towerPlayerY;
  p.blueTower.z = worldSize / 2 + wallOffset - wallLength * 0.55;
  p.blueTower.rotationY = 0; p.blueTower.bodyTilt = 0; p.blueTower.lookYaw = 0; p.blueTower.lookPitch = 0;

  p.redTower.x = -worldSize / 2 - wallOffset - wallWidth / 2;
  p.redTower.y = towerPlayerY;
  p.redTower.z = -worldSize / 2 - wallOffset + wallLength * 0.55;
  p.redTower.rotationY = 0; p.redTower.bodyTilt = 0; p.redTower.lookYaw = 0; p.redTower.lookPitch = 0;

  room.goalState.blue = false;
  room.goalState.red = false;
  room.clients.forEach((client) => {
    client.input.x = 0;
    client.input.y = 0;
    client.lastProcessedSeq = client.input.seq;
  });
  room.round.status = "playing";
  room.round.resetAt = 0;
  room.round.startedAt = Date.now();
  broadcastRoomState(room);
}

function resetRoomMatch(room) {
  room.score.blue = 0;
  room.score.red = 0;
  resetRoomRound(room);
}

function getGoalEventForPlayer(room, scoringId, opponentId) {
  const scoringPlayer = room.players[scoringId];
  const opponent = room.players[opponentId];
  const isGoal = isPointInPlayerShadow(room, scoringPlayer.x, scoringPlayer.z, opponent, scoringPlayer);
  if (!isGoal) return null;
  return {
    team: scoringPlayer.color,
    points: isInBonusTriangle(scoringPlayer.x, scoringPlayer.z) ? 2 : 1,
  };
}

// ── Messaging ──

function send(socket, message) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(message));
}

function broadcastToRoom(room, message) {
  room.clients.forEach((client) => send(client.socket, message));
}

function broadcastRoomState(room) {
  const state = getRoomGameState(room);
  room.clients.forEach((client) => {
    send(client.socket, {
      type: "state",
      activeId: client.activeId,
      ackSeq: client.lastProcessedSeq ?? 0,
      ...state,
    });
  });
}

function getRoomGameState(room) {
  return {
    now: Date.now(),
    score: room.score,
    lastGoal: room.lastGoal,
    round: room.round,
    slots: Object.fromEntries(playerOrder.map((id) => {
      const occupier = getClientByPlayerIdInRoom(room, id);
      return [id, { occupied: Boolean(occupier), nickname: occupier?.nickname || null }];
    })),
    voiceClients: [...room.clients.values()]
      .filter((c) => c.activeId)
      .map((c) => ({ clientId: c.id, activeId: c.activeId, nickname: c.nickname, talking: c.isTalking })),
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, slot]) => [
        id,
        { x: slot.x, y: slot.y, z: slot.z, lookYaw: slot.lookYaw, lookPitch: slot.lookPitch, rotationY: slot.rotationY, bodyTilt: slot.bodyTilt },
      ]),
    ),
  };
}

function broadcastLobbyState(room) {
  const lobbyState = {
    type: "lobbyState",
    roomId: room.id,
    roomName: room.name,
    adminClientId: room.adminClientId,
    status: room.status,
    slots: Object.fromEntries(playerOrder.map((id) => {
      const occupier = getClientByPlayerIdInRoom(room, id);
      return [id, {
        occupied: Boolean(occupier),
        nickname: occupier?.nickname || null,
        clientId: occupier?.id || null,
      }];
    })),
    playerCount: getRoomSlotCount(room),
  };
  room.clients.forEach((client) => {
    send(client.socket, { ...lobbyState, isAdmin: room.adminClientId === client.id });
  });
}

function sendRoomList(socket) {
  send(socket, {
    type: "roomList",
    rooms: [...rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      playerCount: getRoomSlotCount(r),
      status: r.status,
    })),
  });
}

function broadcastRoomList() {
  const list = {
    type: "roomList",
    rooms: [...rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      playerCount: getRoomSlotCount(r),
      status: r.status,
    })),
  };
  allClients.forEach((client) => {
    if (!client.room) send(client.socket, list);
  });
}

// ── Physics (unchanged) ──

function isPointInPlayerShadow(room, x, z, targetPlayer, activePlayer) {
  const contactRadius = 0.62;
  const samples = [
    [x, z],
    [x + contactRadius, z],
    [x - contactRadius, z],
    [x, z + contactRadius],
    [x, z - contactRadius],
    [x + contactRadius * 0.7, z + contactRadius * 0.7],
    [x - contactRadius * 0.7, z + contactRadius * 0.7],
    [x + contactRadius * 0.7, z - contactRadius * 0.7],
    [x - contactRadius * 0.7, z - contactRadius * 0.7],
  ];
  return samples.some(([sampleX, sampleZ]) => isGroundPointShadowedByPlayer(room, sampleX, sampleZ, targetPlayer, activePlayer));
}

function isGroundPointShadowedByPlayer(room, x, z, targetPlayer, activePlayer) {
  const lightSlot = activePlayer.color === "blue" ? room.players.blueTower : room.players.redTower;
  const lightOrigin = getFlashlightOrigin(lightSlot);

  if (!isPointInsideLightCone(x, z, lightSlot, lightOrigin)) return false;

  const targetRadius = 0.58;
  if (Math.hypot(x - targetPlayer.x, z - targetPlayer.z) < targetRadius * 1.15) return false;

  const rayStart = lightOrigin;
  const rayEnd = { x, y: 0.02, z };
  const capsuleBottom = { x: targetPlayer.x, y: targetPlayer.y + targetRadius, z: targetPlayer.z };
  const capsuleTop = { x: targetPlayer.x, y: targetPlayer.y + 1.95, z: targetPlayer.z };
  const distanceSq = closestDistanceSqBetweenSegments(rayStart, rayEnd, capsuleBottom, capsuleTop);

  return distanceSq <= targetRadius * targetRadius;
}

function isPointInsideLightCone(x, z, lightSlot, lightOrigin) {
  const target = getLookTarget(lightSlot, lightOrigin, worldSize * 0.9);
  const coneAxis = normalize3({
    x: target.x - lightOrigin.x,
    y: target.y - lightOrigin.y,
    z: target.z - lightOrigin.z,
  });
  if (!coneAxis) return false;

  const toPoint = { x: x - lightOrigin.x, y: 0.02 - lightOrigin.y, z: z - lightOrigin.z };
  const lightDistance = length3(toPoint);
  if (lightDistance < 0.0001) return false;

  const forwardDistance = dot3(toPoint, coneAxis);
  const pointAngle = Math.acos(clamp(forwardDistance / lightDistance, -1, 1));
  return forwardDistance > 0 && lightDistance <= maxLightDistance && pointAngle <= spotAngle;
}

function closestDistanceSqBetweenSegments(p1, q1, p2, q2) {
  const d1 = sub3(q1, p1);
  const d2 = sub3(q2, p2);
  const r = sub3(p1, p2);
  const a = dot3(d1, d1);
  const e = dot3(d2, d2);
  const f = dot3(d2, r);
  const epsilon = 0.000001;
  let s = 0;
  let t = 0;

  if (a <= epsilon && e <= epsilon) return distanceSq3(p1, p2);

  if (a <= epsilon) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot3(d1, r);
    if (e <= epsilon) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot3(d1, d2);
      const denominator = a * e - b * b;
      if (denominator !== 0) s = clamp((b * f - c * e) / denominator, 0, 1);
      t = (b * s + f) / e;

      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const closest1 = addScaled3(p1, d1, s);
  const closest2 = addScaled3(p2, d2, t);
  return distanceSq3(closest1, closest2);
}

function movePlayerWithBarriers(slot, currentX, currentZ, deltaX, deltaZ) {
  if (slot.type === "tower") return moveTowerPlayer(slot.corner, currentX, currentZ, deltaX, deltaZ);
  return {
    x: clamp(currentX + deltaX, -worldSize / 2 + 0.8, worldSize / 2 - 0.8),
    z: clamp(currentZ + deltaZ, -worldSize / 2 + 0.8, worldSize / 2 - 0.8),
  };
}

function moveTowerPlayer(corner, currentX, currentZ, deltaX, deltaZ) {
  const stepLength = Math.hypot(deltaX, deltaZ);
  const both = { x: currentX + deltaX, z: currentZ + deltaZ };

  if (isInsideTower(corner, both.x, both.z)) return both;
  if (stepLength === 0) return { x: currentX, z: currentZ };

  const canMoveX = isInsideTower(corner, currentX + deltaX, currentZ);
  const canMoveZ = isInsideTower(corner, currentX, currentZ + deltaZ);

  if (canMoveX && Math.abs(deltaX) >= Math.abs(deltaZ)) return { x: currentX + Math.sign(deltaX) * stepLength, z: currentZ };
  if (canMoveZ) return { x: currentX, z: currentZ + Math.sign(deltaZ) * stepLength };
  if (canMoveX) return { x: currentX + Math.sign(deltaX) * stepLength, z: currentZ };
  return { x: currentX, z: currentZ };
}

function isInsideTower(corner, x, z) {
  return getTowerRects(corner).some((rect) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ);
}

function getTowerRects(corner) {
  const half = worldSize / 2;
  const outer = half + wallOffset;
  const margin = 0.22;

  return corner === "blue"
    ? [
        { minX: -outer - wallWidth + margin, maxX: -outer + wallLength - margin, minZ: -outer - wallWidth + margin, maxZ: -outer - margin },
        { minX: -outer - wallWidth + margin, maxX: -outer - margin, minZ: -outer - wallWidth + margin, maxZ: -outer + wallLength - margin },
      ]
    : [
        { minX: outer - wallLength + margin, maxX: outer + wallWidth - margin, minZ: outer + margin, maxZ: outer + wallWidth - margin },
        { minX: outer + margin, maxX: outer + wallWidth - margin, minZ: outer - wallLength + margin, maxZ: outer + wallWidth - margin },
      ];
}

function getSlotLookDirection(slot) {
  const direction = slot.type === "tower"
    ? (slot.corner === "blue" ? 1 : -1)
    : (slot.color === "blue" ? 1 : -1);
  const base = normalize2({ x: direction, z: direction });
  return rotate2(base, slot.lookYaw);
}

function getLookTarget(slot, origin, distance) {
  const direction = getSlotLookDirection(slot);
  const basePitch = slot.type === "tower" ? -0.86 : -0.06;
  const pitch = clamp(basePitch + slot.lookPitch, -1.38, 0.35);
  const horizontalDistance = Math.cos(pitch) * distance;
  return {
    x: origin.x + direction.x * horizontalDistance,
    y: origin.y + Math.sin(pitch) * distance,
    z: origin.z + direction.z * horizontalDistance,
  };
}

function getFlashlightOrigin(slot) {
  const direction = getSlotLookDirection(slot);
  return {
    x: slot.x + direction.x * 0.9,
    y: slot.y + 2.2,
    z: slot.z + direction.z * 0.9,
  };
}

function isInTeamBonusTriangle(team, x, z) {
  const half = worldSize / 2;
  const blueX = x + half;
  const blueZ = z + half;
  const redX = half - x;
  const redZ = half - z;
  if (team === "blue") return blueX >= 0 && blueZ >= 0 && blueX + blueZ <= bonusLegLength;
  return redX >= 0 && redZ >= 0 && redX + redZ <= bonusLegLength;
}

function isInBonusTriangle(x, z) {
  return isInTeamBonusTriangle("blue", x, z) || isInTeamBonusTriangle("red", x, z);
}

// ── Math helpers ──

function normalize2(vector) {
  const length = Math.hypot(vector.x, vector.z);
  return length ? { x: vector.x / length, z: vector.z / length } : { x: 0, z: 1 };
}

function rotate2(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: vector.x * cos + vector.z * sin, z: -vector.x * sin + vector.z * cos };
}

function normalize3(vector) {
  const length = length3(vector);
  if (!length) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function length3(vector) { return Math.hypot(vector.x, vector.y, vector.z); }
function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sub3(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function addScaled3(a, b, scale) { return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale }; }
function distanceSq3(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2; }
function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }
