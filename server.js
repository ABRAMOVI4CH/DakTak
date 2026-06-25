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

const players = {
  blue: createPlayer("blue", "field", -worldSize / 2 + 1.6, 0, -worldSize / 2 + 1.6),
  red: createPlayer("red", "field", worldSize / 2 - 1.6, 0, worldSize / 2 - 1.6),
  blueTower: createPlayer("blue", "tower", worldSize / 2 + wallOffset + wallWidth / 2, towerPlayerY, worldSize / 2 + wallOffset - wallLength * 0.55, "red"),
  redTower: createPlayer("red", "tower", -worldSize / 2 - wallOffset - wallWidth / 2, towerPlayerY, -worldSize / 2 - wallOffset + wallLength * 0.55, "blue"),
};

const score = { blue: 0, red: 0 };
const goalState = { blue: false, red: false };
const round = {
  status: "playing",
  resetAt: 0,
  startedAt: Date.now(),
};
let lastGoal = null;
let lastClientId = 0;

const clients = new Map();

wss.on("connection", (socket) => {
  const id = ++lastClientId;
  const client = {
    id,
    socket,
    activeId: null,
    input: { seq: 0, x: 0, y: 0, isRunning: true },
    lastProcessedSeq: 0,
    lastMessageAt: Date.now(),
  };

  clients.set(socket, client);
  send(socket, { type: "welcome", clientId: id });
  sendState(socket);

  socket.on("message", (raw) => {
    client.lastMessageAt = Date.now();
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "input") {
      client.input.seq = Number(message.seq) || client.input.seq;
      client.input.x = clamp(Number(message.x) || 0, -1, 1);
      client.input.y = clamp(Number(message.y) || 0, -1, 1);
      client.input.isRunning = Boolean(message.isRunning);

      if (!client.activeId) return;

      const slot = players[client.activeId];
      if (!slot) return;

      let yaw = Number(message.lookYaw) || 0;
      yaw = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (yaw > Math.PI) yaw -= Math.PI * 2;
      slot.lookYaw = yaw;
      slot.lookPitch = clamp(Number(message.lookPitch) || 0, -1.2, 0.42);
    }

    if (message.type === "joinSlot" && players[message.activeId]) {
      const occupyingClient = getClientByPlayerId(message.activeId);
      if (occupyingClient && occupyingClient !== client) {
        send(socket, { type: "slotRejected", activeId: message.activeId, reason: "occupied" });
        sendState(socket);
        return;
      }

      client.activeId = message.activeId;
      send(socket, { type: "activePlayer", activeId: client.activeId });
      broadcastState();
    }
  });

  socket.on("close", () => {
    clients.delete(socket);
    broadcastState();
  });
});

setInterval(() => updateGame(1 / tickRate), 1000 / tickRate);
setInterval(broadcastState, 1000 / sendRate);
setInterval(kickInactiveClients, 2000);

