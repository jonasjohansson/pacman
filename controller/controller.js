// Constants
const REMOTE_SERVER_ADDRESS = "https://pacman-server-239p.onrender.com";
const LOCAL_SERVER_ADDRESS = "http://localhost:3000";
const INPUT_THROTTLE = 50;
const JOYSTICK_THRESHOLD = 30;
const JOYSTICK_OFFSET = 40;

// Get server address from URL parameter or default
function getServerFromURL() {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get("server");
  
  if (serverParam) {
    // If it's a full URL, use it directly
    if (serverParam.startsWith("http://") || serverParam.startsWith("https://")) {
      return serverParam;
    }
    // If it's "local" or "localhost", use local server
    if (serverParam.toLowerCase() === "local" || serverParam.toLowerCase() === "localhost") {
      return LOCAL_SERVER_ADDRESS;
    }
    
    // If it's "remote" or "render", use remote server
    if (serverParam.toLowerCase() === "remote" || serverParam.toLowerCase() === "render") {
      return REMOTE_SERVER_ADDRESS;
    }
  }
  
  // Default: use remote server
  return REMOTE_SERVER_ADDRESS;
}

// Key to direction mapping
const KEY_TO_DIR = {
  w: "up",
  s: "down",
  a: "left",
  d: "right"
};

// State
let ws = null;
let myPlayerId = null;
let myColorIndex = null; // The chaser we're actually joined as
let selectedChaserIndex = null; // The chaser we've selected but not yet joined
let selectedChaserName = null; // The name for the selected chaser
let pendingStartGame = false; // Whether we're waiting to start the game after joining
let gameStarted = false;
let connectedPlayers = new Map();
let availableChasers = [0, 1, 2, 3];
let playerNames = new Map(); // colorIndex -> playerName
let takenChasers = new Set(); // colorIndex -> Set of chasers taken by other players (selected or joined)
let lastInputTime = 0;
let currentDir = null;
let joystickActive = false;
let isFirstPlayer = false;
let activeTouch = null;
const keys = {};
// Track previous state to avoid unnecessary updates
let previousAvailableChasers = [];
let previousPlayerNames = new Map();
let previousMyColorIndex = null;
let previousGameStarted = false;
let previousSelectedChaserIndex = null;

// DOM elements (cached) - initialized after DOM is ready
let elements = {};

// Utility functions
function getServerAddress() {
  return getServerFromURL();
}

function getInitials() {
  // Default initials, will be prompted when game ends
  return "JGD";
}

function promptForInitials() {
  let initials = "";
  while (!initials || initials.length === 0) {
    const input = prompt("Enter your 3-letter initials:");
    if (input === null) {
      // User cancelled
      return null;
    }
    initials = input.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (initials.length === 0) {
      alert("Please enter at least one letter.");
    }
  }
  return initials || null;
}

function calculateDirection(deltaX, deltaY, threshold = JOYSTICK_THRESHOLD) {
  if (Math.abs(deltaX) > Math.abs(deltaY)) {
    if (deltaX > threshold) return "right";
    if (deltaX < -threshold) return "left";
  } else {
    if (deltaY > threshold) return "down";
    if (deltaY < -threshold) return "up";
  }
  return null;
}

function getJoystickCenter() {
  const rect = elements.joystickBase.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    maxDistance: Math.min(rect.width, rect.height) / 2 - JOYSTICK_OFFSET
  };
}

function sendInput(dir) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("[sendInput] WebSocket not ready", ws?.readyState);
    return;
  }
  if (!myPlayerId) {
    console.log("[sendInput] No myPlayerId");
    return;
  }
  if (myColorIndex === null) {
    console.log("[sendInput] myColorIndex is null");
    return;
  }
  if (!gameStarted) {
    console.log("[sendInput] Game not started yet");
    return;
  }

  const now = Date.now();
  if (now - lastInputTime < INPUT_THROTTLE) return;
  
  lastInputTime = now;
  currentDir = dir;
  
  console.log("[sendInput] Sending input", dir, "for chaser", myColorIndex);
  ws.send(JSON.stringify({ type: "input", input: { dir } }));
}

