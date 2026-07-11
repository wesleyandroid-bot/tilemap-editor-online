// ============ State ============
const VERSION = 'v1.0.1';
const RELEASE = '2025-02-11';
const AUTHOR = 'Wesley';
const EMAIL = 'wesley.android@gmail.com';

let tilesetImage = null;
let tileSize = 32;
let mapCols = 20;
let mapRows = 15;
let selectedTile = null; // {col, row}
let layers = [];
let activeLayer = 0;
let isDrawing = false;
let isErasing = false;
let tilesetImageData = null; // base64 of tileset for auto-save
let lastSaveTime = 0;
let autoSaveTimer = null;
let hasUnsavedChanges = false;
let mapZoom = 1;

// Panning state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panScrollLeft = 0;
let panScrollTop = 0;

// Undo/Redo
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

// ============ DOM Elements ============
const tilesetCanvas = document.getElementById('tileset-canvas');
const tilesetCtx = tilesetCanvas.getContext('2d');
const mapCanvas = document.getElementById('map-canvas');
const mapCtx = mapCanvas.getContext('2d');
const previewCanvas = document.getElementById('preview-canvas');
const previewCtx = previewCanvas.getContext('2d');

// ============ Initialize ============
function init() {
  // Default empty layer
  addLayer();
  
  // Event listeners
  document.getElementById('tileset-input').addEventListener('change', handleTilesetLoad);
  document.getElementById('json-input').addEventListener('change', handleJSONImport);
  document.getElementById('tile-size').addEventListener('change', (e) => {
    tileSize = parseInt(e.target.value) || 32;
    if (tilesetImage) renderTileset();
  });
  document.getElementById('show-grid').addEventListener('change', () => renderMap());
  document.getElementById('layer-opacity').addEventListener('input', (e) => {
    if (layers[activeLayer]) {
      layers[activeLayer].opacity = e.target.value / 100;
      renderMap();
    }
  });
  document.getElementById('layer-name').addEventListener('change', (e) => {
    if (layers[activeLayer]) {
      layers[activeLayer].name = e.target.value;
      renderLayers();
      updateCurrentLayerDisplay();
    }
  });
  
  // Tileset click
  tilesetCanvas.addEventListener('click', onTilesetClick);
  tilesetCanvas.addEventListener('mousemove', onTilesetHover);
  
  // Map drawing
  mapCanvas.addEventListener('mousedown', onMapMouseDown);
  mapCanvas.addEventListener('mousemove', onMapMouseMove);
  mapCanvas.addEventListener('mouseup', () => { isDrawing = false; stateSaved = false; isPanning = false; });
  mapCanvas.addEventListener('mouseleave', () => { isDrawing = false; stateSaved = false; isPanning = false; });

  // Panning with middle mouse button
  const mapContainer = document.getElementById('map-container');
  mapContainer.addEventListener('mousedown', onPanStart);
  mapContainer.addEventListener('mousemove', onPanMove);
  mapContainer.addEventListener('mouseup', onPanEnd);
  mapContainer.addEventListener('mouseleave', onPanEnd);
  mapCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    selectedTile = null;
    previewCtx.clearRect(0, 0, 64, 64);
  });
  
  // Map hover
  mapCanvas.addEventListener('mousemove', onMapHover);
  mapCanvas.addEventListener('mouseleave', () => {
    document.getElementById('status-pos').textContent = '浣嶇疆: -';
  });
  
  // Tileset panel resize
  initResize();

  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);

  resizeMapCanvas();
  renderLayers();
}

