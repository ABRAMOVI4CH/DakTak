import * as THREE from "three";

const canvas = document.querySelector("#game");
const speedEl = document.querySelector("#speed");
const positionEl = document.querySelector("#position");
const scoreRedEl = document.querySelector("#scoreRed");
const scoreBlueEl = document.querySelector("#scoreBlue");
const scoreTimerEl = document.querySelector("#scoreTimer");
const hudTeamRedEl = document.querySelector("#hudTeamRed");
const hudTeamBlueEl = document.querySelector("#hudTeamBlue");
const pingEl = document.querySelector("#pingDisplay");
const joystickEl = document.querySelector("#joystick");
const stickEl = document.querySelector("#stick");
const lookPadEl = document.querySelector("#lookPad");
const multiplierEl = document.querySelector("#multiplier");
const preloaderEl = document.querySelector("#preloader");
const preloaderStatusEl = document.querySelector("#preloaderStatus");
const mainMenuEl = document.querySelector("#mainMenu");
const nicknameInputEl = document.querySelector("#nicknameInput");
const menuPlayBtn = document.querySelector("#menuPlay");
const menuSettingsBtn = document.querySelector("#menuSettings");
const settingsPanelEl = document.querySelector("#settingsPanel");
const settingsBackBtn = document.querySelector("#settingsBack");
const settingMusicVolEl = document.querySelector("#settingMusicVol");
const settingVoiceVolEl = document.querySelector("#settingVoiceVol");
const voiceSpeakersEl = document.querySelector("#voiceSpeakers");
const voiceMicBtn = document.querySelector("#voiceMicBtn");

// Room UI
const roomBrowserEl = document.querySelector("#roomBrowser");
const roomBrowserBackBtn = document.querySelector("#roomBrowserBack");
const roomNameInputEl = document.querySelector("#roomNameInput");
const roomCreateBtn = document.querySelector("#roomCreateBtn");
const roomListEl = document.querySelector("#roomList");
const roomLobbyEl = document.querySelector("#roomLobby");
const roomLobbyNameEl = document.querySelector("#roomLobbyName");
const roomLobbyBackBtn = document.querySelector("#roomLobbyBack");
const roomLobbyStatusEl = document.querySelector("#roomLobbyStatus");
const devStartBtn = document.querySelector("#devStartBtn");
const lobbySlots = document.querySelectorAll("[data-lobby-slot]");

const pingTracker = {
  sentTimes: new Map(),
  value: null,
};

const bgMusic = new Audio("/music.mp3");
bgMusic.loop = true;
bgMusic.volume = parseFloat(localStorage.getItem("daktak_musicVol") ?? "0.55");
let musicStarted = false;
let musicBaseVolume = bgMusic.volume;
let musicDuckRaf = null;
const MUSIC_DUCK_FACTOR = 0.05;
const MUSIC_DUCK_MS = 120;

let localNickname = localStorage.getItem("daktak_nickname") || "";
let localClientId = null;
const voiceState = {
  localStream: null,
  peers: new Map(),
  isTalking: false,
  speakers: new Map(),
  voiceVolume: parseFloat(localStorage.getItem("daktak_voiceVol") ?? "0.8"),
};

let wasKicked = false;

const tileCount = 12;
const tileSize = 2;
const tileGap = 0;
const worldSize = tileCount * tileSize;
const bonusLegLength = tileSize * 5.6;
const wallLength = tileSize * 5.6;
const wallHeight = tileSize * 3.5;
const wallWidth = tileSize;
const wallOffset = 0.22;
const towerPlayerY = wallHeight + 0.15;
const playerOrder = ["blue", "red", "blueTower", "redTower"];
const player = {
  speed: 0,
  maxWalkSpeed: 4.2,
  maxRunSpeed: 7.2,
  isRunning: true,
  activeId: "blue",
  isTopCamera: false,
  hasJoined: false,
};
const lineMaterials = {};
const lineGlowMeshes = [];
const tileMaterials = [];
const ceilingLights = [];
const towerFlashlights = [];
const score = {
  blue: 0,
  red: 0,
};
const goalState = {
  blue: false,
  red: false,
  messageUntil: 0,
};
const network = {
  socket: null,
  connected: false,
  lastGoalAt: 0,
  roundStatus: "playing",
  roundStartedAt: 0,
  serverTimeOffset: 0,
  inputSeq: 0,
  pendingInputs: [],
  lastInputSentAt: 0,
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080808);
scene.fog = new THREE.Fog(0x080808, 18, 44);

const camera = new THREE.PerspectiveCamera(82, 1, 0.1, 100);
camera.position.set(0, 14, 14);
camera.lookAt(0, 0, 0);

const hemiLight = new THREE.HemisphereLight(0xf2f2f2, 0x050505, 0);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xffffff, 0);
sun.position.set(0, 18, 0.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.camera.left = -18;
sun.shadow.camera.right = 18;
sun.shadow.camera.top = 18;
sun.shadow.camera.bottom = -18;
scene.add(sun);

const hallFillLight = new THREE.AmbientLight(0xffffff, 0.14);
scene.add(hallFillLight);

const ceilingLightRig = createCeilingLights();
scene.add(ceilingLightRig);

const floor = createTileFloor();
scene.add(floor);

const concreteAprons = createConcreteAprons();
scene.add(concreteAprons);

const bonusPads = createBonusPads();
scene.add(bonusPads);

const contactMarker = createContactMarker();
scene.add(contactMarker);

const border = createBorder();
scene.add(border);

const cornerWalls = createCornerWalls();
scene.add(cornerWalls);

const players = {
  blue: {
    avatar: createAvatar(0x6478dd),
    color: "blue",
    label: "Синий",
    type: "field",
    velocity: new THREE.Vector2(),
  },
  red: {
    avatar: createAvatar(0xd83b44),
    color: "red",
    label: "Красный",
    type: "field",
    velocity: new THREE.Vector2(),
  },
  blueTower: {
    avatar: createAvatar(0x6478dd),
    color: "blue",
    label: "Синий башня",
    type: "tower",
    corner: "red",
    velocity: new THREE.Vector2(),
  },
  redTower: {
    avatar: createAvatar(0xd83b44),
    color: "red",
    label: "Красный башня",
    type: "tower",
    corner: "blue",
    velocity: new THREE.Vector2(),
  },
};
Object.entries(players).forEach(([id, slot]) => {
  slot.id = id;
  slot.lookYaw = 0;
  slot.lookPitch = 0;
  slot.serverPosition = new THREE.Vector3();
  slot.serverRotationY = 0;
  slot.serverBodyTilt = 0;
  slot.hasServerState = false;
});
players.blue.avatar.position.set(-4, 0, -4);
players.red.avatar.position.set(4, 0, 4);
players.blueTower.avatar.position.set(worldSize / 2 + wallOffset + wallWidth / 2, towerPlayerY, worldSize / 2 + wallOffset - wallLength * 0.55);
players.redTower.avatar.position.set(-worldSize / 2 - wallOffset - wallWidth / 2, towerPlayerY, -worldSize / 2 - wallOffset + wallLength * 0.55);
scene.add(players.blue.avatar, players.red.avatar, players.blueTower.avatar, players.redTower.avatar);
addTowerFlashlight(players.blueTower);
addTowerFlashlight(players.redTower);
connectToServer();

const clock = new THREE.Clock();

const cheat = { buffer: "", tiny: false, targetScale: 1, currentScale: 1 };
document.addEventListener("keydown", (e) => {
  if (!player.hasJoined) return;
  cheat.buffer += e.key;
  if (cheat.buffer.length > 3) cheat.buffer = cheat.buffer.slice(-3);
  if (cheat.buffer === "228") {
    cheat.tiny = !cheat.tiny;
    cheat.targetScale = cheat.tiny ? 0.07 : 1;
    cheat.buffer = "";
  }
});

const input = {
  pointerId: null,
  x: 0,
  y: 0,
};
const lookInput = {
  pointerId: null,
  lastX: 0,
  lastY: 0,
};

const isDesktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
const keys = { w: false, a: false, s: false, d: false };
const pointerHintEl = document.querySelector("#pointerHint");
let isPointerLocked = false;

// Nickname & Main Menu
nicknameInputEl.value = localNickname;
settingMusicVolEl.value = Math.round(bgMusic.volume * 100);
settingVoiceVolEl.value = Math.round(voiceState.voiceVolume * 100);

function saveNicknameAndSend() {
  localNickname = nicknameInputEl.value.trim().slice(0, 16);
  if (!localNickname) return false;
  localStorage.setItem("daktak_nickname", localNickname);
  if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "nickname", nickname: localNickname }));
  }
  return true;
}

menuPlayBtn.addEventListener("click", () => {
  if (!saveNicknameAndSend()) {
    nicknameInputEl.focus();
    nicknameInputEl.style.borderColor = "#d83b44";
    setTimeout(() => nicknameInputEl.style.borderColor = "", 600);
    return;
  }
  mainMenuEl.classList.add("hidden");
  roomBrowserEl.classList.remove("hidden");
  if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "listRooms" }));
  }
});