// WebSocket
function initWebSocket() {
  const wsUrl = getServerAddress().replace(/^https?:/, (m) => m === "https:" ? "wss:" : "ws:");

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
    };

    ws.onmessage = (event) => {
      try {
        handleServerMessage(JSON.parse(event.data));
      } catch (error) {
        console.error("Error parsing message:", error);
      }
    };

    ws.onerror = (error) => console.error("WebSocket error:", error);
    ws.onclose = () => setTimeout(initWebSocket, 3000);
  } catch (error) {
    console.error("Error connecting:", error);
  }
}

function handleServerMessage(data) {
  switch (data.type) {
    case "connected":
      myPlayerId = data.playerId;
      break;
    case "joined":
      console.log("[joined] Player joined as chaser", data.colorIndex, "myColorIndex was:", myColorIndex);
      myColorIndex = data.colorIndex;
      previousMyColorIndex = data.colorIndex;
      // Clear selection since we're now joined
      if (selectedChaserIndex === data.colorIndex) {
        selectedChaserIndex = null;
        selectedChaserName = null;
      }
      // Store our own name
      if (data.playerName) {
        playerNames.set(data.colorIndex, data.playerName);
      }
      updateUI();
      updateChaserButtons();
      // Force update start button when joining
      updateStartButton();
      
      // If we were trying to start the game, do it now that we're joined
      if (pendingStartGame && !gameStarted && ws?.readyState === WebSocket.OPEN) {
        console.log("[joined] Starting game after join");
        pendingStartGame = false;
        ws.send(JSON.stringify({ type: "startGame" }));
      }
      break;
    case "gameState":
      let playerNamesChanged = false;
      let availableChasersChanged = false;
      
      if (data.players) {
        connectedPlayers.clear();
        const newPlayerNames = new Map();
        let playerCount = 0;
        // Check if this client's player is in the list and update myColorIndex
        let foundMyPlayer = false;
        data.players.forEach((player) => {
          if (player.connected) {
            playerCount++;
            connectedPlayers.set(player.playerId, {
              type: player.type,
              colorIndex: player.colorIndex,
              stats: player.stats || null,
            });
            // Store player names by colorIndex (for joined players)
            if (player.colorIndex !== null && player.colorIndex !== undefined && player.playerName) {
              newPlayerNames.set(player.colorIndex, player.playerName);
            }
            // If this is our player, update myColorIndex
            if (player.playerId === myPlayerId) {
              myColorIndex = player.colorIndex;
              foundMyPlayer = true;
            }
          }
        });
        // If we didn't find our player in the list, reset myColorIndex
        if (!foundMyPlayer && myPlayerId) {
          myColorIndex = null;
        }
        isFirstPlayer = playerCount === 1 && myPlayerId && connectedPlayers.has(myPlayerId);
        
        // Track which chasers are taken (by other players)
        const newTakenChasers = new Set();
        
        // Add joined chasers to taken set
        data.players.forEach((player) => {
          if (player.connected && player.colorIndex !== null && player.colorIndex !== undefined) {
            // Only mark as taken if it's not our own chaser
            if (player.playerId !== myPlayerId) {
              newTakenChasers.add(player.colorIndex);
            }
          }
        });
        
        // Also add names from chaser selections (players who selected but haven't joined yet)
        if (data.chaserSelections) {
          Object.entries(data.chaserSelections).forEach(([colorIndexStr, selection]) => {
            const colorIndex = parseInt(colorIndexStr, 10);
            if (!isNaN(colorIndex) && selection.playerName) {
              // Only add if not already joined (not in newPlayerNames)
              if (!newPlayerNames.has(colorIndex)) {
                newPlayerNames.set(colorIndex, selection.playerName);
              }
              // Mark as taken if it's not our own selection
              if (selectedChaserIndex !== colorIndex) {
                newTakenChasers.add(colorIndex);
              }
            }
          });
        }
        
        // Update taken chasers
        takenChasers = newTakenChasers;
        
        // Check if player names changed
        playerNamesChanged = 
          newPlayerNames.size !== previousPlayerNames.size ||
          Array.from(newPlayerNames.entries()).some(([key, val]) => previousPlayerNames.get(key) !== val) ||
          Array.from(previousPlayerNames.entries()).some(([key, val]) => newPlayerNames.get(key) !== val);
        
        if (playerNamesChanged) {
          playerNames = newPlayerNames;
          previousPlayerNames = new Map(newPlayerNames);
        }
        
        updateScoreDisplay();
      }
      
      // Update gameStarted state from server
      if (data.gameStarted !== undefined) {
        const wasGameStarted = gameStarted;
        gameStarted = data.gameStarted;
        if (gameStarted !== wasGameStarted) {
          console.log("[gameState] gameStarted changed:", wasGameStarted, "->", gameStarted);
          previousGameStarted = gameStarted;
        }
      }
      
      if (data.availableColors?.chaser) {
        const newAvailableChasers = data.availableColors.chaser;
        // Only update if available chasers changed
        availableChasersChanged = 
          newAvailableChasers.length !== previousAvailableChasers.length ||
          !newAvailableChasers.every((val, idx) => val === previousAvailableChasers[idx]);
        
        if (availableChasersChanged) {
          availableChasers = newAvailableChasers;
          previousAvailableChasers = [...newAvailableChasers];
        }
      }
      
      // Only update buttons if something actually changed
      if (availableChasersChanged || playerNamesChanged) {
        updateChaserButtons();
      }
      
      // Update previous values and check if state changed
      const myColorIndexChanged = myColorIndex !== previousMyColorIndex;
      const gameStartedChanged = gameStarted !== previousGameStarted;
      const selectedChaserIndexChanged = selectedChaserIndex !== previousSelectedChaserIndex;
      
      if (myColorIndexChanged) {
        console.log("[gameState] myColorIndex changed:", previousMyColorIndex, "->", myColorIndex);
        previousMyColorIndex = myColorIndex;
      }
      if (gameStartedChanged) {
        previousGameStarted = gameStarted;
      }
      if (selectedChaserIndexChanged) {
        previousSelectedChaserIndex = selectedChaserIndex;
      }
      
      // Only update start button if relevant state changed
      if (myColorIndexChanged || gameStartedChanged || selectedChaserIndexChanged) {
        updateStartButton();
      }
      break;
    case "gameStarted":
      console.log("[gameStarted] Game started, myColorIndex:", myColorIndex, "selectedChaserIndex:", selectedChaserIndex);
      gameStarted = true;
      previousGameStarted = true;
      pendingStartGame = false; // Clear pending flag since game has started
      elements.chaserSelect?.classList.add("game-started");
      // Update start button since game state changed
      updateStartButton();
      // Update chaser buttons to disable them if player has joined
      updateChaserButtons();
      // Request latest game state to get updated available chasers
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "gameState" }));
      }
      break;
    case "gameRestarted":
      gameStarted = false;
      previousGameStarted = false;
      updateUI();
      elements.chaserSelect?.classList.remove("game-started");
      break;
    case "gameEnd":
      // Game ended - show score in first row instead of alert
      if (myColorIndex !== null) {
        const timeSeconds = (data.gameTime / 1000).toFixed(1);
        const message = data.allCaught
          ? `All Fugitives Caught! Time: ${timeSeconds}s | Score: ${data.score} | Caught: ${data.fugitivesCaught}/${data.totalFugitives}`
          : `Time's Up! Time: ${timeSeconds}s | Score: ${data.score} | Caught: ${data.fugitivesCaught}/${data.totalFugitives}`;
        
        // Update score display with game end message
        if (elements.scoreValue) {
          elements.scoreValue.textContent = message;
        }
        
        // Prompt for initials
        const initials = promptForInitials();
        
        // Send initials to server for highscore (if this is the first player)
        if (isFirstPlayer && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "updatePlayerName",
            playerName: initials,
          }));
        }
      }
      break;
    case "gameReset":
      gameStarted = false;
      previousGameStarted = false;
      myColorIndex = null;
      previousMyColorIndex = null;
      selectedChaserIndex = null;
      selectedChaserName = null;
      pendingStartGame = false;
      isFirstPlayer = false;
      // Reset score display to show current score
      updateScoreDisplay();
      updateChaserButtons();
      updateUI();
      elements.chaserSelect?.classList.remove("game-started");
      break;
  }
}