// ============ Panel Resize ============
function initResize() {
  // Left panel (tileset)
  const leftHandle = document.getElementById('tileset-resize');
  const leftPanel = document.getElementById('tileset-panel');
  let isResizingLeft = false;
  
  leftHandle.addEventListener('mousedown', (e) => {
    isResizingLeft = true;
    leftHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  
  // Right panel (layers)
  const rightHandle = document.getElementById('right-resize');
  const rightPanel = document.getElementById('right-panel');
  let isResizingRight = false;
  
  rightHandle.addEventListener('mousedown', (e) => {
    isResizingRight = true;
    rightHandle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (isResizingLeft) {
      const newWidth = e.clientX;
      if (newWidth >= 200 && newWidth <= 600) {
        leftPanel.style.width = newWidth + 'px';
      }
    }
    if (isResizingRight) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 180 && newWidth <= 400) {
        rightPanel.style.width = newWidth + 'px';
      }
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizingLeft) {
      isResizingLeft = false;
      leftHandle.classList.remove('active');
    }
    if (isResizingRight) {
      isResizingRight = false;
      rightHandle.classList.remove('active');
    }
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ============ Undo/Redo ============
function saveState() {
  // Deep clone layers data
  const state = layers.map(layer => ({
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    data: layer.data.map(row => row.map(tile => tile ? { ...tile } : null))
  }));
  undoStack.push({ layers: state, activeLayer });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  // Save current state to redo
  const currentState = layers.map(layer => ({
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    data: layer.data.map(row => row.map(tile => tile ? { ...tile } : null))
  }));
  redoStack.push({ layers: currentState, activeLayer });
  // Restore previous state
  const prev = undoStack.pop();
  layers = prev.layers;
  activeLayer = prev.activeLayer;
  renderLayers();
  renderMap();
  updateStatus();
  updateCurrentLayerDisplay();
}

function redo() {
  if (redoStack.length === 0) return;
  // Save current state to undo
  const currentState = layers.map(layer => ({
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    data: layer.data.map(row => row.map(tile => tile ? { ...tile } : null))
  }));
  undoStack.push({ layers: currentState, activeLayer });
  // Restore redo state
  const next = redoStack.pop();
  layers = next.layers;
  activeLayer = next.activeLayer;
  renderLayers();
  renderMap();
  updateStatus();
  updateCurrentLayerDisplay();
}

function updateStatus() {
  document.getElementById('status-layer').textContent = `鍥惧眰: ${layers[activeLayer]?.name || '-'}`;
}

function handleKeyboard(e) {
  // Ctrl+Z = Undo
  if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  // Ctrl+Y or Ctrl+Shift+Z = Redo
  if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'z')) {
    e.preventDefault();
    redo();
  }
  // Ctrl+S = Save
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveLocal();
  }
  // Delete = Erase selected tile
  if (e.key === 'Delete') {
    selectedTile = null;
    previewCtx.clearRect(0, 0, 64, 64);
  }
  // Escape = Close modals
  if (e.key === 'Escape') {
    closeExport();
    closeIsometricPreview();
  }
  // Ctrl++ = Zoom in
  if (e.ctrlKey && e.key === '=') {
    e.preventDefault();
    zoomIn();
  }
  // Ctrl+- = Zoom out
  if (e.ctrlKey && e.key === '-') {
    e.preventDefault();
    zoomOut();
  }
  // Ctrl+0 = Reset zoom
  if (e.ctrlKey && e.key === '0') {
    e.preventDefault();
    zoomReset();
  }
}

// ============ Tileset ============
function loadTileset() {
  document.getElementById('tileset-input').click();
}

function handleTilesetLoad(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    tilesetImageData = ev.target.result; // Save base64 for auto-save
    const img = new Image();
    img.onload = () => {
      tilesetImage = img;
      tileSize = parseInt(document.getElementById('tile-size').value) || 32;
      renderTileset();
      document.getElementById('tileset-info').textContent =
        `${file.name} | ${img.width}x${img.height} | ${Math.floor(img.width/tileSize)}x${Math.floor(img.height/tileSize)} 鐡︾墖`;
      markUnsaved();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function renderTileset() {
  if (!tilesetImage) return;
  
  const cols = Math.floor(tilesetImage.width / tileSize);
  const rows = Math.floor(tilesetImage.height / tileSize);
  
  tilesetCanvas.width = tilesetImage.width;
  tilesetCanvas.height = tilesetImage.height;
  tilesetCtx.drawImage(tilesetImage, 0, 0);
  
  // Draw grid
  tilesetCtx.strokeStyle = 'rgba(255,255,255,0.3)';
  tilesetCtx.lineWidth = 1;
  for (let c = 0; c <= cols; c++) {
    tilesetCtx.beginPath();
    tilesetCtx.moveTo(c * tileSize + 0.5, 0);
    tilesetCtx.lineTo(c * tileSize + 0.5, rows * tileSize);
    tilesetCtx.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    tilesetCtx.beginPath();
    tilesetCtx.moveTo(0, r * tileSize + 0.5);
    tilesetCtx.lineTo(cols * tileSize, r * tileSize + 0.5);
    tilesetCtx.stroke();
  }
}

function onTilesetClick(e) {
  if (!tilesetImage) return;
  
  const rect = tilesetCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);
  
  selectedTile = { col, row };
  
  // Draw preview
  previewCtx.clearRect(0, 0, 64, 64);
  previewCtx.imageSmoothingEnabled = false;
  previewCtx.drawImage(
    tilesetImage,
    col * tileSize, row * tileSize, tileSize, tileSize,
    0, 0, 64, 64
  );

  document.getElementById('status-tile').textContent = `鐡︾墖: [${col}, ${row}]`;
}

function onTilesetHover(e) {
  if (!tilesetImage) return;
  
  const rect = tilesetCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);
  
  // Highlight on tileset
  renderTileset();
  tilesetCtx.strokeStyle = '#ff0';
  tilesetCtx.lineWidth = 2;
  tilesetCtx.strokeRect(col * tileSize, row * tileSize, tileSize, tileSize);
}