menuSettingsBtn.addEventListener("click", () => {
  settingsPanelEl.classList.remove("hidden");
});

settingsBackBtn.addEventListener("click", () => {
  settingsPanelEl.classList.add("hidden");
});

settingMusicVolEl.addEventListener("input", () => {
  const vol = settingMusicVolEl.value / 100;
  musicBaseVolume = vol;
  bgMusic.volume = voiceState.speakers.size > 0 ? vol * MUSIC_DUCK_FACTOR : vol;
  localStorage.setItem("daktak_musicVol", vol);
});

settingVoiceVolEl.addEventListener("input", () => {
  voiceState.voiceVolume = settingVoiceVolEl.value / 100;
  localStorage.setItem("daktak_voiceVol", voiceState.voiceVolume);
  voiceState.peers.forEach((peer) => {
    if (peer.audioEl) peer.audioEl.volume = voiceState.voiceVolume;
  });
});

// Room Browser
roomBrowserBackBtn.addEventListener("click", () => {
  roomBrowserEl.classList.add("hidden");
  mainMenuEl.classList.remove("hidden");
});

roomCreateBtn.addEventListener("click", () => {
  const name = roomNameInputEl.value.trim() || `Комната ${localNickname}`;
  if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "createRoom", name }));
  }
});

// Room Lobby
roomLobbyBackBtn.addEventListener("click", () => {
  if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "leaveRoom" }));
  }
  roomLobbyEl.classList.add("hidden");
  roomBrowserEl.classList.remove("hidden");
});

lobbySlots.forEach((btn) => {
  btn.addEventListener("click", () => {
    const slotId = btn.dataset.lobbySlot;
    if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
      network.socket.send(JSON.stringify({ type: "pickSlot", slotId }));
    }
  });
});

devStartBtn.addEventListener("click", () => {
  if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "devStart" }));
  }
});

if (isDesktop) {
  canvas.addEventListener("click", () => {
    if (player.hasJoined) canvas.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    isPointerLocked = document.pointerLockElement === canvas;
    pointerHintEl?.classList.toggle("locked", isPointerLocked);
  });

  document.addEventListener("mousemove", (event) => {
    if (!isPointerLocked || !player.hasJoined) return;
    const activePlayer = players[player.activeId];
    if (!activePlayer) return;
    activePlayer.lookYaw -= event.movementX * 0.004;
    activePlayer.lookYaw = ((activePlayer.lookYaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (activePlayer.lookYaw > Math.PI) activePlayer.lookYaw -= Math.PI * 2;
    activePlayer.lookPitch = clamp(activePlayer.lookPitch - event.movementY * 0.004, -1.2, 0.42);
    sendInputToServer();
  });

  document.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code === "KeyW" || event.code === "ArrowUp") keys.w = true;
    if (event.code === "KeyA" || event.code === "ArrowLeft") keys.a = true;
    if (event.code === "KeyS" || event.code === "ArrowDown") keys.s = true;
    if (event.code === "KeyD" || event.code === "ArrowRight") keys.d = true;
  });

  document.addEventListener("keyup", (event) => {
    if (event.code === "KeyW" || event.code === "ArrowUp") keys.w = false;
    if (event.code === "KeyA" || event.code === "ArrowLeft") keys.a = false;
    if (event.code === "KeyS" || event.code === "ArrowDown") keys.s = false;
    if (event.code === "KeyD" || event.code === "ArrowRight") keys.d = false;
  });

  document.addEventListener("keydown", (event) => {
    if (event.code === "KeyK" && !event.repeat && player.hasJoined) {
      voiceSetTalking(true);
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.code === "KeyK") {
      voiceSetTalking(false);
    }
  });
} else {
  joystickEl.addEventListener("pointerdown", (event) => {
    input.pointerId = event.pointerId;
    joystickEl.setPointerCapture(event.pointerId);
    updateJoystick(event);
  });

  joystickEl.addEventListener("pointermove", (event) => {
    if (event.pointerId !== input.pointerId) return;
    updateJoystick(event);
  });

  joystickEl.addEventListener("pointerup", resetJoystick);
  joystickEl.addEventListener("pointercancel", resetJoystick);

  lookPadEl.addEventListener("pointerdown", (event) => {
    lookInput.pointerId = event.pointerId;
    lookInput.lastX = event.clientX;
    lookInput.lastY = event.clientY;
    lookPadEl.setPointerCapture(event.pointerId);
  });

  lookPadEl.addEventListener("pointermove", (event) => {
    if (event.pointerId !== lookInput.pointerId) return;
    const deltaX = event.clientX - lookInput.lastX;
    const deltaY = event.clientY - lookInput.lastY;
    const activePlayer = players[player.activeId];

    activePlayer.lookYaw -= deltaX * 0.006;
    activePlayer.lookYaw = ((activePlayer.lookYaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (activePlayer.lookYaw > Math.PI) activePlayer.lookYaw -= Math.PI * 2;
    activePlayer.lookPitch = clamp(activePlayer.lookPitch - deltaY * 0.006, -1.2, 0.42);
    lookInput.lastX = event.clientX;
    lookInput.lastY = event.clientY;
    sendInputToServer();
  });

  lookPadEl.addEventListener("pointerup", resetLookPad);
  lookPadEl.addEventListener("pointercancel", resetLookPad);

  voiceMicBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    voiceSetTalking(true);
  });
  voiceMicBtn.addEventListener("pointerup", () => voiceSetTalking(false));
  voiceMicBtn.addEventListener("pointercancel", () => voiceSetTalking(false));
}

window.addEventListener("resize", resize);
resize();
animate();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.04);

  if (isDesktop) {
    const dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    const dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);
    const len = Math.hypot(dx, dy);
    input.x = len ? dx / len : 0;
    input.y = len ? dy / len : 0;
  }

  syncAvatarVisibility();
  updatePlayer(delta);
  interpolateServerPlayers(delta);
  updateCheatScale(delta);
  updateCamera(delta);
  updateTowerFlashlights();
  updateScoreTimer();
  if (!network.connected) {
    updateGlobalGoalState();
  }
  updateContactMarker();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function updatePlayer(delta) {
  const activePlayer = players[player.activeId];
  const maxSpeed = player.isRunning ? player.maxRunSpeed : player.maxWalkSpeed;
  player.speed = player.hasJoined && (input.y || input.x) ? maxSpeed * Math.min(Math.hypot(input.x, input.y), 1) : 0;

  if (!player.hasJoined) {
    updateDebugHud(activePlayer);
    return;
  }

  if (network.connected) {
    const command = {
      seq: ++network.inputSeq,
      delta,
      x: input.x,
      y: input.y,
      isRunning: player.isRunning,
      lookYaw: activePlayer.lookYaw,
      lookPitch: activePlayer.lookPitch,
    };

    applyInputLocally(activePlayer, command, delta);
    network.pendingInputs.push(command);
    if (network.pendingInputs.length > 120) {
      network.pendingInputs.splice(0, network.pendingInputs.length - 120);
    }
    sendInputToServer(command);

    updateDebugHud(activePlayer);
    return;
  }

  applyInputLocally(activePlayer, { x: input.x, y: input.y, isRunning: player.isRunning }, delta);

  updateDebugHud(activePlayer);
}

function updateDebugHud(activePlayer) {
  if (speedEl) speedEl.textContent = Math.round(player.speed * 10) / 10;
  if (positionEl) positionEl.textContent = `${activePlayer.avatar.position.x.toFixed(1)}:${activePlayer.avatar.position.z.toFixed(1)}`;
}

function applyInputLocally(slot, command, delta) {
  const maxSpeed = command.isRunning ? player.maxRunSpeed : player.maxWalkSpeed;
  const speed = command.y || command.x ? maxSpeed * Math.min(Math.hypot(command.x, command.y), 1) : 0;
  const lookDir = getSlotLookDirection(slot);
  const fwdX = lookDir.x;
  const fwdZ = lookDir.z;
  const moveX = (-command.y) * fwdX - command.x * fwdZ;
  const moveZ = (-command.y) * fwdZ + command.x * fwdX;
  const moveLen = Math.hypot(moveX, moveZ);

  slot.velocity.set(
    moveLen > 0.001 ? (moveX / moveLen) * speed : 0,
    moveLen > 0.001 ? (moveZ / moveLen) * speed : 0,
  );

  const nextPosition = movePlayerWithBarriers(
    slot,
    slot.avatar.position.x,
    slot.avatar.position.z,
    slot.velocity.x * delta,
    slot.velocity.y * delta,
  );

  slot.avatar.position.x = nextPosition.x;
  slot.avatar.position.z = nextPosition.z;
  slot.avatar.position.y = slot.type === "tower" ? towerPlayerY : 0;

  if (speed > 0.05) {
    slot.avatar.rotation.y = Math.atan2(slot.velocity.x, slot.velocity.y);
    slot.avatar.children[0].rotation.z = Math.sin(clock.elapsedTime * 12) * 0.035;
  } else {
    slot.avatar.children[0].rotation.z *= 0.84;
  }
}