// UI Updates
function updateUI() {
  updateStartButton();
}

function updateChaserButtons() {
  elements.chaserButtons.forEach((btn) => {
    const indexStr = btn.dataset.index;
    if (indexStr === "start") return;
    
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) return;
    
    const isAvailable = availableChasers.includes(index);
    const isJoined = myColorIndex === index;
    const isSelected = selectedChaserIndex === index;
    const isTakenByOthers = takenChasers.has(index); // Taken by other players (selected or joined)
    const playerName = playerNames.get(index);
    
    btn.classList.remove("available", "taken", "selected");
    
    // Update button text with player name if available
    if (playerName) {
      btn.textContent = `${index + 1}: ${playerName}`;
    } else {
      btn.textContent = `${index + 1}`;
    }
    
    if (isJoined) {
      // Player has joined as this chaser - disable all chaser buttons (can't change after joining)
      btn.classList.add("selected");
      btn.disabled = true; // Disable to prevent changing chaser after joining
    } else if (myColorIndex !== null) {
      // Player has already joined a different chaser - disable all chaser buttons
      btn.classList.add("taken");
      btn.disabled = true;
    } else if (isSelected) {
      // Player has selected this chaser but not yet joined
      btn.classList.add("selected");
      btn.disabled = false;
    } else if (isTakenByOthers) {
      // Chaser is taken by another player (selected or joined) - disable
      btn.classList.add("taken");
      btn.disabled = true;
    } else if (selectedChaserIndex !== null) {
      // Player has selected a different chaser - disable all others
      btn.classList.add("taken");
      btn.disabled = true;
    } else if (isAvailable) {
      btn.classList.add("available");
      btn.disabled = false;
    } else {
      btn.classList.add("taken");
      btn.disabled = true;
    }
  });
}