// ============ Panning ============
function onPanStart(e) {
  // Middle mouse button (1) or Alt+Left click
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    const container = document.getElementById('map-container');
    panScrollLeft = container.scrollLeft;
    panScrollTop = container.scrollTop;
    container.classList.add('panning');
  }
}

function onPanMove(e) {
  if (!isPanning) return;
  e.preventDefault();
  const dx = e.clientX - panStartX;
  const dy = e.clientY - panStartY;
  const container = document.getElementById('map-container');
  container.scrollLeft = panScrollLeft - dx;
  container.scrollTop = panScrollTop - dy;
}

function onPanEnd(e) {
  if (isPanning) {
    isPanning = false;
    const container = document.getElementById('map-container');
    container.classList.remove('panning');
  }
}

// ============ Map ============
function resizeMapCanvas() {
  mapCanvas.width = mapCols * tileSize;
  mapCanvas.height = mapRows * tileSize;
  document.getElementById('status-size').textContent = `鍦板浘: ${mapCols}x${mapRows}`;
  applyMapZoom();
}

function applyMapZoom() {
  mapCanvas.style.transform = `scale(${mapZoom})`;
  mapCanvas.style.transformOrigin = 'center center';
  document.getElementById('zoom-level').textContent = Math.round(mapZoom * 100) + '%';
}

function zoomIn() {
  if (mapZoom < 3) {
    mapZoom = Math.min(3, Math.round((mapZoom + 0.1) * 10) / 10);
    applyMapZoom();
  }
}

function zoomOut() {
  if (mapZoom > 0.2) {
    mapZoom = Math.max(0.2, Math.round((mapZoom - 0.1) * 10) / 10);
    applyMapZoom();
  }
}

function zoomReset() {
  mapZoom = 1;
  applyMapZoom();
}

function resizeMap() {
  saveState();
  mapCols = parseInt(document.getElementById('map-cols').value) || 20;
  mapRows = parseInt(document.getElementById('map-rows').value) || 15;

  // Resize all layers
  layers.forEach(layer => {
    const newData = [];
    for (let r = 0; r < mapRows; r++) {
      newData[r] = [];
      for (let c = 0; c < mapCols; c++) {
        newData[r][c] = (layer.data[r] && layer.data[r][c]) || null;
      }
    }
    layer.data = newData;
  });

  markChanged();
  resizeMapCanvas();
  renderMap();
}

let stateSaved = false;

function onMapMouseDown(e) {
  if (e.button === 2) {
    isErasing = true;
    isDrawing = true;
    stateSaved = false;
    eraseAt(e);
  } else if (e.button === 0) {
    isErasing = false;
    isDrawing = true;
    stateSaved = false;
    placeAt(e);
  }
}

function onMapMouseMove(e) {
  if (!isDrawing) return;
  if (isErasing) eraseAt(e);
  else placeAt(e);
}

function placeAt(e) {
  if (!selectedTile || !layers[activeLayer]) return;

  const rect = mapCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / mapZoom;
  const y = (e.clientY - rect.top) / mapZoom;

  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);

  if (col >= 0 && col < mapCols && row >= 0 && row < mapRows) {
    if (!stateSaved) {
      saveState();
      stateSaved = true;
    }
    layers[activeLayer].data[row][col] = { ...selectedTile };
    markChanged();
    renderMap();
  }
}