function updateCamera(delta) {
  if (player.isTopCamera || network.roundStatus === "goal" || network.roundStatus === "matchEnd") {
    const cameraTarget = new THREE.Vector3(0, wallHeight + 24, 0.02);
    camera.position.lerp(cameraTarget, 1 - Math.pow(0.001, delta));
    camera.lookAt(0, 0, 0);
    return;
  }

  const activePlayer = players[player.activeId];
  const activeAvatar = activePlayer.avatar;
  const cameraTarget = new THREE.Vector3(activeAvatar.position.x, activeAvatar.position.y + 2.35, activeAvatar.position.z);
  const lookTarget = getLookTarget(activePlayer, cameraTarget, activePlayer.type === "tower" ? 12 : 8);

  camera.position.lerp(cameraTarget, 1 - Math.pow(0.001, delta));
  camera.lookAt(lookTarget);
}

function updateJoystick(event) {
  const rect = joystickEl.getBoundingClientRect();
  const radius = rect.width / 2;
  const centerX = rect.left + radius;
  const centerY = rect.top + radius;
  const rawX = event.clientX - centerX;
  const rawY = event.clientY - centerY;
  const distance = Math.min(Math.hypot(rawX, rawY), radius - 29);
  const angle = Math.atan2(rawY, rawX);
  const stickX = Math.cos(angle) * distance;
  const stickY = Math.sin(angle) * distance;

  input.x = stickX / (radius - 29);
  input.y = stickY / (radius - 29);
  stickEl.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;
}

function resetJoystick(event) {
  if (event.pointerId !== input.pointerId) return;
  input.pointerId = null;
  input.x = 0;
  input.y = 0;
  stickEl.style.transform = "translate(-50%, -50%)";
}

function resetLookPad(event) {
  if (event.pointerId !== lookInput.pointerId) return;
  lookInput.pointerId = null;
}

function getControlDirection(slot) {
  if (slot.type === "tower") {
    return slot.corner === "blue" ? -1 : 1;
  }

  return slot.color === "blue" ? -1 : 1;
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function connectToServer() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  network.socket = socket;

  socket.addEventListener("open", () => {
    network.connected = true;
    if (localNickname && network.socket?.readyState === WebSocket.OPEN) {
      network.socket.send(JSON.stringify({ type: "nickname", nickname: localNickname }));
    }
    if (preloaderEl) {
      preloaderStatusEl.textContent = "Соединение установлено";
      setTimeout(() => {
        preloaderEl.classList.add("fade-out");
        preloaderEl.addEventListener("transitionend", () => preloaderEl.remove(), { once: true });
        mainMenuEl.classList.remove("hidden");
      }, 500);
    } else if (!player.hasJoined) {
      // Show whatever screen is appropriate
      if (!roomLobbyEl.classList.contains("hidden") || !roomBrowserEl.classList.contains("hidden")) {
        // Already showing a room screen
      } else {
        mainMenuEl.classList.remove("hidden");
      }
    }
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "welcome") {
      localClientId = message.clientId;
      return;
    }

    if (message.type === "roomList") {
      renderRoomList(message.rooms);
      return;
    }

    if (message.type === "roomJoined") {
      roomBrowserEl.classList.add("hidden");
      mainMenuEl.classList.add("hidden");
      roomLobbyEl.classList.remove("hidden");
      roomLobbyNameEl.textContent = message.roomName;
      return;
    }

    if (message.type === "roomError") {
      // Could show toast, for now just log
      return;
    }

    if (message.type === "lobbyState") {
      updateLobbyUI(message);
      return;
    }

    if (message.type === "gameStarted") {
      roomLobbyEl.classList.add("hidden");
      setActivePlayer(message.activeId, true);
      sendInputToServer();
      voiceMicBtn.classList.remove("hidden");
      initVoice();
      return;
    }

    if (message.type === "backToLobby") {
      player.hasJoined = false;
      updateTeamBadge();
      voiceDisconnectAll();
      voiceMicBtn.classList.add("hidden");
      roomBrowserEl.classList.remove("hidden");
      return;
    }

    if (message.type === "kicked") {
      wasKicked = true;
      player.hasJoined = false;
      updateTeamBadge();
      voiceDisconnectAll();
      return;
    }

    if (message.type === "slotRejected") {
      return;
    }

    if (message.type === "voiceTalking") {
      handleVoiceTalkingMessage(message);
      return;
    }

    if (message.type === "voiceOffer") {
      handleVoiceOffer(message);
      return;
    }

    if (message.type === "voiceAnswer") {
      handleVoiceAnswer(message);
      return;
    }

    if (message.type === "voiceIce") {
      handleVoiceIce(message);
      return;
    }

    if (message.type === "voiceLeft") {
      voiceRemovePeer(message.clientId);
      return;
    }

    if (message.type === "state") {
      network.connected = true;
      applyServerState(message);
    }
  });

  socket.addEventListener("close", () => {
    network.connected = false;
    pingTracker.value = null;
    updatePingDisplay();

    if (preloaderEl) {
      preloaderStatusEl.textContent = "Сервер недоступен";
      preloaderStatusEl.classList.add("error");
      return;
    }

    voiceDisconnectAll();
    voiceMicBtn.classList.add("hidden");

    // Hide all overlays
    roomBrowserEl.classList.add("hidden");
    roomLobbyEl.classList.add("hidden");

    if (wasKicked) {
      wasKicked = false;
      player.hasJoined = false;
      updateTeamBadge();
    } else if (player.hasJoined) {
      player.hasJoined = false;
      updateTeamBadge();
    }

    mainMenuEl.classList.remove("hidden");
    setTimeout(connectToServer, 2000);
  });

  socket.addEventListener("error", () => {
    network.connected = false;
    if (preloaderEl) {
      preloaderStatusEl.textContent = "Ошибка соединения";
      preloaderStatusEl.classList.add("error");
    }
  });
}

// Room UI rendering
function renderRoomList(roomsData) {
  roomListEl.innerHTML = "";
  if (!roomsData || roomsData.length === 0) {
    roomListEl.innerHTML = '<div class="room-list-empty">Нет комнат — создай первую!</div>';
    return;
  }
  roomsData.forEach((r) => {
    const item = document.createElement("div");
    item.className = `room-list-item${r.status === "playing" ? " room-playing" : ""}`;
    item.innerHTML = `<div><span class="room-item-name">${escapeHtml(r.name)}</span>${r.status === "playing" ? '<span class="room-item-status">В игре</span>' : ""}</div><span class="room-item-count">${r.playerCount}/4</span>`;
    item.addEventListener("click", () => {
      if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
        network.socket.send(JSON.stringify({ type: "joinRoom", roomId: r.id }));
      }
    });
    roomListEl.appendChild(item);
  });
}

function updateLobbyUI(state) {
  roomLobbyNameEl.textContent = state.roomName;

  const slotMap = { blue: "lobbySlotBlue", red: "lobbySlotRed", blueTower: "lobbySlotBlueTower", redTower: "lobbySlotRedTower" };
  lobbySlots.forEach((btn) => {
    const slotId = btn.dataset.lobbySlot;
    const slot = state.slots[slotId];
    const nickEl = btn.querySelector(".lobby-slot-nick");
    const isMine = slot?.clientId === localClientId;
    const isEmpty = !slot?.occupied;

    btn.classList.toggle("slot-empty", isEmpty);
    btn.classList.toggle("slot-mine", isMine);
    nickEl.textContent = isEmpty ? "Свободно" : (slot.nickname || "???");
  });

  const count = state.playerCount || 0;
  if (count >= 4) {
    roomLobbyStatusEl.textContent = "Все на месте! Запуск...";
  } else {
    roomLobbyStatusEl.textContent = `Ожидание игроков ${count}/4`;
  }

  devStartBtn.classList.toggle("hidden", !state.isAdmin);
}

function sendInputToServer(command = null) {
  if (!player.hasJoined || !network.connected || network.socket?.readyState !== WebSocket.OPEN) return;

  const activePlayer = players[player.activeId];
  const payload = command ?? {
    seq: network.inputSeq,
    x: input.x,
    y: input.y,
    isRunning: player.isRunning,
    lookYaw: activePlayer.lookYaw,
    lookPitch: activePlayer.lookPitch,
  };

  const seq = payload.seq;
  pingTracker.sentTimes.set(seq, performance.now());
  if (pingTracker.sentTimes.size > 60) {
    const oldest = [...pingTracker.sentTimes.keys()].sort((a, b) => a - b)[0];
    pingTracker.sentTimes.delete(oldest);
  }

  network.socket.send(JSON.stringify({
    type: "input",
    seq,
    x: payload.x,
    y: payload.y,
    isRunning: payload.isRunning,
    lookYaw: payload.lookYaw ?? activePlayer.lookYaw,
    lookPitch: payload.lookPitch ?? activePlayer.lookPitch,
  }));
}