function updateStartButton() {
  if (!elements.startBtn) return;
  
  // Simple logic: Always show "Play"
  // - Enabled if:
  //   - Player has selected a chaser (selectedChaserIndex !== null) AND
  //   - Player hasn't joined yet (myColorIndex === null)
  // - Disabled if:
  //   - Player hasn't selected a chaser
  //   - Player has already joined (myColorIndex !== null)
  
  elements.startBtn.textContent = "Play";
  
  // Debug logging (only log when state actually changes to avoid spam)
  // Removed constant logging - uncomment if needed for debugging
  // console.log("[updateStartButton]", {
  //   selectedChaserIndex,
  //   myColorIndex,
  //   gameStarted,
  //   shouldEnable: selectedChaserIndex !== null && myColorIndex === null
  // });
  
  if (selectedChaserIndex !== null && myColorIndex === null) {
    // Player has selected a chaser and hasn't joined yet - can click "Play" (even if game has started)
    elements.startBtn.disabled = false;
    elements.startBtn.classList.remove("disabled");
  } else {
    // Player hasn't selected a chaser OR player has already joined - disable button
    elements.startBtn.disabled = true;
    elements.startBtn.classList.add("disabled");
  }
}


function updateScoreDisplay() {
  let teamScore = 0;
  for (const player of connectedPlayers.values()) {
    if ((player.type === "chaser" || player.type === "ghost") && player.stats?.chaserScore) {
      teamScore = player.stats.chaserScore;
      break;
    }
  }
  if (elements.scoreValue) {
    elements.scoreValue.textContent = teamScore;
  }
}