function kickInactiveClients() {
  const now = Date.now();
  clients.forEach((client, socket) => {
    if (!client.activeId) return;
    if (now - client.lastMessageAt > 10000) {
      send(socket, { type: "kicked", reason: "inactivity" });
      socket.close();
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
  };
}

function getClientByPlayerId(playerId) {
  return [...clients.values()].find((client) => client.activeId === playerId);
}

function updateGame(delta) {
  if (round.status === "goal") {
    if (Date.now() >= round.resetAt) {
      resetRound();
    }
    return;
  }

  if (round.status === "matchEnd") {
    if (Date.now() >= round.resetAt) {
      resetMatch();
    }
    return;
  }

  [...clients.values()].forEach((client) => {
    const slot = players[client.activeId];
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
    slot.y = slot.type === "tower" ? towerPlayerY : 0;
    client.lastProcessedSeq = client.input.seq;

    if (speed > 0.05) {
      slot.rotationY = Math.atan2(velocityX, velocityZ);
      slot.bodyTilt = Math.sin(Date.now() * 0.012) * 0.035;
    } else {
      slot.bodyTilt *= 0.84;
    }
  });

  updateGoals();
}

function updateGoals() {
  if (round.status !== "playing") return;

  const events = [
    getGoalEventForPlayer("blue", "red"),
    getGoalEventForPlayer("red", "blue"),
  ].filter(Boolean);

  const event = events[0];
  if (event && !goalState[event.team]) {
    goalState[event.team] = true;
    score[event.team] += event.points;
    lastGoal = {
      team: event.team,
      label: event.team === "blue" ? "ГОЛ СИНИХ" : "ГОЛ КРАСНЫХ",
      points: event.points,
      at: Date.now(),
    };

    if (score[event.team] >= matchPointLimit) {
      lastGoal.label = event.team === "blue" ? "СИНИЕ ПОБЕДИЛИ" : "КРАСНЫЕ ПОБЕДИЛИ";
      round.status = "matchEnd";
      round.resetAt = Date.now() + 5000;
    } else {
      round.status = "goal";
      round.resetAt = Date.now() + 5000;
    }
  }

  ["blue", "red"].forEach((team) => {
    if (!events.some((event) => event.team === team)) {
      goalState[team] = false;
    }
  });
}

function resetRound() {
  players.blue.x = -worldSize / 2 + 1.6;
  players.blue.y = 0;
  players.blue.z = -worldSize / 2 + 1.6;
  players.blue.rotationY = 0;
  players.blue.bodyTilt = 0;
  players.blue.lookYaw = 0;
  players.blue.lookPitch = 0;

  players.red.x = worldSize / 2 - 1.6;
  players.red.y = 0;
  players.red.z = worldSize / 2 - 1.6;
  players.red.rotationY = Math.PI;
  players.red.bodyTilt = 0;
  players.red.lookYaw = 0;
  players.red.lookPitch = 0;

  players.blueTower.x = worldSize / 2 + wallOffset + wallWidth / 2;
  players.blueTower.y = towerPlayerY;
  players.blueTower.z = worldSize / 2 + wallOffset - wallLength * 0.55;
  players.blueTower.rotationY = 0;
  players.blueTower.bodyTilt = 0;
  players.blueTower.lookYaw = 0;
  players.blueTower.lookPitch = 0;

  players.redTower.x = -worldSize / 2 - wallOffset - wallWidth / 2;
  players.redTower.y = towerPlayerY;
  players.redTower.z = -worldSize / 2 - wallOffset + wallLength * 0.55;
  players.redTower.rotationY = 0;
  players.redTower.bodyTilt = 0;
  players.redTower.lookYaw = 0;
  players.redTower.lookPitch = 0;

  goalState.blue = false;
  goalState.red = false;
  [...clients.values()].forEach((client) => {
    client.input.x = 0;
    client.input.y = 0;
    client.lastProcessedSeq = client.input.seq;
  });
  round.status = "playing";
  round.resetAt = 0;
  round.startedAt = Date.now();
  broadcastState();
}

function resetMatch() {
  score.blue = 0;
  score.red = 0;
  resetRound();
}

function getGoalEventForPlayer(scoringId, opponentId) {
  const scoringPlayer = players[scoringId];
  const opponent = players[opponentId];
  const isGoal = isPointInPlayerShadow(scoringPlayer.x, scoringPlayer.z, opponent, scoringPlayer);

  if (!isGoal) return null;

  return {
    team: scoringPlayer.color,
    points: isInBonusTriangle(scoringPlayer.x, scoringPlayer.z) ? 2 : 1,
  };
}

function isPointInPlayerShadow(x, z, targetPlayer, activePlayer) {
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

  return samples.some(([sampleX, sampleZ]) => isGroundPointShadowedByPlayer(sampleX, sampleZ, targetPlayer, activePlayer));
}

function isGroundPointShadowedByPlayer(x, z, targetPlayer, activePlayer) {
  const lightSlot = activePlayer.color === "blue" ? players.blueTower : players.redTower;
  const lightOrigin = getFlashlightOrigin(lightSlot);

  if (!isPointInsideLightCone(x, z, lightSlot, lightOrigin)) return false;

  const targetRadius = 0.58;
  if (Math.hypot(x - targetPlayer.x, z - targetPlayer.z) < targetRadius * 1.15) {
    return false;
  }

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

function getControlDirection(slot) {
  if (slot.type === "tower") return slot.corner === "blue" ? -1 : 1;
  return slot.color === "blue" ? -1 : 1;
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
  const xOnly = { x: currentX + deltaX, z: currentZ };
  const zOnly = { x: currentX, z: currentZ + deltaZ };
  const both = { x: currentX + deltaX, z: currentZ + deltaZ };

  if (isInsideTower(corner, both.x, both.z)) return both;
  if (stepLength === 0) return { x: currentX, z: currentZ };

  const canMoveX = isInsideTower(corner, xOnly.x, xOnly.z);
  const canMoveZ = isInsideTower(corner, zOnly.x, zOnly.z);

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

function broadcastState() {
  const state = getState();
  [...clients.keys()].forEach((socket) => sendState(socket, state));
}

function sendState(socket, state = getState()) {
  const client = clients.get(socket);
  send(socket, {
    type: "state",
    activeId: client?.activeId,
    ackSeq: client?.lastProcessedSeq ?? 0,
    ...state,
  });
}

function getState() {
  return {
    now: Date.now(),
    score,
    lastGoal,
    round,
    slots: Object.fromEntries(playerOrder.map((id) => [id, {
      occupied: Boolean(getClientByPlayerId(id)),
    }])),
    players: Object.fromEntries(
      Object.entries(players).map(([id, slot]) => [
        id,
        {
          x: slot.x,
          y: slot.y,
          z: slot.z,
          lookYaw: slot.lookYaw,
          lookPitch: slot.lookPitch,
          rotationY: slot.rotationY,
          bodyTilt: slot.bodyTilt,
        },
      ]),
    ),
  };
}

function send(socket, message) {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(message));
}

function normalize2(vector) {
  const length = Math.hypot(vector.x, vector.z);
  return length ? { x: vector.x / length, z: vector.z / length } : { x: 0, z: 1 };
}

function rotate2(vector, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: vector.x * cos + vector.z * sin,
    z: -vector.x * sin + vector.z * cos,
  };
}

function normalize3(vector) {
  const length = length3(vector);
  if (!length) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function length3(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addScaled3(a, b, scale) {
  return { x: a.x + b.x * scale, y: a.y + b.y * scale, z: a.z + b.z * scale };
}

function distanceSq3(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