function applyServerState(state) {
  if (state.now) {
    network.serverTimeOffset = state.now - Date.now();
  }

  if (state.ackSeq != null) {
    const sentAt = pingTracker.sentTimes.get(state.ackSeq);
    if (sentAt != null) {
      pingTracker.value = Math.round(performance.now() - sentAt);
      pingTracker.sentTimes.delete(state.ackSeq);
      updatePingDisplay();
    }
  }

  if (state.activeId && state.activeId !== player.activeId) {
    setActivePlayer(state.activeId, true);
  }


  Object.entries(state.players ?? {}).forEach(([id, data]) => {
    const slot = players[id];
    if (!slot) return;

    slot.serverPosition.set(data.x, data.y, data.z);
    slot.serverRotationY = data.rotationY ?? slot.serverRotationY;
    slot.serverBodyTilt = data.bodyTilt ?? 0;
    slot.hasServerState = true;

    if (id === player.activeId && player.hasJoined) {
      reconcileActivePlayer(slot, state.ackSeq ?? 0);
    } else if (!slot.hasInterpolatedOnce) {
      slot.avatar.position.copy(slot.serverPosition);
      slot.avatar.rotation.y = slot.serverRotationY;
      slot.avatar.children[0].rotation.z = slot.serverBodyTilt;
      slot.hasInterpolatedOnce = true;
    }

    if (id !== player.activeId || !player.hasJoined) {
      slot.lookYaw = data.lookYaw ?? slot.lookYaw;
      slot.lookPitch = data.lookPitch ?? slot.lookPitch;
    }
  });

  if (state.score) {
    score.blue = state.score.blue;
    score.red = state.score.red;
    updateScore();
  }

  voiceConnectToNewPeers(state.voiceClients);

  const previousRoundStatus = network.roundStatus;
  const nextRoundStatus = state.round?.status ?? "playing";
  const nextRoundStartedAt = state.round?.startedAt ?? 0;
  const isNewRound = nextRoundStartedAt && network.roundStartedAt && nextRoundStartedAt !== network.roundStartedAt;
  network.roundStatus = nextRoundStatus;
  network.roundStartedAt = nextRoundStartedAt || network.roundStartedAt;

  if (isNewRound) {
    resetViewForNewRound(state.players ?? {});
    multiplierEl.textContent = "НОВЫЙ\nРАУНД";
    multiplierEl.classList.remove("goal-blue", "goal-red");
    multiplierEl.classList.add("visible");
    goalState.messageUntil = clock.elapsedTime + 1.4;
  }

  if (!isNewRound && state.lastGoal?.at && state.lastGoal.at !== network.lastGoalAt) {
    network.lastGoalAt = state.lastGoal.at;
    multiplierEl.textContent = network.roundStatus === "matchEnd"
      ? (state.lastGoal.team === "blue" ? "СИНИЕ\nПОБЕДИЛИ" : "КРАСНЫЕ\nПОБЕДИЛИ")
      : `${state.lastGoal.team === "blue" ? "ГОЛ\nСИНИХ" : "ГОЛ\nКРАСНЫХ"}${state.lastGoal.points === 2 ? "\nx2" : ""}`;
    multiplierEl.classList.toggle("goal-blue", state.lastGoal.team === "blue");
    multiplierEl.classList.toggle("goal-red", state.lastGoal.team === "red");
    multiplierEl.classList.add("visible");
    goalState.messageUntil = clock.elapsedTime + 5;
  } else if (previousRoundStatus !== "goal" && previousRoundStatus !== "matchEnd" && network.roundStatus !== "goal" && network.roundStatus !== "matchEnd" && clock.elapsedTime > goalState.messageUntil) {
    multiplierEl.classList.remove("visible");
  }
}

function resetViewForNewRound(serverPlayers) {
  network.pendingInputs.length = 0;

  Object.entries(players).forEach(([id, slot]) => {
    const data = serverPlayers[id];
    slot.lookYaw = data?.lookYaw ?? 0;
    slot.lookPitch = data?.lookPitch ?? 0;
    slot.hasInterpolatedOnce = false;
    if (data) {
      slot.avatar.position.set(data.x, data.y, data.z);
      slot.serverPosition.copy(slot.avatar.position);
      slot.avatar.rotation.y = data.rotationY ?? 0;
      slot.avatar.children[0].rotation.z = 0;
    }
  });
}

function reconcileActivePlayer(slot, ackSeq) {
  network.pendingInputs = network.pendingInputs.filter((cmd) => cmd.seq > ackSeq);

  if (network.roundStatus === "goal") {
    slot.avatar.position.copy(slot.serverPosition);
    slot.avatar.rotation.y = slot.serverRotationY;
    slot.avatar.children[0].rotation.z = slot.serverBodyTilt;
    network.pendingInputs.length = 0;
    return;
  }

  // Re-simulate from authoritative server position applying all unacknowledged inputs.
  // With correct prediction this produces a position very close to current, so correction is invisible.
  let px = slot.serverPosition.x;
  let pz = slot.serverPosition.z;
  const savedYaw = slot.lookYaw;

  for (const cmd of network.pendingInputs) {
    slot.lookYaw = cmd.lookYaw;
    const lookDir = getSlotLookDirection(slot);
    const fwdX = lookDir.x;
    const fwdZ = lookDir.z;
    const moveX = (-cmd.y) * fwdX - cmd.x * fwdZ;
    const moveZ = (-cmd.y) * fwdZ + cmd.x * fwdX;
    const moveLen = Math.hypot(moveX, moveZ);
    const maxSpeed = cmd.isRunning ? player.maxRunSpeed : player.maxWalkSpeed;
    const speed = (cmd.y || cmd.x) ? maxSpeed * Math.min(Math.hypot(cmd.x, cmd.y), 1) : 0;
    const vx = moveLen > 0.001 ? (moveX / moveLen) * speed : 0;
    const vz = moveLen > 0.001 ? (moveZ / moveLen) * speed : 0;
    const next = movePlayerWithBarriers(slot, px, pz, vx * cmd.delta, vz * cmd.delta);
    px = next.x;
    pz = next.z;
  }

  slot.lookYaw = savedYaw;

  const dx = px - slot.avatar.position.x;
  const dz = pz - slot.avatar.position.z;
  const err = Math.hypot(dx, dz);

  if (err > 2.5) {
    slot.avatar.position.x = px;
    slot.avatar.position.z = pz;
  } else if (err > 0.015) {
    slot.avatar.position.x += dx * 0.25;
    slot.avatar.position.z += dz * 0.25;
  }
}

function interpolateServerPlayers(delta) {
  const t = 1 - Math.pow(0.0006, delta);

  Object.entries(players).forEach(([id, slot]) => {
    if (!slot.hasServerState || id === player.activeId) return;

    slot.avatar.position.lerp(slot.serverPosition, t);
    slot.avatar.rotation.y = lerpAngle(slot.avatar.rotation.y, slot.serverRotationY, t);
    slot.avatar.children[0].rotation.z += (slot.serverBodyTilt - slot.avatar.children[0].rotation.z) * t;
  });
}

function createCeilingLights() {
  const group = new THREE.Group();
  const lightHeight = wallHeight + 8;
  const offset = worldSize * 0.28;
  const positions = [
    [-offset, lightHeight, -offset],
    [offset, lightHeight, -offset],
    [-offset, lightHeight, offset],
    [offset, lightHeight, offset],
  ];

  positions.forEach(([x, y, z]) => {
    const light = new THREE.PointLight(0xffffff, 4, worldSize * 2.5, 1.05);
    light.position.set(x, y, z);
    light.castShadow = false;
    ceilingLights.push(light);
    group.add(light);
  });

  return group;
}

function addTowerFlashlight(slot) {
  const light = new THREE.SpotLight(0xffffff, 15.5, worldSize * 4, 0.16, 0.12, 0.2);
  const target = new THREE.Object3D();

  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.near = 0.2;
  light.shadow.camera.far = worldSize * 4;
  light.shadow.focus = 1;
  light.shadow.radius = 0.8;
  light.shadow.bias = -0.00005;
  light.shadow.normalBias = 0.01;
  light.visible = true;
  light.target = target;
  scene.add(light, target);

  slot.flashlight = { light, target };
  towerFlashlights.push(slot);
}

function createAvatar(color) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.04,
  });

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.58, 1.45, 14, 28),
    material,
  );
  body.position.y = 1.23;
  body.castShadow = true;
  body.receiveShadow = true;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.72, 28),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.018;
  shadow.scale.set(1, 0.72, 1);

  group.add(body, shadow);
  group.userData.bodyMaterial = material;
  group.userData.body = body;
  group.userData.floorShadow = shadow;
  group.position.set(0, 0, 0);
  return group;
}

function createContactMarker() {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.7, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );

  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.105;
  marker.renderOrder = 8;
  return marker;
}

function createShadowDebugMarker() {
  const geometry = new THREE.BufferGeometry();
  const marker = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x32ff57,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    }),
  );

  marker.renderOrder = 9;
  marker.visible = false;
  return marker;
}

function updateContactMarker() {
  const activePlayer = players[player.activeId];
  contactMarker.visible = activePlayer.type === "field";

  if (!contactMarker.visible) return;

  contactMarker.material.color.set(activePlayer.color === "blue" ? 0x6478dd : 0xd83b44);
  contactMarker.position.x = activePlayer.avatar.position.x;
  contactMarker.position.z = activePlayer.avatar.position.z;
}

