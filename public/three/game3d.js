// 3D version of the Chasee/Chaser game using Three.js
// This is a separate 3D implementation that connects to the same server

import * as THREE from './three.module.js';

const { MAP, COLS, ROWS, TUNNEL_ROW } = PACMAN_MAP;
const CELL_SIZE = 20;
const CHARACTER_SIZE = 16;
const CHARACTER_OFFSET = (CELL_SIZE - CHARACTER_SIZE) / 2;

const COLORS = ["red", "green", "blue", "yellow"];

// Three.js setup
let scene, camera, renderer;
let chasees = [];
let chasers = [];
let items = [];
let ws;
let myPlayerId = null;
let myCharacterType = null;
let myColorIndex = null;
let connectedPlayers = new Map();

// Initialize Three.js scene
function init3D() {
  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  // Orthographic camera looking down from above (2D-like view)
  const viewSize = Math.max(COLS * CELL_SIZE, ROWS * CELL_SIZE) * 1.2;
  const aspect = window.innerWidth / window.innerHeight;
  
  let left, right, top, bottom;
  if (aspect >= 1) {
    // Landscape or square
    left = -viewSize * aspect / 2;
    right = viewSize * aspect / 2;
    top = viewSize / 2;
    bottom = -viewSize / 2;
  } else {
    // Portrait
    left = -viewSize / 2;
    right = viewSize / 2;
    top = viewSize / aspect / 2;
    bottom = -viewSize / aspect / 2;
  }
  
  camera = new THREE.OrthographicCamera(left, right, top, bottom, 0.1, 1000);
  camera.position.set(COLS * CELL_SIZE / 2, 200, ROWS * CELL_SIZE / 2);
  camera.lookAt(COLS * CELL_SIZE / 2, 0, ROWS * CELL_SIZE / 2);

  // Renderer
  const canvas = document.getElementById('webgl-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;

  // Lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(50, 100, 50);
  directionalLight.castShadow = true;
  scene.add(directionalLight);

  // Create maze
  createMaze3D();

  // Handle window resize
  window.addEventListener('resize', onWindowResize);
}

// Voxel size (smaller cubes for voxel look)
const VOXEL_SIZE = 4;
const VOXEL_HEIGHT = 16; // Height of wall voxels (twice as high)

function createMaze3D() {
  // Create voxel-based maze
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const cellType = MAP[y][x];
      const worldX = x * CELL_SIZE;
      const worldZ = y * CELL_SIZE;
      
      if (cellType === 1) { // Wall - build with voxels
        createWallVoxels(worldX, worldZ);
      } else if (cellType === 0 || cellType === 2) { // Path or teleport - create floor voxels
        createFloorVoxels(worldX, worldZ, cellType === 2);
      }
    }
  }
}

function createWallVoxels(worldX, worldZ) {
  // Create wall using multiple voxel cubes stacked vertically
  const voxelsPerCell = CELL_SIZE / VOXEL_SIZE;
  const voxelHeight = VOXEL_HEIGHT / VOXEL_SIZE;
  
  for (let vx = 0; vx < voxelsPerCell; vx++) {
    for (let vz = 0; vz < voxelsPerCell; vz++) {
      for (let vy = 0; vy < voxelHeight; vy++) {
        const voxelGeometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
        const voxelMaterial = new THREE.MeshStandardMaterial({ 
          color: 0x0066ff,
          roughness: 0.7,
          metalness: 0.1
        });
        const voxel = new THREE.Mesh(voxelGeometry, voxelMaterial);
        
        const offsetX = (vx - voxelsPerCell / 2 + 0.5) * VOXEL_SIZE;
        const offsetZ = (vz - voxelsPerCell / 2 + 0.5) * VOXEL_SIZE;
        const offsetY = (vy + 0.5) * VOXEL_SIZE;
        
        voxel.position.set(worldX + offsetX, offsetY, worldZ + offsetZ);
        voxel.castShadow = true;
        voxel.receiveShadow = true;
        scene.add(voxel);
      }
    }
  }
}