function eraseAt(e) {
  if (!layers[activeLayer]) return;

  const rect = mapCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / mapZoom;
  const y = (e.clientY - rect.top) / mapZoom;

  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);

  if (col >= 0 && col < mapCols && row >= 0 && row < mapRows) {
    if (!stateSaved) {
      saveState();
      stateSaved = true;
    }
    layers[activeLayer].data[row][col] = null;
    markChanged();
    renderMap();
  }
}

function onMapHover(e) {
  const rect = mapCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / mapZoom;
  const y = (e.clientY - rect.top) / mapZoom;

  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);

  document.getElementById('status-pos').textContent = `浣嶇疆: [${col}, ${row}]`;
}

function renderMap() {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

  // Draw background
  mapCtx.fillStyle = '#1a1a2a';
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);

  // Draw watermark
  drawWatermark();

  // Draw each layer
  layers.forEach((layer, idx) => {
    if (!layer.visible) return;
    
    mapCtx.globalAlpha = layer.opacity;
    
    for (let r = 0; r < mapRows; r++) {
      for (let c = 0; c < mapCols; c++) {
        const tile = layer.data[r] && layer.data[r][c];
        if (tile && tilesetImage) {
          mapCtx.drawImage(
            tilesetImage,
            tile.col * tileSize, tile.row * tileSize, tileSize, tileSize,
            c * tileSize, r * tileSize, tileSize, tileSize
          );
        }
      }
    }
    
    mapCtx.globalAlpha = 1;
  });
  
  // Draw grid
  if (document.getElementById('show-grid').value === '1') {
    mapCtx.strokeStyle = 'rgba(255,255,255,0.15)';
    mapCtx.lineWidth = 1 / mapZoom;
    for (let c = 0; c <= mapCols; c++) {
      mapCtx.beginPath();
      mapCtx.moveTo(c * tileSize, 0);
      mapCtx.lineTo(c * tileSize, mapRows * tileSize);
      mapCtx.stroke();
    }
    for (let r = 0; r <= mapRows; r++) {
      mapCtx.beginPath();
      mapCtx.moveTo(0, r * tileSize);
      mapCtx.lineTo(mapCols * tileSize, r * tileSize);
      mapCtx.stroke();
    }
  }
}

function drawWatermark() {
  mapCtx.save();
  mapCtx.globalAlpha = 0.03;
  mapCtx.fillStyle = '#ffffff';
  mapCtx.font = '14px Arial';
  mapCtx.textAlign = 'center';
  mapCtx.textBaseline = 'middle';

  const spacing = 120;
  const text = 'TILE MAP';

  for (let y = spacing / 2; y < mapCanvas.height; y += spacing) {
    for (let x = spacing / 2; x < mapCanvas.width; x += spacing) {
      mapCtx.save();
      mapCtx.translate(x, y);
      mapCtx.rotate(-Math.PI / 6);
      mapCtx.fillText(text, 0, 0);
      mapCtx.restore();
    }
  }
  mapCtx.restore();
}

// ============ Layers ============
function addLayer() {
  saveState();
  const id = layers.length;
  const layer = {
    name: `Layer ${id + 1}`,
    visible: true,
    opacity: 1,
    data: Array.from({ length: mapRows }, () => Array(mapCols).fill(null))
  };
  layers.push(layer);
  markChanged();
  renderLayers();
}

function selectLayer(idx) {
  activeLayer = idx;
  document.getElementById('layer-name').value = layers[idx].name;
  document.getElementById('layer-opacity').value = layers[idx].opacity * 100;
  renderLayers();
  document.getElementById('status-layer').textContent = `鍥惧眰: ${layers[idx].name}`;
  updateCurrentLayerDisplay();
}

function updateCurrentLayerDisplay() {
  const layer = layers[activeLayer];
  if (layer) {
    document.getElementById('current-layer-display').textContent = `褰撳墠鍥惧眰锛?{layer.name}`;
  }
}