function updateShadowDebugMarker() {
  const activePlayer = players[player.activeId];

  if (activePlayer.type !== "field") {
    shadowDebugMarker.visible = false;
    return;
  }

  const opponent = activePlayer.id === "blue" ? players.red : players.blue;
  const segments = getPlayerShadowBoundarySegments(opponent, activePlayer);

  if (!segments.length) {
    shadowDebugMarker.visible = false;
    return;
  }

  shadowDebugMarker.geometry.dispose();
  shadowDebugMarker.geometry = new THREE.BufferGeometry().setFromPoints(segments);
  shadowDebugMarker.visible = true;
}

function getLookDirection(color) {
  const direction = color === "blue" ? 1 : -1;
  return new THREE.Vector3(direction, 0, direction).normalize();
}

function getSlotLookDirection(slot) {
  if (slot.type === "tower") {
    const direction = slot.corner === "blue" ? 1 : -1;
    return new THREE.Vector3(direction, 0, direction)
      .normalize()
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.lookYaw);
  }

  return getLookDirection(slot.color).applyAxisAngle(new THREE.Vector3(0, 1, 0), slot.lookYaw);
}

function getLookTarget(slot, origin, distance) {
  const direction = getSlotLookDirection(slot);
  const basePitch = slot.type === "tower" ? -0.86 : -0.06;
  const pitch = clamp(basePitch + slot.lookPitch, -1.38, 0.35);
  const horizontalDistance = Math.cos(pitch) * distance;

  return new THREE.Vector3(
    origin.x + direction.x * horizontalDistance,
    origin.y + Math.sin(pitch) * distance,
    origin.z + direction.z * horizontalDistance,
  );
}

function updateTowerFlashlights() {
  towerFlashlights.forEach((slot) => {
    const { light, target } = slot.flashlight;
    const origin = getFlashlightOrigin(slot);
    const lookTarget = getLookTarget(slot, origin, worldSize * 0.9);

    light.position.copy(origin);
    target.position.copy(lookTarget);
    target.updateMatrixWorld();
    light.updateMatrixWorld();
    light.visible = true;
  });
}

function setActivePlayer(id, hasJoined = player.hasJoined) {
  player.activeId = id;
  player.hasJoined = hasJoined;
  const activePlayer = players[id];

  if (hasJoined && !musicStarted) {
    musicStarted = true;
    bgMusic.play().catch(() => {});
  }

  cheat.tiny = false;
  cheat.targetScale = 1;
  cheat.currentScale = 1;
  players[id].avatar.scale.set(1, 1, 1);

  joystickEl.classList.toggle("team-blue", activePlayer.color === "blue");
  joystickEl.classList.toggle("team-red", activePlayer.color === "red");
  stickEl.classList.toggle("team-blue", activePlayer.color === "blue");
  stickEl.classList.toggle("team-red", activePlayer.color === "red");
  lookPadEl.classList.toggle("team-blue", activePlayer.color === "blue");
  lookPadEl.classList.toggle("team-red", activePlayer.color === "red");
  syncAvatarVisibility();
  updateTeamBadge();
}

function updateTeamBadge() {
  const activePlayer = players[player.activeId];
  if (!player.hasJoined || !activePlayer) {
    hudTeamRedEl?.classList.remove("is-yours");
    hudTeamBlueEl?.classList.remove("is-yours");
    return;
  }

  hudTeamRedEl?.classList.toggle("is-yours", activePlayer.color === "red");
  hudTeamBlueEl?.classList.toggle("is-yours", activePlayer.color === "blue");
}

function updatePingDisplay() {
  if (!pingEl) return;
  if (!network.connected || pingTracker.value === null) {
    pingEl.textContent = "";
    pingEl.className = "ping-display";
    return;
  }

  const ms = pingTracker.value;
  pingEl.textContent = `${ms} ms`;
  pingEl.className = `ping-display ${ms < 60 ? "ping-good" : ms < 120 ? "ping-ok" : "ping-bad"}`;
}


function syncAvatarVisibility() {
  Object.entries(players).forEach(([id, slot]) => {
    const isActive = id === player.activeId && !player.isTopCamera && network.roundStatus !== "goal";
    const body = slot.avatar.userData.body;

    slot.avatar.visible = true;
    body.visible = true;
    body.material.colorWrite = !isActive;
    body.material.depthWrite = !isActive;
    body.castShadow = true;
    slot.avatar.userData.floorShadow.visible = false;
  });
}

function movePlayerWithBarriers(slot, currentX, currentZ, deltaX, deltaZ) {
  const nextX = currentX + deltaX;
  const nextZ = currentZ + deltaZ;

  if (slot.type === "tower") {
    return moveTowerPlayer(slot.corner, currentX, currentZ, deltaX, deltaZ);
  }

  return constrainPlayerPosition(slot, nextX, nextZ);
}

function constrainPlayerPosition(slot, x, z) {
  if (slot.type === "tower") {
    return constrainTowerPosition(slot.corner, x, z);
  }

  return {
    x: clamp(x, -worldSize / 2 + 0.8, worldSize / 2 - 0.8),
    z: clamp(z, -worldSize / 2 + 0.8, worldSize / 2 - 0.8),
  };
}

function constrainTowerPosition(corner, x, z) {
  if (isInsideTower(corner, x, z)) {
    return { x, z };
  }

  return closestTowerPoint(corner, x, z);
}

function moveTowerPlayer(corner, currentX, currentZ, deltaX, deltaZ) {
  const stepLength = Math.hypot(deltaX, deltaZ);
  const xOnly = { x: currentX + deltaX, z: currentZ };
  const zOnly = { x: currentX, z: currentZ + deltaZ };
  const both = { x: currentX + deltaX, z: currentZ + deltaZ };

  if (isInsideTower(corner, both.x, both.z)) {
    return both;
  }

  if (stepLength === 0) {
    return { x: currentX, z: currentZ };
  }

  const canMoveX = isInsideTower(corner, xOnly.x, xOnly.z);
  const canMoveZ = isInsideTower(corner, zOnly.x, zOnly.z);

  if (canMoveX && Math.abs(deltaX) >= Math.abs(deltaZ)) {
    return { x: currentX + Math.sign(deltaX) * stepLength, z: currentZ };
  }

  if (canMoveZ) {
    return { x: currentX, z: currentZ + Math.sign(deltaZ) * stepLength };
  }

  if (canMoveX) {
    return { x: currentX + Math.sign(deltaX) * stepLength, z: currentZ };
  }

  return { x: currentX, z: currentZ };
}

function isInsideTower(corner, x, z) {
  return getTowerRects(corner).some((rect) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ);
}

function closestTowerPoint(corner, x, z) {
  const candidates = getTowerRects(corner).map((rect) => ({
    x: clamp(x, rect.minX, rect.maxX),
    z: clamp(z, rect.minZ, rect.maxZ),
  }));

  return candidates.reduce((best, candidate) => {
    const bestDistance = (best.x - x) ** 2 + (best.z - z) ** 2;
    const candidateDistance = (candidate.x - x) ** 2 + (candidate.z - z) ** 2;
    return candidateDistance < bestDistance ? candidate : best;
  });
}

function getTowerRects(corner) {
  const half = worldSize / 2;
  const outer = half + wallOffset;
  const margin = 0.22;

  return corner === "blue"
    ? [
        {
          minX: -outer - wallWidth + margin,
          maxX: -outer + wallLength - margin,
          minZ: -outer - wallWidth + margin,
          maxZ: -outer - margin,
        },
        {
          minX: -outer - wallWidth + margin,
          maxX: -outer - margin,
          minZ: -outer - wallWidth + margin,
          maxZ: -outer + wallLength - margin,
        },
      ]
    : [
        {
          minX: outer - wallLength + margin,
          maxX: outer + wallWidth - margin,
          minZ: outer + margin,
          maxZ: outer + wallWidth - margin,
        },
        {
          minX: outer + margin,
          maxX: outer + wallWidth - margin,
          minZ: outer - wallLength + margin,
          maxZ: outer + wallWidth - margin,
        },
      ];
}

function createTileFloor() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(worldSize, worldSize),
    new THREE.MeshBasicMaterial({ color: 0x101010 }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.018;
  group.add(base);

  const geometry = new THREE.BoxGeometry(tileSize - tileGap, 0.055, tileSize - tileGap);
  const palette = [0x111111, 0x141414, 0x171717, 0x1a1a1a, 0x1d1d1d];

  for (let z = 0; z < tileCount; z += 1) {
    for (let x = 0; x < tileCount; x += 1) {
      const shadeIndex = (x * 7 + z * 11 + ((x + z) % 3)) % palette.length;
      const material = new THREE.MeshStandardMaterial({
        color: palette[shadeIndex],
        roughness: 0.9,
        metalness: 0.02,
      });
      material.userData.baseColor = palette[shadeIndex];
      tileMaterials.push(material);

      const tile = new THREE.Mesh(
        geometry,
        material,
      );

      tile.position.set(
        -worldSize / 2 + tileSize / 2 + x * tileSize,
        0,
        -worldSize / 2 + tileSize / 2 + z * tileSize,
      );
      tile.receiveShadow = true;
      group.add(tile);
    }
  }

  return group;
}