function selectChaser(colorIndex) {
  if (!availableChasers.includes(colorIndex)) return;
  if (selectedChaserIndex === colorIndex) return; // Already selected

  // Prompt for initials when selecting a chaser
  const initials = promptForInitials();
  if (!initials) return; // User cancelled

  selectedChaserIndex = colorIndex;
  selectedChaserName = initials;
  
  // Update playerNames immediately so button shows name right away
  playerNames.set(colorIndex, initials);
  
  // Send selection to server to broadcast to other players
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "selectChaser",
      colorIndex: colorIndex,
      playerName: initials,
    }));
  }
  
  // Update UI to show selection with name immediately
  updateChaserButtons();
  updateStartButton();
}

function joinAsChaser() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (selectedChaserIndex === null) return;
  if (!availableChasers.includes(selectedChaserIndex)) return;

  ws.send(JSON.stringify({
    type: "join",
    characterType: "chaser",
    colorIndex: selectedChaserIndex,
    playerName: selectedChaserName,
  }));
}

// Joystick
function resetJoystick() {
  elements.joystickHandle.style.transform = "translate(-50%, -50%)";
  elements.joystickHandle.classList.remove("active");
  currentDir = null;
  joystickActive = false;
}

function updateJoystick(x, y) {
  const center = getJoystickCenter();
  const deltaX = x - center.x;
  const deltaY = y - center.y;
  const dir = calculateDirection(deltaX, deltaY);

  if (dir) {
    const moveX = Math.max(-center.maxDistance, Math.min(center.maxDistance, deltaX));
    const moveY = Math.max(-center.maxDistance, Math.min(center.maxDistance, deltaY));
    elements.joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    elements.joystickHandle.classList.add("active");
    currentDir = dir;
    sendInput(dir);
  } else {
    resetJoystick();
  }
}

function updateJoystickFromKey(dir) {
  if (!dir) {
    resetJoystick();
    return;
  }
  
  const center = getJoystickCenter();
  const moveX = dir === "left" ? -center.maxDistance : dir === "right" ? center.maxDistance : 0;
  const moveY = dir === "up" ? -center.maxDistance : dir === "down" ? center.maxDistance : 0;
  
  elements.joystickHandle.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
  elements.joystickHandle.classList.add("active");
  currentDir = dir;
}

// Input handlers
function handleKeyDown(e) {
  const dir = KEY_TO_DIR[e.key.toLowerCase()];
  if (!dir) return;
  
  e.preventDefault();
  e.stopPropagation();
  keys[e.key.toLowerCase()] = true;
  updateJoystickFromKey(dir);
  sendInput(dir);
}

function handleKeyUp(e) {
  const key = e.key.toLowerCase();
  if (!KEY_TO_DIR[key]) return;
  
  e.preventDefault();
  e.stopPropagation();
  keys[key] = false;
  
  // Find next active direction
  const dir = Object.entries(keys).find(([k, pressed]) => pressed && KEY_TO_DIR[k])?.[0];
  if (dir) {
    updateJoystickFromKey(KEY_TO_DIR[dir]);
  } else {
    resetJoystick();
  }
}

function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length > 0) {
    activeTouch = e.touches[0].identifier;
    const touch = e.touches[0];
    joystickActive = true;
    updateJoystick(touch.clientX, touch.clientY);
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (activeTouch === null) return;
  
  const touch = Array.from(e.touches).find(t => t.identifier === activeTouch);
  if (!touch) return;
  
  updateJoystick(touch.clientX, touch.clientY);
  
  // Send input continuously while dragging
  const center = getJoystickCenter();
  const dir = calculateDirection(touch.clientX - center.x, touch.clientY - center.y);
  if (dir) {
    const now = Date.now();
    if (now - lastInputTime >= INPUT_THROTTLE) {
      sendInput(dir);
    }
  }
}

function handleTouchEnd(e) {
  e.preventDefault();
  if (activeTouch !== null) {
    const touch = Array.from(e.changedTouches).find(t => t.identifier === activeTouch);
    if (touch) {
      resetJoystick();
      activeTouch = null;
    }
  }
}

function handleTouchCancel(e) {
  e.preventDefault();
  resetJoystick();
  activeTouch = null;
}

function handleMouseDown(e) {
  e.preventDefault();
  joystickActive = true;
  updateJoystick(e.clientX, e.clientY);
}