function deleteLayer(idx) {
  if (layers.length <= 1) return alert('鑷冲皯淇濈暀涓€涓浘灞?);
  if (!confirm(`纭畾鍒犻櫎鍥惧眰 "${layers[idx].name}" 鍚楋紵`)) return;
  saveState();
  layers.splice(idx, 1);
  if (activeLayer >= layers.length) activeLayer = layers.length - 1;
  markChanged();
  renderLayers();
  renderMap();
  updateCurrentLayerDisplay();
}

function toggleLayerVisibility(idx) {
  saveState();
  layers[idx].visible = !layers[idx].visible;
  markChanged();
  renderLayers();
  renderMap();
}

function moveLayerUp(idx) {
  if (idx >= layers.length - 1) return;
  saveState();
  [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
  if (activeLayer === idx) activeLayer = idx + 1;
  else if (activeLayer === idx + 1) activeLayer = idx;
  markChanged();
  renderLayers();
  renderMap();
  updateCurrentLayerDisplay();
}

function moveLayerDown(idx) {
  if (idx <= 0) return;
  saveState();
  [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]];
  if (activeLayer === idx) activeLayer = idx - 1;
  else if (activeLayer === idx - 1) activeLayer = idx;
  markChanged();
  renderLayers();
  renderMap();
  updateCurrentLayerDisplay();
}

function renderLayers() {
  const container = document.getElementById('layers-list');
  container.innerHTML = '';

  // Render in reverse order (top layer first in UI)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    const isFirst = i === 0;
    const isLast = i === layers.length - 1;
    const div = document.createElement('div');
    div.className = `layer-item ${i === activeLayer ? 'active' : ''}`;
    div.onclick = () => selectLayer(i);
    div.innerHTML = `
      <span>${layer.visible ? '馃憗' : '馃毇'} ${layer.name}</span>
      <div style="display:flex;gap:2px;align-items:center">
        <button onclick="moveLayerUp(${i})" title="涓婄Щ" style="background:${isLast ? '#444' : '#666'};padding:2px 4px;${isLast ? 'opacity:0.4;cursor:default' : ''}" ${isLast ? 'disabled' : ''}>鈻?/button>
        <button onclick="moveLayerDown(${i})" title="涓嬬Щ" style="background:${isFirst ? '#444' : '#666'};padding:2px 4px;${isFirst ? 'opacity:0.4;cursor:default' : ''}" ${isFirst ? 'disabled' : ''}>鈻?/button>
        <button onclick="toggleLayerVisibility(${i})" style="background:#666;padding:2px 5px">${layer.visible ? '馃憗' : '馃毇'}</button>
        <button onclick="deleteLayer(${i})" style="background:#e74c3c;padding:2px 5px">鉁?/button>
      </div>
    `;
    container.appendChild(div);
  }
}

// ============ Export ============
function exportJSON() {
  const tilesetCols = tilesetImage ? Math.floor(tilesetImage.width / tileSize) : 0;
  const tilesetRows = tilesetImage ? Math.floor(tilesetImage.height / tileSize) : 0;

  const exportData = {
    width: mapCols,
    height: mapRows,
    tilewidth: tileSize,
    tileheight: tileSize,
    layers: layers.map(layer => ({
      name: layer.name,
      type: "tilelayer",
      visible: layer.visible,
      opacity: layer.opacity,
      width: mapCols,
      height: mapRows,
      data: layer.data.flat().map(tile => tile ? tile.row * tilesetCols + tile.col : -1)
    })),
    tilesets: [{
      name: document.getElementById('tileset-input').files[0]?.name?.replace(/\.[^.]+$/, '') || 'tileset',
      image: document.getElementById('tileset-input').files[0]?.name || 'tileset.png',
      imagewidth: tilesetImage ? tilesetImage.width : 0,
      imageheight: tilesetImage ? tilesetImage.height : 0,
      tilewidth: tileSize,
      tileheight: tileSize,
      columns: tilesetCols,
      tilecount: tilesetCols * tilesetRows,
      firstgid: 1
    }]
  };

  document.getElementById('json-output').value = JSON.stringify(exportData, null, 2);
  document.getElementById('export-modal').classList.add('show');
}

function closeExport() {
  document.getElementById('export-modal').classList.remove('show');
}

function importJSON() {
  document.getElementById('json-input').click();
}

function handleJSONImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (!tilesetImage) {
    alert('璇峰厛鍔犺浇鐡︾墖绱犳潗鍥剧墖锛?);
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);

      // Validate
      if (!data.width || !data.height || !data.layers) {
        alert('鏃犳晥鐨凧SON鏍煎紡锛?);
        return;
      }

      // Apply
      mapCols = data.width;
      mapRows = data.height;
      tileSize = data.tilewidth || data.tileSize || 32;

      document.getElementById('tile-size').value = tileSize;
      document.getElementById('map-cols').value = mapCols;
      document.getElementById('map-rows').value = mapRows;

      const tilesetCols = tilesetImage ? Math.floor(tilesetImage.width / tileSize) : 0;

      layers = data.layers.map(layer => {
        // Tiled format: data is flat array with global tile IDs
        const flatData = Array.isArray(layer.data[0])
          ? layer.data.flat()
          : layer.data;

        const grid = [];
        for (let r = 0; r < mapRows; r++) {
          grid[r] = [];
          for (let c = 0; c < mapCols; c++) {
            const gid = flatData[r * mapCols + c];
            if (gid && gid > 0) {
              const tileGid = gid - 1;
              grid[r][c] = {
                col: tileGid % tilesetCols,
                row: Math.floor(tileGid / tilesetCols)
              };
            } else {
              grid[r][c] = null;
            }
          }
        }

        return {
          name: layer.name || 'Layer',
          visible: layer.visible !== false,
          opacity: layer.opacity ?? 1,
          data: grid
        };
      });

      activeLayer = 0;
      undoStack = [];
      redoStack = [];

      resizeMapCanvas();
      renderLayers();
      renderMap();
      updateCurrentLayerDisplay();
      localStorage.removeItem('tilemap-editor-save');
      showSaveIndicator('JSON宸插鍏?);
    } catch (err) {
      alert('JSON瑙ｆ瀽澶辫触: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function copyJSON() {
  const textarea = document.getElementById('json-output');
  textarea.select();
  document.execCommand('copy');
  alert('宸插鍒跺埌鍓创鏉匡紒');
}

function downloadJSON() {
  const data = document.getElementById('json-output').value;
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'map.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ============ Save/Load Local ============
function saveLocal(showAlert = false) {
  try {
    const data = {
      tileSize,
      mapCols,
      mapRows,
      layers,
      activeLayer,
      tilesetImage: tilesetImageData, // base64 of tileset
      lastSave: Date.now()
    };
    localStorage.setItem('tilemap-editor-save', JSON.stringify(data));
    lastSaveTime = Date.now();
    hasUnsavedChanges = false;
    showSaveIndicator('宸蹭繚瀛?);
    if (showAlert) alert('宸蹭繚瀛樺埌鏈湴瀛樺偍锛?);
  } catch (e) {
    console.error('Save failed:', e);
    showSaveIndicator('淇濆瓨澶辫触', true);
  }
}

function loadLocal() {
  const saved = localStorage.getItem('tilemap-editor-save');
  if (!saved) return alert('娌℃湁鎵惧埌淇濆瓨鐨勬暟鎹?);

  try {
    const data = JSON.parse(saved);
    tileSize = data.tileSize;
    mapCols = data.mapCols;
    mapRows = data.mapRows;
    layers = data.layers;
    activeLayer = data.activeLayer;

    document.getElementById('tile-size').value = tileSize;
    document.getElementById('map-cols').value = mapCols;
    document.getElementById('map-rows').value = mapRows;

    // Restore tileset image
    if (data.tilesetImage) {
      tilesetImageData = data.tilesetImage;
      const img = new Image();
      img.onload = () => {
        tilesetImage = img;
        renderTileset();
        renderMap();
      };
      img.src = data.tilesetImage;
    }

    resizeMapCanvas();
    renderLayers();
    renderMap();
    updateCurrentLayerDisplay();
    showSaveIndicator('宸茶鍙?);
  } catch (e) {
    alert('璇诲彇澶辫触: ' + e.message);
  }
}

function clearMap() {
  if (!confirm('纭畾瑕佹竻绌哄湴鍥惧悧锛?)) return;
  saveState();
  layers.forEach(layer => {
    layer.data = Array.from({ length: mapRows }, () => Array(mapCols).fill(null));
  });
  localStorage.removeItem('tilemap-editor-save');
  renderMap();
  markUnsaved();
}

// ============ Auto-save ============
function showSaveIndicator(text, isError = false) {
  const indicator = document.getElementById('save-indicator');
  indicator.textContent = text;
  indicator.className = isError ? 'saving' : 'show';
  setTimeout(() => {
    indicator.className = '';
  }, 2000);
}

function markUnsaved() {
  hasUnsavedChanges = true;
}

function autoSave() {
  if (!hasUnsavedChanges) return;
  saveLocal(false);
}

function startAutoSave() {
  // Auto-save every 30 seconds if there are changes
  autoSaveTimer = setInterval(autoSave, 30000);
}

// Mark changes when drawing
function markChanged() {
  hasUnsavedChanges = true;
}

// ============ Isometric Preview ============
function showIsometricPreview() {
  if (!tilesetImage) {
    alert('璇峰厛鍔犺浇鐡︾墖绱犳潗鍥剧墖锛?);
    return;
  }
  document.getElementById('iso-modal').classList.add('show');
  renderIsometric();
}

function closeIsometricPreview() {
  document.getElementById('iso-modal').classList.remove('show');
}

function renderIsometric() {
  const canvas = document.getElementById('iso-canvas');
  const ctx = canvas.getContext('2d');
  const showGrid = document.getElementById('iso-grid').checked;

  // Isometric tile dimensions
  const tileW = tileSize;
  const tileH = tileSize * 0.5;

  // Calculate canvas size
  const isoWidth = (mapCols + mapRows) * tileW / 2 + tileW;
  const isoHeight = (mapCols + mapRows) * tileH / 2 + tileH;

  canvas.width = isoWidth;
  canvas.height = isoHeight;

  // Fill background
  ctx.fillStyle = '#1a1a2a';
  ctx.fillRect(0, 0, isoWidth, isoHeight);

  // Draw watermark
  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spacing = 120;
  const text = 'TILE MAP';
  for (let y = spacing / 2; y < isoHeight; y += spacing) {
    for (let x = spacing / 2; x < isoWidth; x += spacing) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 6);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // Draw tiles layer by layer (bottom to top)
  layers.forEach(layer => {
    if (!layer.visible) return;
    ctx.globalAlpha = layer.opacity;

    // Draw back-to-front for proper overlap
    for (let sum = 0; sum < mapCols + mapRows - 1; sum++) {
      for (let col = 0; col <= sum; col++) {
        const row = sum - col;
        if (col >= mapCols || row >= mapRows) continue;

        const tile = layer.data[row] && layer.data[row][col];
        if (!tile) continue;

        // Calculate isometric position
        const x = (col - row) * tileW / 2 + isoWidth / 2 - tileW / 2;
        const y = (col + row) * tileH / 2;

        // Draw tile as diamond
        ctx.save();
        ctx.translate(x + tileW / 2, y + tileH / 2);

        // Skew transform for isometric
        ctx.transform(1, 0.5, -1, 0.5, 0, 0);

        ctx.drawImage(
          tilesetImage,
          tile.col * tileSize, tile.row * tileSize, tileSize, tileSize,
          -tileW / 2, -tileH, tileSize, tileSize
        );

        ctx.restore();
      }
    }

    ctx.globalAlpha = 1;
  });

  // Draw grid
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;

    for (let row = 0; row <= mapRows; row++) {
      for (let col = 0; col <= mapCols; col++) {
        const x = (col - row) * tileW / 2 + isoWidth / 2 - tileW / 2;
        const y = (col + row) * tileH / 2;

        ctx.beginPath();
        ctx.moveTo(x + tileW / 2, y);
        ctx.lineTo(x + tileW, y + tileH / 2);
        ctx.lineTo(x + tileW / 2, y + tileH);
        ctx.lineTo(x, y + tileH / 2);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
}

function downloadIsometricPNG() {
  const canvas = document.getElementById('iso-canvas');
  const link = document.createElement('a');
  link.download = 'map-isometric.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

document.getElementById('iso-grid')?.addEventListener('change', () => {
  renderIsometric();
});

// ============ Version Info ============
function showVersionInfo() {
  document.getElementById('modal-version').textContent = VERSION;
  document.getElementById('modal-release').textContent = RELEASE;
  document.getElementById('modal-author').textContent = AUTHOR;
  document.getElementById('modal-email').textContent = EMAIL;
  document.getElementById('version-modal').style.display = 'flex';
}

function closeVersionModal() {
  document.getElementById('version-modal').style.display = 'none';
}

// ============ Start ============
init();
startAutoSave();
// Try to restore previous session
if (localStorage.getItem('tilemap-editor-save')) {
  loadLocal();
}