function createBorder() {
  const group = new THREE.Group();
  const blueMaterial = new THREE.MeshBasicMaterial({
    color: 0x5f78ff,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const redMaterial = new THREE.MeshBasicMaterial({
    color: 0xe34036,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const blueGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x4f67ff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const redGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4138,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  lineMaterials.blue = blueMaterial;
  lineMaterials.red = redMaterial;
  lineMaterials.blueGlow = blueGlowMaterial;
  lineMaterials.redGlow = redGlowMaterial;
  const redLineWidth = 0.12;
  const blueLineWidth = 0.12;
  const lineHeight = 0.035;
  const half = worldSize / 2;
  const y = lineHeight / 2 + 0.03;

  const blueCorner = new THREE.Vector3(-half, y, -half);
  const blueHorizontal = new THREE.Vector3(-half + bonusLegLength, y, -half);
  const blueVertical = new THREE.Vector3(-half, y, -half + bonusLegLength);
  addBorderLine(group, new THREE.Vector3(-half, y, -half), new THREE.Vector3(half, y, -half), blueLineWidth, blueMaterial, blueGlowMaterial);
  addBorderLine(group, new THREE.Vector3(-half, y, -half), new THREE.Vector3(-half, y, half), blueLineWidth, blueMaterial, blueGlowMaterial);
  addBorderLine(group, blueHorizontal, blueVertical, blueLineWidth, blueMaterial, blueGlowMaterial);

  const redCorner = new THREE.Vector3(half, y, half);
  const redHorizontal = new THREE.Vector3(half - bonusLegLength, y, half);
  const redVertical = new THREE.Vector3(half, y, half - bonusLegLength);
  addBorderLine(group, new THREE.Vector3(half, y, half), new THREE.Vector3(-half, y, half), redLineWidth, redMaterial, redGlowMaterial);
  addBorderLine(group, new THREE.Vector3(half, y, half), new THREE.Vector3(half, y, -half), redLineWidth, redMaterial, redGlowMaterial);
  addBorderLine(group, redHorizontal, redVertical, redLineWidth, redMaterial, redGlowMaterial);
  group.add(createColorJoint(-half, half, redLineWidth, blueMaterial, redMaterial, "bottom-left"));
  group.add(createColorJoint(half, -half, redLineWidth, blueMaterial, redMaterial, "top-right"));

  return group;
}

function addBorderLine(group, start, end, width, material, glowMaterial) {
  group.add(createLineSegment(start, end, width, material));

  const glowStart = start.clone();
  const glowEnd = end.clone();
  glowStart.y += 0.003;
  glowEnd.y += 0.003;
  const glow = createLineSegment(glowStart, glowEnd, width * 2.8, glowMaterial);
  glow.renderOrder = 1;
  lineGlowMeshes.push(glow);
  group.add(glow);
}

function createColorJoint(x, z, size, blueMaterial, redMaterial, corner) {
  const group = new THREE.Group();
  const y = 0.088;
  const halfSize = size * 0.7;
  const left = x - halfSize;
  const right = x + halfSize;
  const top = z - halfSize;
  const bottom = z + halfSize;

  if (corner === "bottom-left") {
    group.add(createFlatTriangle([[left, top], [left, bottom], [right, top]], y, blueMaterial));
    group.add(createFlatTriangle([[right, bottom], [right, top], [left, bottom]], y, redMaterial));
  } else {
    group.add(createFlatTriangle([[left, top], [right, top], [left, bottom]], y, blueMaterial));
    group.add(createFlatTriangle([[right, bottom], [left, bottom], [right, top]], y, redMaterial));
  }

  return group;
}

function createFlatTriangle(points, y, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  shape.lineTo(points[1][0], points[1][1]);
  shape.lineTo(points[2][0], points[2][1]);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(0, y, 0);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 4;
  return mesh;
}

function createLineSegment(start, end, width, material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = Math.hypot(direction.x, direction.z);
  const normalX = (-direction.z / length) * (width / 2);
  const normalZ = (direction.x / length) * (width / 2);
  const shape = new THREE.Shape();
  const points = [
    [start.x + normalX, start.z + normalZ],
    [end.x + normalX, end.z + normalZ],
    [end.x - normalX, end.z - normalZ],
    [start.x - normalX, start.z - normalZ],
  ];

  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(0, start.y, 0);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return mesh;
}

function updateGlobalGoalState() {
  const events = [
    getGoalEventForPlayer(players.blue, players.red),
    getGoalEventForPlayer(players.red, players.blue),
  ].filter(Boolean);

  events.forEach((event) => {
    const wasInGoal = goalState[event.team];
    goalState[event.team] = true;

    if (wasInGoal) return;

    score[event.team] += event.points;
    updateScore();
    multiplierEl.textContent = `${event.team === "blue" ? "ГОЛ\nСИНИХ" : "ГОЛ\nКРАСНЫХ"}${event.points === 2 ? "\nx2" : ""}`;
    multiplierEl.classList.toggle("goal-blue", event.team === "blue");
    multiplierEl.classList.toggle("goal-red", event.team === "red");
    multiplierEl.classList.add("visible");
    goalState.messageUntil = clock.elapsedTime + 1.2;
  });

  ["blue", "red"].forEach((team) => {
    if (!events.some((event) => event.team === team)) {
      goalState[team] = false;
    }
  });

  if (!events.length && clock.elapsedTime > goalState.messageUntil) {
    multiplierEl.classList.remove("visible");
  }
}

function getGoalEventForPlayer(scoringPlayer, opponent) {
  const isGoal = isPointInPlayerShadow(
    scoringPlayer.avatar.position.x,
    scoringPlayer.avatar.position.z,
    opponent,
    scoringPlayer,
  );

  if (!isGoal) return null;

  const isDouble = isInBonusTriangle(scoringPlayer.avatar.position.x, scoringPlayer.avatar.position.z);

  return {
    team: scoringPlayer.color,
    points: isDouble ? 2 : 1,
    label: scoringPlayer.color === "blue" ? "Гол синих" : "Гол красных",
  };
}

function updateScore() {
  if (scoreRedEl) scoreRedEl.textContent = score.red;
  if (scoreBlueEl) scoreBlueEl.textContent = score.blue;
}

function updateScoreTimer() {
  if (!scoreTimerEl) return;

  if (!network.roundStartedAt) {
    scoreTimerEl.textContent = "0:00";
    return;
  }

  const now = Date.now() + network.serverTimeOffset;
  const elapsed = Math.max(0, Math.floor((now - network.roundStartedAt) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  scoreTimerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
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

function getPlayerShadowData(targetPlayer, activePlayer) {
  const lightSlot = activePlayer.color === "blue" ? players.blueTower : players.redTower;
  const lightOrigin = getFlashlightOrigin(lightSlot);
  const targetPosition = targetPlayer.avatar.position;
  const axis = new THREE.Vector2(
    targetPosition.x - lightOrigin.x,
    targetPosition.z - lightOrigin.z,
  );

  if (axis.lengthSq() < 0.0001) return null;
  axis.normalize();

  const playerRadius = 0.58;
  const playerTopY = targetPosition.y + 2.55;
  const topProjection = projectPointToGroundFromLight(
    lightOrigin,
    new THREE.Vector3(targetPosition.x, playerTopY, targetPosition.z),
  );
  const projectedLength = topProjection
    ? Math.hypot(topProjection.x - targetPosition.x, topProjection.z - targetPosition.z)
    : 0;
  const shadowStart = playerRadius * 0.55;
  const shadowLength = clamp(projectedLength * 1.7 + playerRadius * 1.35, 2.6, 7.2);
  const baseWidth = 0.86;
  const tipWidth = 0.58;

  return {
    axis,
    normal: new THREE.Vector2(-axis.y, axis.x),
    target: new THREE.Vector2(targetPosition.x, targetPosition.z),
    lightOrigin,
    lightSlot,
    shadowStart,
    shadowLength,
    baseWidth,
    tipWidth,
  };
}

function projectPointToGroundFromLight(lightOrigin, point) {
  const denominator = point.y - lightOrigin.y;
  if (Math.abs(denominator) < 0.001) return null;

  const scale = -lightOrigin.y / denominator;
  if (scale <= 1) return null;

  return new THREE.Vector3(
    lightOrigin.x + (point.x - lightOrigin.x) * scale,
    0,
    lightOrigin.z + (point.z - lightOrigin.z) * scale,
  );
}

function isGroundPointShadowedByPlayer(x, z, targetPlayer, activePlayer) {
  const shadow = getPlayerShadowData(targetPlayer, activePlayer);
  if (!shadow || !isPointInsideLightCone(x, z, shadow.lightSlot, shadow.lightOrigin)) return false;

  const targetPosition = targetPlayer.avatar.position;
  const targetRadius = 0.58;
  const deadZoneRadius = targetRadius * 1.15;

  if (Math.hypot(x - targetPosition.x, z - targetPosition.z) < deadZoneRadius) {
    return false;
  }

  const rayStart = shadow.lightOrigin;
  const rayEnd = new THREE.Vector3(x, 0.02, z);
  const capsuleBottom = new THREE.Vector3(targetPosition.x, targetPosition.y + targetRadius, targetPosition.z);
  const capsuleTop = new THREE.Vector3(targetPosition.x, targetPosition.y + 1.95, targetPosition.z);
  const distanceSq = closestDistanceSqBetweenSegments(rayStart, rayEnd, capsuleBottom, capsuleTop);

  return distanceSq <= targetRadius * targetRadius;
}

function closestDistanceSqBetweenSegments(p1, q1, p2, q2) {
  const d1 = new THREE.Vector3().subVectors(q1, p1);
  const d2 = new THREE.Vector3().subVectors(q2, p2);
  const r = new THREE.Vector3().subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const epsilon = 0.000001;
  let s = 0;
  let t = 0;

  if (a <= epsilon && e <= epsilon) {
    return p1.distanceToSquared(p2);
  }

  if (a <= epsilon) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);

    if (e <= epsilon) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denominator = a * e - b * b;

      if (denominator !== 0) {
        s = clamp((b * f - c * e) / denominator, 0, 1);
      }

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

  const closest1 = p1.clone().addScaledVector(d1, s);
  const closest2 = p2.clone().addScaledVector(d2, t);
  return closest1.distanceToSquared(closest2);
}

function getPlayerShadowBoundarySegments(targetPlayer, activePlayer) {
  const shadow = getPlayerShadowData(targetPlayer, activePlayer);
  if (!shadow) return [];

  const gridSize = 72;
  const y = 0.14;
  const target = shadow.target;
  const center = target.clone().addScaledVector(shadow.axis, shadow.shadowLength * 0.52);
  const halfLength = shadow.shadowLength * 0.58;
  const halfWidth = Math.max(shadow.baseWidth, shadow.tipWidth) * 1.35;
  const minX = center.x - Math.abs(shadow.axis.x) * halfLength - Math.abs(shadow.normal.x) * halfWidth;
  const maxX = center.x + Math.abs(shadow.axis.x) * halfLength + Math.abs(shadow.normal.x) * halfWidth;
  const minZ = center.y - Math.abs(shadow.axis.y) * halfLength - Math.abs(shadow.normal.y) * halfWidth;
  const maxZ = center.y + Math.abs(shadow.axis.y) * halfLength + Math.abs(shadow.normal.y) * halfWidth;
  const cellW = (maxX - minX) / gridSize;
  const cellH = (maxZ - minZ) / gridSize;
  const cells = [];
  const segments = [];

  for (let row = 0; row < gridSize; row += 1) {
    cells[row] = [];
    for (let col = 0; col < gridSize; col += 1) {
      const x = minX + (col + 0.5) * cellW;
      const z = minZ + (row + 0.5) * cellH;
      cells[row][col] = isGroundPointShadowedByPlayer(x, z, targetPlayer, activePlayer);
    }
  }

  const addSegment = (x1, z1, x2, z2) => {
    segments.push(new THREE.Vector3(x1, y, z1), new THREE.Vector3(x2, y, z2));
  };

  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      if (!cells[row][col]) continue;

      const left = minX + col * cellW;
      const right = left + cellW;
      const top = minZ + row * cellH;
      const bottom = top + cellH;

      if (row === 0 || !cells[row - 1][col]) addSegment(left, top, right, top);
      if (row === gridSize - 1 || !cells[row + 1][col]) addSegment(left, bottom, right, bottom);
      if (col === 0 || !cells[row][col - 1]) addSegment(left, top, left, bottom);
      if (col === gridSize - 1 || !cells[row][col + 1]) addSegment(right, top, right, bottom);
    }
  }

  return segments;
}

function isPointInsideLightCone(x, z, lightSlot, lightOrigin) {
  const target = getLookTarget(lightSlot, lightOrigin, worldSize * 0.9);
  const coneAxis = new THREE.Vector3(
    target.x - lightOrigin.x,
    target.y - lightOrigin.y,
    target.z - lightOrigin.z,
  );

  if (coneAxis.lengthSq() < 0.0001) return false;
  coneAxis.normalize();

  const toPoint = new THREE.Vector3(x - lightOrigin.x, 0.02 - lightOrigin.y, z - lightOrigin.z);
  const lightDistance = toPoint.length();
  if (lightDistance < 0.0001) return false;

  const forwardDistance = toPoint.dot(coneAxis);
  const spotAngle = (lightSlot.flashlight?.light.angle ?? 0.16) * 0.96;
  const maxDistance = lightSlot.flashlight?.light.distance ?? worldSize * 4;
  const pointAngle = Math.acos(clamp(forwardDistance / lightDistance, -1, 1));

  return forwardDistance > 0 && lightDistance <= maxDistance && pointAngle <= spotAngle;
}

function getFlashlightOrigin(slot) {
  const direction = getSlotLookDirection(slot);
  return new THREE.Vector3(
    slot.avatar.position.x + direction.x * 0.9,
    slot.avatar.position.y + 2.2,
    slot.avatar.position.z + direction.z * 0.9,
  );
}

function isInBonusTriangle(x, z) {
  return isInTeamBonusTriangle("blue", x, z) || isInTeamBonusTriangle("red", x, z);
}

function isInTeamBonusTriangle(team, x, z) {
  const half = worldSize / 2;
  const blueX = x + half;
  const blueZ = z + half;
  const redX = half - x;
  const redZ = half - z;

  if (team === "blue") {
    return blueX >= 0 && blueZ >= 0 && blueX + blueZ <= bonusLegLength;
  }

  return redX >= 0 && redZ >= 0 && redX + redZ <= bonusLegLength;
}

function createConcreteAprons() {
  const topMaterial = new THREE.MeshBasicMaterial({
    color: 0x181818,
    side: THREE.DoubleSide,
  });
  const sideMaterial = new THREE.MeshBasicMaterial({
    color: 0x101010,
    side: THREE.DoubleSide,
  });
  const apronWidth = tileSize * 1.4;
  const slabDepth = tileSize * 5;
  const half = worldSize / 2;
  const outer = half + apronWidth;
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-half, -half);
  hole.lineTo(-half, half);
  hole.lineTo(half, half);
  hole.lineTo(half, -half);
  hole.closePath();
  shape.holes.push(hole);

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(0, 0.02, 0);

  const concrete = new THREE.Group();
  const top = new THREE.Mesh(geometry, topMaterial);
  top.renderOrder = 1;
  concrete.add(top);

  const sideY = -slabDepth / 2;
  const sideHeight = slabDepth;
  const sideThickness = 0.06;
  const sides = [
    [0, sideY, -outer - sideThickness / 2, outer * 2 + sideThickness * 2, sideHeight, sideThickness],
    [0, sideY, outer + sideThickness / 2, outer * 2 + sideThickness * 2, sideHeight, sideThickness],
    [-outer - sideThickness / 2, sideY, 0, sideThickness, sideHeight, outer * 2],
    [outer + sideThickness / 2, sideY, 0, sideThickness, sideHeight, outer * 2],
  ];

  sides.forEach(([x, y, z, width, height, depth]) => {
    const side = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), sideMaterial);
    side.position.set(x, y, z);
    concrete.add(side);
  });

  concrete.renderOrder = 1;
  return concrete;
}

function createBonusPads() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0x62625d,
    side: THREE.DoubleSide,
  });
  const half = worldSize / 2;

  group.add(
    createFilledTriangle(
      [
        [-half, -half],
        [-half + bonusLegLength, -half],
        [-half, -half + bonusLegLength],
      ],
      0.018,
      material,
    ),
  );
  group.add(
    createFilledTriangle(
      [
        [half, half],
        [half - bonusLegLength, half],
        [half, half - bonusLegLength],
      ],
      0.018,
      material,
    ),
  );

  return group;
}