function createFloorVoxels(worldX, worldZ, isTeleport = false) {
  // Create floor using a single layer of voxels
  const voxelsPerCell = CELL_SIZE / VOXEL_SIZE;
  const floorColor = isTeleport ? 0x4444ff : 0x222222;
  
  for (let vx = 0; vx < voxelsPerCell; vx++) {
    for (let vz = 0; vz < voxelsPerCell; vz++) {
      const voxelGeometry = new THREE.BoxGeometry(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
      const voxelMaterial = new THREE.MeshStandardMaterial({ 
        color: floorColor,
        roughness: 0.8,
        metalness: 0.0
      });
      const voxel = new THREE.Mesh(voxelGeometry, voxelMaterial);
      
      const offsetX = (vx - voxelsPerCell / 2 + 0.5) * VOXEL_SIZE;
      const offsetZ = (vz - voxelsPerCell / 2 + 0.5) * VOXEL_SIZE;
      
      voxel.position.set(worldX + offsetX, VOXEL_SIZE / 2, worldZ + offsetZ);
      voxel.receiveShadow = true;
      scene.add(voxel);
    }
  }
}

function createChasee3D(color, x, y) {
  // Create chasee as a simple sphere
  const geometry = new THREE.SphereGeometry(CHARACTER_SIZE / 2, 16, 16);
  const colorHex = getColorHex(color);
  const material = new THREE.MeshStandardMaterial({ 
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.6
  });
  const chasee = new THREE.Mesh(geometry, material);
  chasee.position.set(x * CELL_SIZE + CHARACTER_OFFSET, CHARACTER_SIZE / 2, y * CELL_SIZE + CHARACTER_OFFSET);
  chasee.castShadow = true;
  scene.add(chasee);
  return chasee;
}

function createChaser3D(color, x, y) {
  // Create chaser as a simple cube
  const geometry = new THREE.BoxGeometry(CHARACTER_SIZE, CHARACTER_SIZE, CHARACTER_SIZE);
  const colorHex = getColorHex(color);
  const material = new THREE.MeshStandardMaterial({ 
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 0.4
  });
  const chaser = new THREE.Mesh(geometry, material);
  chaser.position.set(x * CELL_SIZE + CHARACTER_OFFSET, CHARACTER_SIZE / 2, y * CELL_SIZE + CHARACTER_OFFSET);
  chaser.castShadow = true;
  scene.add(chaser);
  return chaser;
}

function createItem3D(x, y) {
  // Create item using a small voxel cube
  const itemSize = 3;
  const voxelGeometry = new THREE.BoxGeometry(itemSize, itemSize, itemSize);
  const voxelMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xffff00,
    emissive: 0xffff00,
    emissiveIntensity: 1.0
  });
  const item = new THREE.Mesh(voxelGeometry, voxelMaterial);
  item.position.set(x * CELL_SIZE + CHARACTER_OFFSET, itemSize / 2 + 2, y * CELL_SIZE + CHARACTER_OFFSET);
  scene.add(item);
  return item;
}

// Helper function to convert color name to hex
function getColorHex(colorName) {
  const colorMap = {
    red: 0xff0000,
    green: 0x00ff00,
    blue: 0x0000ff,
    yellow: 0xffff00
  };
  return colorMap[colorName.toLowerCase()] || 0xffffff;
}

// WebSocket connection (same as 2D version)
function initWebSocket() {
  const serverAddress = "http://localhost:3000";
  const wsUrl = serverAddress.replace("https://", "wss://").replace("http://", "ws://");
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "gameState" }));
    }
  };
  
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case "connected":
      myPlayerId = data.playerId;
      break;
    case "gameState":
      if (data.positions) {
        updatePositions3D(data.positions);
      }
      if (data.items) {
        updateItems3D(data.items);
      }
      break;
  }
}

function updatePositions3D(positions) {
  // Update chasees
  if (positions.chasees) {
    positions.chasees.forEach((pos, index) => {
      if (!chasees[index]) {
        chasees[index] = createChasee3D(pos.color, pos.x, pos.y);
      } else {
        // Update position smoothly
        chasees[index].position.x = pos.px;
        chasees[index].position.z = pos.py;
      }
    });
  }
  
  // Update chasers
  if (positions.chasers) {
    positions.chasers.forEach((pos, index) => {
      if (!chasers[index]) {
        chasers[index] = createChaser3D(pos.color, pos.x, pos.y);
      } else {
        // Update position smoothly
        chasers[index].position.x = pos.px;
        chasers[index].position.z = pos.py;
      }
    });
  }
}

function updateItems3D(itemsData) {
  // Remove old items
  items.forEach(item => scene.remove(item));
  items = [];
  
  // Create new items
  itemsData.forEach(itemData => {
    if (!itemData.collected) {
      const item = createItem3D(itemData.x, itemData.y);
      items.push(item);
    }
  });
}

function onWindowResize() {
  // Update orthographic camera bounds
  const viewSize = Math.max(COLS * CELL_SIZE, ROWS * CELL_SIZE) * 1.2;
  const aspect = window.innerWidth / window.innerHeight;
  
  if (aspect >= 1) {
    // Landscape or square
    camera.left = -viewSize * aspect / 2;
    camera.right = viewSize * aspect / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
  } else {
    // Portrait
    camera.left = -viewSize / 2;
    camera.right = viewSize / 2;
    camera.top = viewSize / aspect / 2;
    camera.bottom = -viewSize / aspect / 2;
  }
  
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Animation loop
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// Initialize
init3D();
initWebSocket();
animate();

