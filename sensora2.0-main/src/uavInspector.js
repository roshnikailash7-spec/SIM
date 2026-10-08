export class UavInspector {
  constructor(simEngine, digitalTwinView, uavController) {
    this.simEngine = simEngine;
    this.digitalTwinView = digitalTwinView;
    this.uavController = uavController;
    this.isOpen = false;
    this.selectedUavId = 'UAV-01';
    
    // Module Registry (Extensible)
    this.moduleRegistry = [
      { id: 'thermal', label: 'Thermal', enabled: true, render: () => this.renderThermalView() },
      { id: 'rgb', label: 'RGB Camera', enabled: false, render: () => this.renderPlaceholder('RGB CAMERA') },
      { id: 'lidar', label: 'LiDAR', enabled: false, render: () => this.renderPlaceholder('LiDAR SENSOR') },
      { id: 'telemetry', label: 'Telemetry', enabled: false, render: () => this.renderPlaceholder('ADVANCED TELEMETRY') }
    ];
    this.activeModuleId = 'thermal';

    // Elements
    this.panelEl = document.getElementById('uav-inspector-panel');
    this.btnClose = document.getElementById('btn-close-inspector');
    this.tabsEl = document.getElementById('uav-inspector-tabs');
    this.contentEl = document.getElementById('uav-inspector-content');
    
    this.elState = document.getElementById('insp-uav-state');
    this.elAlt = document.getElementById('insp-uav-alt');
    this.elSpd = document.getElementById('insp-uav-spd');
    this.elBat = document.getElementById('insp-uav-bat');
    
    if (this.btnClose) {
      this.btnClose.addEventListener('click', () => this.close());
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    this.renderTabs();
  }

  renderTabs() {
    if (!this.tabsEl) return;
    this.tabsEl.innerHTML = this.moduleRegistry.map(mod => `
      <button class="insp-tab-btn ${this.activeModuleId === mod.id ? 'active' : ''}" 
              data-id="${mod.id}">
        ${mod.label} ${mod.enabled ? '' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-left:4px; vertical-align:middle;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'}
      </button>
    `).join('');
    
    this.tabsEl.querySelectorAll('.insp-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.activeModuleId = e.currentTarget.dataset.id;
        this.renderTabs();
        this.renderActiveModule();
      });
    });
  }

  renderActiveModule() {
    if (!this.contentEl) return;
    const mod = this.moduleRegistry.find(m => m.id === this.activeModuleId);
    if (mod && mod.render) {
      mod.render();
    } else {
      this.renderPlaceholder('MODULE NOT FOUND');
    }
  }

  renderPlaceholder(title) {
    const isEnabled = this.moduleRegistry.find(m => m.id === this.activeModuleId)?.enabled;
    this.contentEl.innerHTML = `
      <div class="module-placeholder">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <div style="font-weight:bold; margin-bottom:4px;">${title}</div>
        <div>${isEnabled ? 'Module active but no render function.' : 'Hardware module offline or not installed.'}</div>
      </div>
    `;
  }

  renderThermalView() {
    this.contentEl.innerHTML = `
      <div class="thermal-layout">
        <div class="thermal-view-wrapper">
          <canvas id="thermal-canvas" width="340" height="190"></canvas>
          <div class="thermal-crosshair"></div>
          <div class="thermal-scale-bar"></div>
          <div class="thermal-overlay-text top-left" id="th-timestamp">00:00:00</div>
          <div class="thermal-overlay-text bottom-left" id="th-status">THERMAL STANDBY</div>
          <div class="thermal-overlay-text top-right">SIMULATED THERMAL DATA</div>
          <div id="thermal-bounding-boxes"></div>
        </div>
        <div class="thermal-readouts">
          <div class="th-readout"><span>AMB:</span> <span id="th-amb">24.0°C</span></div>
          <div class="th-readout"><span>MAX:</span> <span id="th-max">--</span></div>
          <div class="th-readout"><span>TGT:</span> <span id="th-tgt">NONE</span></div>
          <div class="th-readout"><span>CONF:</span> <span id="th-conf">--</span></div>
        </div>
        <div class="thermal-analysis-panel">
          <div class="analysis-header" style="display:flex; align-items:center; gap:8px;">
            <span>TEMP & SPECTROGRAM</span>
            <select id="sel-spectrogram" class="hud-select" style="width: 80px; padding: 2px; font-size: 8px;">
              <option value="human">Human</option>
              <option value="animal">Animal</option>
              <option value="drone">Drone</option>
              <option value="tree">Tree</option>
              <option value="static">Static Object</option>
            </select>
            <button id="btn-th-lock" class="btn-micro" title="Lock drone on target" style="margin-left:auto;">LOCK TARGET</button>
          </div>
          <div class="analysis-graphs">
            <canvas id="th-temp-graph" width="160" height="60"></canvas>
            <canvas id="th-signal-graph" width="160" height="60"></canvas>
          </div>
        </div>
      </div>
    `;
    this.thermalCanvas = document.getElementById('thermal-canvas');
    this.thermalCtx = this.thermalCanvas.getContext('2d');
    
    this.tempGraphCanvas = document.getElementById('th-temp-graph');
    this.tempGraphCtx = this.tempGraphCanvas.getContext('2d');
    this.signalGraphCanvas = document.getElementById('th-signal-graph');
    this.signalGraphCtx = this.signalGraphCanvas.getContext('2d');
    this.tempHistory = Array(80).fill(24.5);
    this.signalOffset = 0;

    const btnLock = document.getElementById('btn-th-lock');
    if (btnLock && this.uavController) {
      btnLock.addEventListener('click', () => {
        const isLocked = this.uavController.toggleTargetLock();
        btnLock.textContent = isLocked ? 'UNLOCK' : 'LOCK TARGET';
        btnLock.style.backgroundColor = isLocked ? '#ef4444' : '';
      });
    }

    this.startThermalLoop();
  }

  startThermalLoop() {
    if (this.thermalLoop) return;
    let lastTime = 0;
    const loop = (now) => {
      if (!this.isOpen || this.activeModuleId !== 'thermal') {
        this.thermalLoop = null;
        return; // Stop loop
      }
      if (now - lastTime > 66) { // ~15 FPS
        this.drawThermal();
        lastTime = now;
      }
      this.thermalLoop = requestAnimationFrame(loop);
    };
    this.thermalLoop = requestAnimationFrame(loop);
  }

  drawThermal() {
    if (!this.thermalCtx) return;
    const w = this.thermalCanvas.width;
    const h = this.thermalCanvas.height;
    
    const state = this.lastUavState || {};
    
    if (state.state === 'PARKED' || state.state === 'LANDED' || !state.state) {
      this.thermalCtx.fillStyle = '#020617';
      this.thermalCtx.fillRect(0, 0, w, h);
      this.thermalCtx.fillStyle = 'rgba(255,255,255,0.2)';
      this.thermalCtx.font = '11px monospace';
      this.thermalCtx.textAlign = 'center';
      this.thermalCtx.fillText('SENSOR STANDBY - DRONE NOT AIRBORNE', w/2, h/2);
      document.getElementById('th-status').textContent = 'STANDBY';
      return;
    }
    
    const detectionActive = Boolean(state.sensorScanning && state.target?.type === 'scan');
    const ambientTemperature = 24.0;
    const maxTemperature = detectionActive ? 37.2 + Math.random() * 0.4 : ambientTemperature;
    const boxes = document.getElementById('thermal-bounding-boxes');

    if (detectionActive) {
      if (!this.realThermalImg) {
        this.realThermalImg = new Image();
        this.realThermalImg.src = '/thermal_roof.jpg';
      }
      if (this.realThermalImg.complete && this.realThermalImg.naturalWidth > 0) {
        this.thermalCtx.drawImage(this.realThermalImg, 0, 0, w, h);
      } else {
        this.thermalCtx.fillStyle = '#1e1b4b';
        this.thermalCtx.fillRect(0, 0, w, h);
      }
      boxes.innerHTML = `
        <div class="th-bounding-box" style="left: ${w/2 - 20}px; top: ${h/2 - 30}px; width: 40px; height: 40px;">
          <div class="th-box-label" style="background:#fde047; color:#000;">HUMAN ${maxTemperature.toFixed(1)}°C (0.98)</div>
        </div>
      `;
    } else {
      this.thermalCtx.fillStyle = '#1e1b4b';
      this.thermalCtx.fillRect(0, 0, w, h);
      boxes.innerHTML = '';
    }

    document.getElementById('th-tgt').textContent = detectionActive ? state.target.id : 'NONE';
    document.getElementById('th-conf').textContent = detectionActive ? '98%' : '--';
    document.getElementById('th-max').textContent = `${maxTemperature.toFixed(1)}°C`;
    document.getElementById('th-status').textContent = detectionActive ? 'HEAT SIGNATURE DETECTED' : 'SENSOR ACTIVE';
    document.getElementById('th-timestamp').textContent = new Date().toISOString().substr(11, 8);
    
    this.tempHistory.push(maxTemperature);
    if(this.tempHistory.length > 80) this.tempHistory.shift();
    this.drawTempGraph();
    this.drawSignalGraph(detectionActive);
  }

  drawTempGraph() {
    if (!this.tempGraphCtx) return;
    const ctx = this.tempGraphCtx;
    const w = this.tempGraphCanvas.width;
    const h = this.tempGraphCanvas.height;
    
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);
    
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for(let x=0; x<w; x+=20) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke(); }
    for(let y=0; y<h; y+=20) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    
    const thresholdY = h - ((36 - 20) / 20) * h;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, thresholdY); ctx.lineTo(w, thresholdY); ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for(let i=0; i<this.tempHistory.length; i++) {
      const val = this.tempHistory[i];
      const y = h - ((val - 20) / 20) * h;
      const x = (i / 80) * w;
      if (i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  drawSignalGraph(isScanning) {
    if (!this.signalGraphCtx) return;
    const ctx = this.signalGraphCtx;
    const w = this.signalGraphCanvas.width;
    const h = this.signalGraphCanvas.height;

    if (!this.spectrogramInit) {
      ctx.fillStyle = '#440154'; // dark purple
      ctx.fillRect(0, 0, w, h);
      this.spectrogramInit = true;
    }
    
    // Shift canvas left by 2 pixels (faster scrolling)
    ctx.drawImage(this.signalGraphCanvas, 2, 0, w - 2, h, 0, 0, w - 2, h);
    
    // Read the dropdown value
    const sel = document.getElementById('sel-spectrogram');
    const profile = sel ? sel.value : 'static';

    // Draw new 2px vertical slice at the right edge
    const imgData = ctx.createImageData(2, h);
    const data = imgData.data;

    const t = performance.now() / 1000;

    for (let y = 0; y < h; y++) {
      let f = (h - y) / h;
      let power = 0;

      if (!isScanning) {
         power = Math.random() * 0.1;
      } else if (profile === 'static') {
         power = 0.3; // Flat teal
      } else if (profile === 'tree') {
         power = (1 - f) * Math.random();
      } else if (profile === 'drone') {
         if (Math.abs(f - 0.5) < 0.05) power = 0.9;
         else power = Math.random() * 0.2;
      } else if (profile === 'human') {
         if (Math.abs(f - 0.1) < 0.03) power = 0.9 + Math.sin(t*10)*0.1;
         else if (Math.abs(f - 0.3) < 0.02) power = 0.5;
         else if (Math.abs(f - 0.6) < 0.02) power = 0.3;
         else power = Math.random() * 0.2;
      } else if (profile === 'animal') {
         if (Math.abs(f - 0.2) < 0.04) power = 0.8 + Math.sin(t*15)*0.2;
         else if (Math.abs(f - 0.5) < 0.03) power = 0.6;
         else if (Math.abs(f - 0.8) < 0.03) power = 0.7;
         else power = Math.random() * 0.25;
      }

      // Map power (0 to 1) to Viridis-like colormap
      let r, g, b;
      if (power < 0.5) {
         let p = power * 2;
         r = 68 * (1-p) + 33 * p; g = 1 * (1-p) + 145 * p; b = 84 * (1-p) + 140 * p;
      } else {
         let p = (power - 0.5) * 2;
         r = 33 * (1-p) + 253 * p; g = 145 * (1-p) + 231 * p; b = 140 * (1-p) + 37 * p;
      }

      let idx1 = (y * 2) * 4;
      data[idx1] = r; data[idx1+1] = g; data[idx1+2] = b; data[idx1+3] = 255;
      let idx2 = (y * 2 + 1) * 4;
      data[idx2] = r; data[idx2+1] = g; data[idx2+2] = b; data[idx2+3] = 255;
    }

    ctx.putImageData(imgData, w - 2, 0);
  }

  open() {
    this.isOpen = true;
    if (this.panelEl) this.panelEl.classList.remove('hidden');
    this.renderActiveModule();
    if (this.digitalTwinView) this.digitalTwinView.setInspectorState(true);
  }

  close() {
    this.isOpen = false;
    if (this.panelEl) this.panelEl.classList.add('hidden');
    if (this.digitalTwinView) this.digitalTwinView.setInspectorState(false);
  }

  update(uavState) {
    this.lastUavState = uavState;
    if (uavState.sensorScanning && !this.isOpen) {
      this.open();
    }
    if (!this.isOpen) return;
    if (this.elState) this.elState.textContent = uavState.state;
    if (this.elAlt) this.elAlt.textContent = uavState.altitude || 0;
    if (this.elSpd) this.elSpd.textContent = uavState.speed || 0;
    if (this.elBat) this.elBat.textContent = Math.round(uavState.battery);
    
    if (this.digitalTwinView && this.panelEl) {
      this.digitalTwinView.updateInspectorLink(uavState.x, uavState.y, true, 600, 16);
    }
  }
}