function createFilledTriangle(points, y, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  shape.lineTo(points[1][0], points[1][1]);
  shape.lineTo(points[2][0], points[2][1]);
  shape.closePath();

  const geometry = new THREE.ShapeGeometry(shape);
  geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(0, y, 0);

  const triangle = new THREE.Mesh(geometry, material);
  triangle.renderOrder = 1;
  return triangle;
}

function createCornerWalls() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x171719,
    side: THREE.DoubleSide,
    roughness: 0.86,
    metalness: 0.02,
  });
  const capMaterial = new THREE.MeshStandardMaterial({
    color: 0x8f7968,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0.02,
  });
  const wallLength = tileSize * 5.6;
  const wallHeight = tileSize * 3.5;
  const wallWidth = tileSize;
  const half = worldSize / 2;
  const wallOffset = 0.22;
  const outer = half + wallOffset;

  group.add(
    createLWallMesh(
      [
        [-outer - wallWidth, -outer - wallWidth],
        [-outer + wallLength, -outer - wallWidth],
        [-outer + wallLength, -outer],
        [-outer, -outer],
        [-outer, -outer + wallLength],
        [-outer - wallWidth, -outer + wallLength],
      ],
      wallHeight,
      material,
    ),
  );
  group.add(
    createLWallCapMesh(
      [
        [-outer - wallWidth, -outer - wallWidth],
        [-outer + wallLength, -outer - wallWidth],
        [-outer + wallLength, -outer],
        [-outer, -outer],
        [-outer, -outer + wallLength],
        [-outer - wallWidth, -outer + wallLength],
      ],
      wallHeight + 0.025,
      capMaterial,
    ),
  );
  group.add(
    createLWallMesh(
      [
        [outer + wallWidth, outer + wallWidth],
        [outer - wallLength, outer + wallWidth],
        [outer - wallLength, outer],
        [outer, outer],
        [outer, outer - wallLength],
        [outer + wallWidth, outer - wallLength],
      ],
      wallHeight,
      material,
    ),
  );
  group.add(
    createLWallCapMesh(
      [
        [outer + wallWidth, outer + wallWidth],
        [outer - wallLength, outer + wallWidth],
        [outer - wallLength, outer],
        [outer, outer],
        [outer, outer - wallLength],
        [outer + wallWidth, outer - wallLength],
      ],
      wallHeight + 0.025,
      capMaterial,
    ),
  );

  return group;
}