function handleMouseMove(e) {
  if (!joystickActive) return;
  
  updateJoystick(e.clientX, e.clientY);
  
  // Send input continuously while dragging
  const center = getJoystickCenter();
  const dir = calculateDirection(e.clientX - center.x, e.clientY - center.y);
  if (dir && currentDir === dir) {
    const now = Date.now();
    if (now - lastInputTime >= INPUT_THROTTLE) {
      sendInput(dir);
    }
  }
}

function handleMouseUp(e) {
  if (joystickActive) {
    resetJoystick();
    joystickActive = false;
  }
}

// Initialize DOM elements
function initElements() {
  elements = {
    joystickBase: document.getElementById("joystick-base"),
    joystickHandle: document.getElementById("joystick-handle"),
    chaserButtons: document.querySelectorAll(".chaser-btn[data-index]"),
    startBtn: document.getElementById("start-btn"),
    chaserSelect: document.getElementById("chaser-select"),
    scoreValue: document.getElementById("score-value")
  };
}

// Initialize event listeners
function initEventListeners() {
  if (!elements.joystickBase) return;

  elements.chaserButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const indexStr = btn.dataset.index;
      if (indexStr === "start") {
        console.log("[Play button click]", {
          selectedChaserIndex,
          myColorIndex,
          gameStarted,
          wsReady: ws?.readyState === WebSocket.OPEN
        });
        
        if (selectedChaserIndex !== null && myColorIndex === null && ws?.readyState === WebSocket.OPEN) {
          // Player has selected a chaser and hasn't joined yet - click "Play"
          if (!gameStarted) {
            // Game hasn't started - join and start the game
            console.log("[Play button click] Joining and starting game");
            pendingStartGame = true;
            joinAsChaser();
          } else {
            // Game has already started - just join
            console.log("[Play button click] Joining existing game");
            joinAsChaser();
          }
        } else {
          console.log("[Play button click] Cannot join", {
            hasSelection: selectedChaserIndex !== null,
            notJoined: myColorIndex === null,
            wsReady: ws?.readyState === WebSocket.OPEN
          });
        }
      } else {
        const index = parseInt(indexStr, 10);
        // Only allow selecting if:
        // - Valid index
        // - Chaser is available
        // - Not already selected
        // - Player hasn't joined yet (myColorIndex === null)
        if (!isNaN(index) && availableChasers.includes(index) && selectedChaserIndex !== index && myColorIndex === null && !takenChasers.has(index)) {
          console.log("[chaser button click] Selecting chaser", index, "myColorIndex:", myColorIndex);
          selectChaser(index);
        } else {
          console.log("[chaser button click] Cannot select chaser", {
            index,
            isValid: !isNaN(index),
            isAvailable: availableChasers.includes(index),
            notSelected: selectedChaserIndex !== index,
            notJoined: myColorIndex === null,
            notTaken: !takenChasers.has(index)
          });
        }
      }
    });
  });

  document.addEventListener("keydown", handleKeyDown, true);
  document.addEventListener("keyup", handleKeyUp, true);

  // Continuous input while key is held
  setInterval(() => {
    if (!gameStarted || !myPlayerId || myColorIndex === null) return;
    
    const activeKey = Object.entries(keys).find(([k, pressed]) => pressed && KEY_TO_DIR[k])?.[0];
    if (activeKey) {
      sendInput(KEY_TO_DIR[activeKey]);
    }
  }, INPUT_THROTTLE);

  elements.joystickBase.addEventListener("touchstart", handleTouchStart);
  elements.joystickBase.addEventListener("touchmove", handleTouchMove);
  elements.joystickBase.addEventListener("touchend", handleTouchEnd);
  elements.joystickBase.addEventListener("touchcancel", handleTouchCancel);
  elements.joystickBase.addEventListener("mousedown", handleMouseDown);
  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initElements();
    initEventListeners();
    updateUI();
    initWebSocket();
  });
} else {
  initElements();
  initEventListeners();
  updateUI();
  initWebSocket();
}