function createLWallCapMesh(points, y, material) {
  const overhang = 0.14;
  const thickness = 0.12;
  const expandedPoints = expandAxisAlignedL(points, overhang);
  const shape = new THREE.Shape();
  shape.moveTo(expandedPoints[0][0], expandedPoints[0][1]);

  for (let i = 1; i < expandedPoints.length; i += 1) {
    shape.lineTo(expandedPoints[i][0], expandedPoints[i][1]);
  }

  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.translate(0, y, 0);

  const cap = new THREE.Mesh(geometry, material);
  cap.castShadow = false;
  cap.receiveShadow = true;
  return cap;
}

function expandAxisAlignedL(points, amount) {
  const centerX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const centerZ = points.reduce((sum, point) => sum + point[1], 0) / points.length;

  return points.map(([x, z]) => [
    x + Math.sign(x - centerX) * amount,
    z + Math.sign(z - centerZ) * amount,
  ]);
}

function createLWallMesh(points, height, material) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);

  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i][0], points[i][1]);
  }

  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.applyMatrix4(new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  geometry.computeVertexNormals();

  const wall = new THREE.Mesh(geometry, material);
  wall.castShadow = false;
  wall.receiveShadow = true;
  return wall;
}

function updateCheatScale(delta) {
  if (!player.hasJoined) return;
  cheat.currentScale += (cheat.targetScale - cheat.currentScale) * Math.min(delta * 8, 1);
  const s = cheat.currentScale;
  players[player.activeId].avatar.scale.set(s, s, s);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function lerpAngle(from, to, amount) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * amount;
}

// ── Voice Chat ──

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function initVoice() {
  if (voiceState.localStream) return;
  try {
    voiceState.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    voiceState.localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
  } catch {
    // mic permission denied - voice won't work
  }
}

function voiceSetTalking(talking) {
  if (!player.hasJoined) return;

  voiceState.isTalking = talking;
  voiceMicBtn.classList.toggle("talking", talking);

  // Update local speaking indicator immediately without waiting for server echo
  if (talking) {
    voiceState.speakers.set("local", { nickname: localNickname || "Я", activeId: player.activeId });
  } else {
    voiceState.speakers.delete("local");
  }
  updateVoiceSpeakersUI();

  // Enable/disable mic if we have permission
  if (voiceState.localStream) {
    voiceState.localStream.getAudioTracks().forEach((t) => { t.enabled = talking; });
  } else if (talking) {
    // Try to get mic on first push-to-talk
    initVoice().then(() => {
      if (voiceState.localStream && voiceState.isTalking) {
        voiceState.localStream.getAudioTracks().forEach((t) => { t.enabled = true; });
      }
    });
  }

  if (network.connected && network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "voiceTalking", talking }));
  }
}

function voiceConnectToPeer(targetClientId) {
  if (!voiceState.localStream || voiceState.peers.has(targetClientId) || targetClientId === localClientId) return;

  const pc = new RTCPeerConnection(rtcConfig);
  const peer = { pc, audioEl: null, targetClientId };
  voiceState.peers.set(targetClientId, peer);

  voiceState.localStream.getTracks().forEach((track) => pc.addTrack(track, voiceState.localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate && network.socket?.readyState === WebSocket.OPEN) {
      network.socket.send(JSON.stringify({ type: "voiceIce", targetId: targetClientId, candidate: e.candidate }));
    }
  };

  pc.ontrack = (e) => {
    const audio = new Audio();
    audio.srcObject = e.streams[0];
    audio.volume = voiceState.voiceVolume;
    audio.play().catch(() => {});
    peer.audioEl = audio;
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      voiceRemovePeer(targetClientId);
    }
  };

  return peer;
}

async function voiceCreateOffer(targetClientId) {
  const peer = voiceConnectToPeer(targetClientId);
  if (!peer) return;

  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  if (network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "voiceOffer", targetId: targetClientId, sdp: offer }));
  }
}

async function handleVoiceOffer(message) {
  if (!voiceState.localStream) return;
  let peer = voiceState.peers.get(message.fromId);
  if (!peer) {
    peer = voiceConnectToPeer(message.fromId);
    if (!peer) return;
  }

  await peer.pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
  const answer = await peer.pc.createAnswer();
  await peer.pc.setLocalDescription(answer);
  if (network.socket?.readyState === WebSocket.OPEN) {
    network.socket.send(JSON.stringify({ type: "voiceAnswer", targetId: message.fromId, sdp: answer }));
  }
}

async function handleVoiceAnswer(message) {
  const peer = voiceState.peers.get(message.fromId);
  if (!peer) return;
  await peer.pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
}

async function handleVoiceIce(message) {
  const peer = voiceState.peers.get(message.fromId);
  if (!peer) return;
  try {
    await peer.pc.addIceCandidate(new RTCIceCandidate(message.candidate));
  } catch {}
}

function voiceRemovePeer(clientId) {
  const peer = voiceState.peers.get(clientId);
  if (!peer) return;
  peer.pc.close();
  if (peer.audioEl) {
    peer.audioEl.pause();
    peer.audioEl.srcObject = null;
  }
  voiceState.peers.delete(clientId);
  voiceState.speakers.delete(clientId);
  updateVoiceSpeakersUI();
}

function voiceDisconnectAll() {
  voiceState.peers.forEach((peer) => {
    peer.pc.close();
    if (peer.audioEl) {
      peer.audioEl.pause();
      peer.audioEl.srcObject = null;
    }
  });
  voiceState.peers.clear();
  voiceState.speakers.clear();
  voiceState.isTalking = false;
  if (voiceState.localStream) {
    voiceState.localStream.getAudioTracks().forEach((t) => { t.enabled = false; });
  }
  voiceMicBtn.classList.remove("talking");
  updateVoiceSpeakersUI();
}

function handleVoiceTalkingMessage(message) {
  // Skip own messages — we handle local indicator in voiceSetTalking directly
  if (message.clientId === localClientId || message.clientId === "local") return;
  if (message.talking) {
    voiceState.speakers.set(message.clientId, {
      nickname: message.nickname || message.activeId || "???",
      activeId: message.activeId,
    });
  } else {
    voiceState.speakers.delete(message.clientId);
  }
  updateVoiceSpeakersUI();
}

function updateVoiceSpeakersUI() {
  voiceSpeakersEl.innerHTML = "";
  voiceState.speakers.forEach((speaker) => {
    const tag = document.createElement("div");
    tag.className = "voice-speaker-tag";
    tag.innerHTML = `<div class="voice-speaker-icon"></div><span class="voice-speaker-name">${escapeHtml(speaker.nickname)}</span>`;
    voiceSpeakersEl.appendChild(tag);
  });

  const target = voiceState.speakers.size > 0 ? musicBaseVolume * MUSIC_DUCK_FACTOR : musicBaseVolume;
  duckMusicTo(target);
}

function duckMusicTo(target) {
  if (musicDuckRaf) cancelAnimationFrame(musicDuckRaf);

  const start = bgMusic.volume;
  const startTime = performance.now();

  const step = (now) => {
    const t = Math.min((now - startTime) / MUSIC_DUCK_MS, 1);
    bgMusic.volume = start + (target - start) * t;
    if (t < 1) {
      musicDuckRaf = requestAnimationFrame(step);
    } else {
      musicDuckRaf = null;
    }
  };

  musicDuckRaf = requestAnimationFrame(step);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function voiceConnectToNewPeers(voiceClients) {
  if (!voiceState.localStream || !player.hasJoined) return;
  (voiceClients || []).forEach((vc) => {
    if (vc.clientId !== localClientId && !voiceState.peers.has(vc.clientId)) {
      if (localClientId < vc.clientId) {
        voiceCreateOffer(vc.clientId);
      }
    }
  });
}
