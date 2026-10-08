// SENSORA 2.0 - MAIN APPLICATION ORCHESTRATOR
import { SimEngine, STAGES, SCENARIOS } from './simEngine.js';
import { DigitalTwinView } from './digitalTwinView.js';
import { AIConsole } from './aiConsole.js';
import { TelemetryCharts } from './telemetryCharts.js';
import { AlertManager } from './alertManager.js';
import { DatasetManager } from './datasetManager.js';
import { HouseholdRiskModule } from './householdRiskModule.js';
import { UavFlightController } from './uavFlightController.js';
import { UavInspector } from './uavInspector.js';

class SensoraApp {
  constructor() {
    // Top HUD elements
    this.sysStatusText = document.getElementById('sys-status-text');
    this.hudAlertLevel = document.getElementById('hud-alert-level');
    this.chipWarningLevel = document.getElementById('chip-warning-level');
    this.scenarioSelect = document.getElementById('scenario-select');
    this.btnMotionToggle = document.getElementById('btn-motion-toggle');
    this.motionLabel = document.getElementById('motion-label');
    this.btnHudDataset = document.getElementById('btn-hud-dataset');

    // Viewport badges
    this.badgeRainSensor = document.getElementById('badge-rain-sensor');
    this.badgeRiverSensor = document.getElementById('badge-river-sensor');
    this.badgeSoilSensor = document.getElementById('badge-soil-sensor');

    // Timeline elements
    this.btnPlayPause = document.getElementById('btn-play-pause');
    this.playBtnText = document.getElementById('play-btn-text');
    this.playIcon = document.getElementById('play-icon');
    this.btnRestart = document.getElementById('btn-restart');
    this.btnStepPrev = document.getElementById('btn-step-prev');
    this.btnStepNext = document.getElementById('btn-step-next');
    this.timelineBarFill = document.getElementById('timeline-bar-fill');
    this.speedButtons = document.querySelectorAll('.btn-speed');

    // Household list & popover
    this.householdListContainer = document.getElementById('household-rows-container');
    this.householdCard = document.getElementById('household-card');
    this.popCloseBtn = document.getElementById('pop-close-btn');
    this.popHouseTitle = document.getElementById('pop-house-title');
    this.popElev = document.getElementById('pop-elev');
    this.popDist = document.getElementById('pop-dist');
    this.popVuln = document.getElementById('pop-vuln');
    this.popRisk = document.getElementById('pop-risk');
    this.popEvac = document.getElementById('pop-evac');

    // Motion preference state
    this.isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Instantiate modules
    this.simEngine = new SimEngine();
    this.digitalTwin = new DigitalTwinView('digital-twin-container', (houseId, el) => {
      this.inspectHousehold(houseId, el);
    });
    this.uavController = new UavFlightController(
      this.simEngine, 
      this.digitalTwin,
      (uavState) => this.onUavUpdate(uavState),
      (houseId) => this.onUavDetection(houseId)
    );
    this.uavInspector = new UavInspector(this.simEngine, this.digitalTwin, this.uavController);
    this.digitalTwin.setupDroneClick(() => this.uavInspector.open());
    this.aiConsole = new AIConsole(() => {
      // On Skip AI: advance to flood detected / risk predicted, or to final evacuation
      if (this.simEngine.currentStageIndex < 4) {
        this.simEngine.setStage(4);
      } else if (this.simEngine.currentStageIndex < 6) {
        this.simEngine.setStage(6);
      }
    });
    this.telemetryCharts = new TelemetryCharts();
    this.alertManager = new AlertManager();
    this.datasetManager = new DatasetManager();
    this.householdRiskModule = new HouseholdRiskModule();

    this.dashboardEls = {
      rainfall: document.getElementById('dashboard-rainfall'),
      waterLevel: document.getElementById('dashboard-water-level'),
      floodType: document.getElementById('dashboard-flood-type'),
      riskLevel: document.getElementById('dashboard-risk-level'),
      householdRisk: document.getElementById('dashboard-household-risk'),
      warning: document.getElementById('dashboard-warning'),
      predictionTime: document.getElementById('dashboard-prediction-time'),
      historyBody: document.getElementById('dashboard-history-body')
    };
    this.predictionHistory = [];
    this.lastPredictionSignature = '';
    this.lastStageIndex = this.simEngine.currentStageIndex;
    this.rescuedHouseholds = new Set();
    this.swarm = [];
    this.swarmAnimationId = null;
    this.swarmDeployed = false;
    this.swarmArrived = false;
    this.swarmRescueTargetId = null;

    this.initEventListeners();
    this.initMotionState();

    // Subscribe to simulation state ticks
    this.simEngine.subscribe((state) => {
      this.onStateUpdate(state);
    });

    // Subscribe to continuous live telemetry streaming
    this.simEngine.subscribeTelemetry((state) => {
      this.onTelemetryUpdate(state);
    });
  }

  initEventListeners() {
    // 1. Play / Pause
    if (this.btnPlayPause) {
      this.btnPlayPause.addEventListener('click', () => {
        this.simEngine.togglePlay();
      });
    }

    // 2. Restart
    if (this.btnRestart) {
      this.btnRestart.addEventListener('click', () => {
        this.simEngine.restart();
        this.aiConsole.renderInitialFeed();
        this.telemetryCharts.reset();
      });
    }

    const rescueQueueBody = document.getElementById('uav-rescue-queue-body');
    if (rescueQueueBody) {
      rescueQueueBody.addEventListener('click', (event) => {
        const button = event.target.closest('[data-mark-rescued]');
        if (!button) return;
        event.stopPropagation();
        this.completeRescue(button.dataset.markRescued);
      });
    }

    // 3. Step buttons
    if (this.btnStepPrev) {
      this.btnStepPrev.addEventListener('click', () => this.simEngine.stepPrev());
    }
    if (this.btnStepNext) {
      this.btnStepNext.addEventListener('click', () => this.simEngine.stepNext());
    }

    // 4. Scenario Selector
    if (this.scenarioSelect) {
      this.scenarioSelect.addEventListener('change', (e) => {
        this.simEngine.setScenario(e.target.value);
        this.aiConsole.renderInitialFeed();
      });
    }

    // 5. Speed Buttons
    this.speedButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        this.simEngine.setSpeed(speed);
        this.speedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 6. Stage Timeline Clickable Nodes
    for (let i = 0; i < STAGES.length; i++) {
      const stepNode = document.getElementById(`step-node-${i}`);
      if (stepNode) {
        stepNode.addEventListener('click', () => {
          this.simEngine.setStage(i);
        });
      }
    }

    // 7. Household Popover Close
    if (this.popCloseBtn) {
      this.popCloseBtn.addEventListener('click', () => {
        if (this.householdCard) this.householdCard.hidden = true;
      });
    }

    // 7b. Console Tabs (AI Pipeline / Charts / Households)
    const tabBtns = document.querySelectorAll('.console-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTabId = btn.dataset.tab;
        tabBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        document.querySelectorAll('.console-tab-pane').forEach(pane => {
          pane.classList.remove('active');
        });

        const activePane = document.getElementById(targetTabId);
        if (activePane) {
          activePane.classList.add('active');
          if (targetTabId === 'tab-charts') {
            // Re-render all charts with correct dimensions
            this.telemetryCharts.initAllCharts();
            const state = this.simEngine.getState();
            this.telemetryCharts.update(state);
          }
        }
      });
    });

    // 7c. HUD Dataset Quick Nav Button
    if (this.btnHudDataset) {
      this.btnHudDataset.addEventListener('click', () => {
        const dsTabBtn = document.querySelector('.console-tab-btn[data-tab="tab-dataset"]');
        if (dsTabBtn) {
          dsTabBtn.click();
        }
      });
    }

    // 8. Motion Toggle
    if (this.btnMotionToggle) {
      this.btnMotionToggle.addEventListener('click', () => {
        this.toggleReducedMotion();
      });
    }

    // 9. Keyboard Navigation
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.simEngine.togglePlay();
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        this.simEngine.stepNext();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        this.simEngine.stepPrev();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        this.simEngine.restart();
      }
    });
  }

  initMotionState() {
    if (this.isReducedMotion) {
      document.body.classList.add('reduced-motion');
      if (this.motionLabel) this.motionLabel.textContent = 'Motion: Reduced';
      if (this.btnMotionToggle) this.btnMotionToggle.classList.add('active');
      this.digitalTwin.setReducedMotion(true);
    }
  }

  toggleReducedMotion() {
    this.isReducedMotion = !this.isReducedMotion;
    if (this.isReducedMotion) {
      document.body.classList.add('reduced-motion');
      if (this.motionLabel) this.motionLabel.textContent = 'Motion: Reduced';
      if (this.btnMotionToggle) this.btnMotionToggle.classList.add('active');
      this.digitalTwin.setReducedMotion(true);
    } else {
      document.body.classList.remove('reduced-motion');
      if (this.motionLabel) this.motionLabel.textContent = 'Motion: Full';
      if (this.btnMotionToggle) this.btnMotionToggle.classList.remove('active');
      this.digitalTwin.setReducedMotion(false);
    }
  }

  onTelemetryUpdate(state) {
    // 1. Live Viewport Station Badges
    if (this.badgeRainSensor) {
      this.badgeRainSensor.innerHTML = `RAIN SENSOR: <strong>${state.rainfall.toFixed(1)} mm/h</strong>`;
    }
    if (this.badgeRiverSensor) {
      this.badgeRiverSensor.innerHTML = `RIVER LEVEL: <strong>${state.waterLevel.toFixed(2)} m</strong>`;
    }
    if (this.badgeSoilSensor) {
      this.badgeSoilSensor.innerHTML = `SOIL MOISTURE: <strong>${state.soilMoisture.toFixed(0)}%</strong>`;
    }

    // 2. Continuous Digital Twin render
    this.digitalTwin.render(state);

    // 3. Dynamic Telemetry Charts streaming
    this.telemetryCharts.update(state);
    this.updateControlRoomDashboard(state);
  }

  getWarningLabel(riskTier) {
    switch ((riskTier || 'LOW').toUpperCase()) {
      case 'LOW': return 'Normal';
      case 'MEDIUM': return 'Warning';
      case 'HIGH': return 'High Risk Alert';
      case 'CRITICAL': return 'Emergency Alert';
      default: return 'Normal';
    }
  }

  getHouseholdRiskLabel(households) {
    if (!Array.isArray(households) || !households.length) return 'LOW';
    const maxHouse = households.reduce((max, item) => (item.personalScore > max.personalScore ? item : max), households[0]);
    return maxHouse.riskLevel || 'LOW';
  }

  updateControlRoomDashboard(state) {
    const riskTier = state.riskTier || state.model2RiskLevel || 'LOW';
    const floodType = state.floodType || 'MONITORING';
    const householdRisk = this.getHouseholdRiskLabel(state.households);
    const warningText = this.getWarningLabel(riskTier);
    const predictionTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    if (this.dashboardEls.rainfall) this.dashboardEls.rainfall.textContent = `${Number(state.rainfall || 0).toFixed(1)} mm/h`;
    if (this.dashboardEls.waterLevel) this.dashboardEls.waterLevel.textContent = `${Number(state.waterLevel || 0).toFixed(2)} m`;
    if (this.dashboardEls.floodType) this.dashboardEls.floodType.textContent = floodType;
    if (this.dashboardEls.riskLevel) this.dashboardEls.riskLevel.textContent = riskTier;
    if (this.dashboardEls.householdRisk) this.dashboardEls.householdRisk.textContent = householdRisk;
    if (this.dashboardEls.warning) this.dashboardEls.warning.textContent = warningText;
    if (this.dashboardEls.predictionTime) this.dashboardEls.predictionTime.textContent = predictionTime;

    const signature = `${riskTier}|${floodType}|${state.stageIndex}`;
    if (this.lastPredictionSignature !== signature) {
      this.predictionHistory.unshift({
        event: floodType,
        level: riskTier,
        time: predictionTime
      });
      this.predictionHistory = this.predictionHistory.slice(0, 5);
      this.lastPredictionSignature = signature;
    }

    if (this.dashboardEls.historyBody) {
      if (!this.predictionHistory.length) {
        this.dashboardEls.historyBody.innerHTML = '<tr><td colspan="3">No events yet</td></tr>';
        return;
      }

      this.dashboardEls.historyBody.innerHTML = this.predictionHistory.map(item => `
        <tr>
          <td>${item.event}</td>
          <td>${item.level}</td>
          <td>${item.time}</td>
        </tr>
      `).join('');
    }
  }

  onStateUpdate(state) {
    if (state.stageIndex === 0 && this.lastStageIndex !== 0) {
      this.resetRescueMission();
    }
    this.lastStageIndex = state.stageIndex;

    // 1. Update Play / Pause Button visuals
    if (this.playBtnText) {
      this.playBtnText.textContent = state.isPlaying ? 'PAUSE' : (state.stageIndex === 0 ? 'START SIMULATION' : 'RESUME');
    }
    if (this.playIcon) {
      if (state.isPlaying) {
        this.playIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      } else {
        this.playIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      }
    }

    // 2. Update Timeline Stage Stepper
    this.updateTimelineUI(state.stageIndex);

    // 3. Update Top HUD status
    if (this.sysStatusText) {
      this.sysStatusText.textContent = state.riskTier === 'CRITICAL' ? 'ALERT ACTIVE' : (state.riskTier === 'HIGH' ? 'WARNING' : 'NOMINAL');
    }
    if (this.hudAlertLevel) {
      this.hudAlertLevel.textContent = `${state.riskTier} RISK`;
      this.hudAlertLevel.className = `chip-val bold ${state.riskTier.toLowerCase()}`;
    }
    if (this.chipWarningLevel) {
      const indicator = this.chipWarningLevel.querySelector('.status-indicator');
      if (indicator) {
        if (state.riskTier === 'CRITICAL') {
          indicator.className = 'status-indicator danger';
        } else if (state.riskTier === 'HIGH') {
          indicator.className = 'status-indicator warning';
        } else {
          indicator.className = 'status-indicator normal';
        }
      }
    }

    // 4. Update Viewport Station Badges
    if (this.badgeRainSensor) {
      this.badgeRainSensor.innerHTML = `RAIN SENSOR: <strong>${state.rainfall.toFixed(1)} mm/h</strong>`;
    }
    if (this.badgeRiverSensor) {
      this.badgeRiverSensor.innerHTML = `RIVER LEVEL: <strong>${state.waterLevel.toFixed(2)} m</strong>`;
    }
    if (this.badgeSoilSensor) {
      this.badgeSoilSensor.innerHTML = `SOIL MOISTURE: <strong>${state.soilMoisture.toFixed(0)}%</strong>`;
    }

    // 5. Update Digital Twin Render
    this.digitalTwin.render(state);

    // 7. Update AI Console & Models
    this.aiConsole.render(state);

    // 8. Update Synchronized Telemetry Charts
    this.telemetryCharts.update(state);
    this.updateControlRoomDashboard(state);

    // 9. Update Alert Broadcast Overlay
    this.alertManager.update(state);

    // 10. Update Household Rows in Right Panel
    this.renderHouseholdRows(state.households);

    // 11. Update Household-Level Risk Module with live simulation and Model 2 prediction
    if (this.householdRiskModule) {
      this.householdRiskModule.updateState(state);
    }
    
    // 12. Update UAV Rescue Queue
    this.renderRescueQueue(state.households);
  }

  renderRescueQueue(households) {
    const tbody = document.getElementById('uav-rescue-queue-body');
    if (!tbody || !households) return;

    // Sort by drone confirmation first, then personalScore descending
    const sorted = [...households].sort((a, b) => {
      if (a.droneConfirmed && !b.droneConfirmed) return -1;
      if (!a.droneConfirmed && b.droneConfirmed) return 1;
      return b.personalScore - a.personalScore;
    });

    tbody.innerHTML = sorted.map(h => {
      const color = h.droneConfirmed ? '#ef4444' : (h.riskLevel === 'HIGH' ? '#f97316' : '#94a3b8');
      const fw = h.droneConfirmed ? 'bold' : 'normal';
      const isRescueTarget = h.id === 'H003' && h.droneConfirmed;
      const canCompleteRescue = isRescueTarget && this.swarmArrived && this.swarmRescueTargetId === h.id;
      const status = h.rescued
        ? 'RESCUED - SWARM RTB'
        : isRescueTarget
          ? canCompleteRescue
            ? `<button class="btn-micro" type="button" data-mark-rescued="${h.id}">MARK RESCUED</button>`
            : 'SWARM EN ROUTE / ON STATION'
          : h.evacStatus;
      return `
        <tr style="color: ${color}; font-weight: ${fw}; cursor: pointer;" onclick="document.getElementById('house-${h.id}').click()">
          <td>${h.id} ${h.droneConfirmed ? '★' : ''}</td>
          <td>${h.riskLevel} (${h.personalScore})</td>
          <td>${status}</td>
        </tr>
      `;
    }).join('');
  }

  completeRescue(houseId) {
    const household = this.simEngine.getState().households.find(item => item.id === houseId);
    if (!household || !household.droneConfirmed || household.rescued) return;

    this.rescuedHouseholds.add(houseId);
    this.simEngine.markHouseholdRescued(houseId);
  }

  getHouseholdMapPoint(houseId) {
    const pin = document.getElementById(`house-${houseId}`);
    const matrix = pin?.transform.baseVal.consolidate()?.matrix;
    return matrix ? { x: matrix.e, y: matrix.f } : null;
  }

  getHouseholdLocation(houseId) {
    const household = this.simEngine.getState().households.find(item => item.id === houseId);
    const point = this.getHouseholdMapPoint(houseId);
    const name = household ? household.name : houseId;
    return point ? `${name} | MAP ${Math.round(point.x)}, ${Math.round(point.y)}` : name;
  }

  resetRescueMission() {
    if (this.swarmAnimationId) {
      cancelAnimationFrame(this.swarmAnimationId);
      this.swarmAnimationId = null;
    }
    this.swarm.forEach(drone => drone.el.remove());
    this.swarm = [];
    this.swarmDeployed = false;
    this.swarmArrived = false;
    this.swarmRescueTargetId = null;
    this.rescuedHouseholds.clear();

    const detectionsBody = document.getElementById('uav-detections-body');
    if (detectionsBody) detectionsBody.innerHTML = '<tr><td colspan="4">Awaiting mission...</td></tr>';
    document.querySelectorAll('.house-detection-ring').forEach(ring => {
      const houseId = ring.parentElement?.dataset.id;
      const riskDot = document.getElementById(`house-dot-${houseId}`);
      if (riskDot) {
        riskDot.removeAttribute('stroke');
        riskDot.removeAttribute('stroke-width');
      }
      ring.remove();
    });
  }

  updateTimelineUI(activeStageIdx) {
    // Fill percentage: 0 to 6 -> 0% to 100%
    const pct = (activeStageIdx / (STAGES.length - 1)) * 100;
    if (this.timelineBarFill) {
      this.timelineBarFill.style.width = `${pct}%`;
    }

    for (let i = 0; i < STAGES.length; i++) {
      const node = document.getElementById(`step-node-${i}`);
      if (!node) continue;

      if (i < activeStageIdx) {
        node.className = 'timeline-step passed';
      } else if (i === activeStageIdx) {
        node.className = 'timeline-step active';
      } else {
        node.className = 'timeline-step';
      }
    }
  }

  renderHouseholdRows(households) {
    if (!this.householdListContainer || !households) return;

    this.householdListContainer.innerHTML = '';
    households.forEach(h => {
      const row = document.createElement('div');
      row.className = 'household-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Inspect household ${h.id}`);

      row.innerHTML = `
        <div class="house-row-left">
          <span class="house-row-id">${h.id}</span>
          <div class="house-row-meta">
            <span>+${h.elevation}m</span> · 
            <span>${h.distance}m to river</span>
          </div>
        </div>
        <span class="house-risk-pill tier-${h.riskLevel.toLowerCase()}">${h.riskLevel} (${h.personalScore})</span>
      `;

      row.addEventListener('click', () => {
        this.inspectHousehold(h.id);
      });

      this.householdListContainer.appendChild(row);
    });
  }

  inspectHousehold(houseId) {
    const state = this.simEngine.getState();
    const h = state.households.find(item => item.id === houseId);
    if (!h || !this.householdCard) return;

    if (this.uavInspector) {
      this.uavInspector.open();
    }

    if (this.popHouseTitle) this.popHouseTitle.textContent = `${h.id} - ${h.name}`;
    if (this.popElev) this.popElev.textContent = `${h.elevation.toFixed(1)} m above datum`;
    if (this.popDist) this.popDist.textContent = `${h.distance} m from river channel`;
    if (this.popVuln) this.popVuln.textContent = `${h.vulnerability} (${h.description})`;
    if (this.popRisk) {
      this.popRisk.textContent = `${h.riskLevel} (Score: ${h.personalScore}/100)`;
      this.popRisk.style.color = h.riskLevel === 'CRITICAL' ? '#ef4444' : (h.riskLevel === 'HIGH' ? '#f97316' : (h.riskLevel === 'MEDIUM' ? '#f59e0b' : '#22c55e'));
    }
    if (this.popEvac) {
      this.popEvac.textContent = h.evacStatus === 'EVACUATE' ? 'MANDATORY EVACUATION' : h.evacStatus;
      this.popEvac.style.color = h.evacStatus === 'EVACUATE' ? '#ef4444' : '#ffffff';
    }

    // Synchronize Household-Level Risk Module inputs with selected locality
    if (this.householdRiskModule) {
      this.householdRiskModule.setHouseholdInputs({
        distance: h.distance,
        elevation: h.elevation,
        vulnerability: h.vulnerability,
        houseId: h.id
      });
    }

    this.householdCard.hidden = false;
  }

  onUavUpdate(uavState) {
    const stateText = document.getElementById('hud-uav-state');
    const modeText = document.getElementById('uav-dash-mode');
    const battText = document.getElementById('uav-dash-battery');
    const targetText = document.getElementById('uav-dash-target');
    const labelStats = document.getElementById('uav-label-stats');
    
    if (stateText) stateText.textContent = uavState.state;
    if (modeText) modeText.textContent = uavState.state;
    if (battText) battText.textContent = `${Math.round(uavState.battery)}%`;
    if (targetText && uavState.target) targetText.textContent = `${uavState.target.id || 'BASE'}`;
    if (labelStats) labelStats.textContent = `ALT: ${uavState.altitude || 0}m | BAT: ${Math.round(uavState.battery)}%`;
    if (this.uavInspector) this.uavInspector.update(uavState);
  }

  onUavDetection(houseId) {
    this.digitalTwin.showDetectionOnHouse(houseId);
    this.simEngine.confirmHouseholdFlood(houseId); // Data Fusion Feedback Loop

    const h = this.simEngine.getState().households.find(item => item.id === houseId);
    const location = this.getHouseholdLocation(houseId);

    // NEW LOGIC: Lock and Swarm for H003 (or High risk with trapped humans)
    if (h && houseId === 'H003') {
       // Spawn Swarm to stay with humans
       this.deploySwarm(houseId);
    }

    const tbody = document.getElementById('uav-detections-body');
    if (tbody) {
      if (tbody.innerHTML.includes('Awaiting mission...')) {
        tbody.innerHTML = '';
      }
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const row = document.createElement('tr');
      const status = houseId === 'H003' ? '3 HUMANS DETECTED' : 'THERMAL SIGNATURE';
      row.innerHTML = `<td>${houseId}</td><td>${location}</td><td>${timeStr}</td><td><span style="color:#ef4444;font-weight:bold;">${status}</span></td>`;
      tbody.prepend(row);
    }
    
    const feedEl = document.getElementById('ai-stages-feed');
    if (feedEl) {
      const stepEl = document.createElement('div');
      stepEl.className = 'ai-step done';
      let title = `[RUDRANETRA] Drone Survey at ${houseId}`;
      let desc = `Aerial flood validation confirmed. High precision footprint matched.`;
      
      if (h && houseId === 'H003') {
        title = `[CRITICAL ALERT] Humans Detected at ${houseId}`;
        desc = `Thermal scanner detected 3 people stranded on the roof. ${location} sent to Rescue Command. Five-drone swarm dispatched; lead drone holds over the people until rescue is confirmed.`;
      }
      
      stepEl.innerHTML = `<div class="ai-step-indicator"><svg class="icon check" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"></polyline></svg></div>
        <div class="ai-step-content">
          <div class="ai-step-title" style="color:#ef4444; font-weight:bold;">${title}</div>
          <div class="ai-step-desc">${desc}</div>
        </div>`;
      feedEl.appendChild(stepEl);
      feedEl.scrollTop = feedEl.scrollHeight;
    }
  }

  deploySwarm(targetId) {
    if (this.swarmDeployed) return;
    
    const svg = document.getElementById('schematic-svg');
    const housePin = document.getElementById(`house-${targetId}`);
    const targetEl = document.getElementById(`house-dot-${targetId}`);
    const houseMatrix = housePin?.transform.baseVal.consolidate()?.matrix;
    if (!svg || !targetEl || !houseMatrix) return;
    
    this.swarmDeployed = true;
    this.swarmArrived = false;
    this.swarmRescueTargetId = targetId;
    const tx = houseMatrix.e + parseFloat(targetEl.getAttribute('cx'));
    const ty = houseMatrix.f + parseFloat(targetEl.getAttribute('cy'));
    const formation = [
      { x: 0, y: 0 },
      { x: -28, y: -18 },
      { x: 28, y: -18 },
      { x: -28, y: 18 },
      { x: 28, y: 18 }
    ];

    this.swarm = formation.map((offset, index) => {
      const uav = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      uav.setAttribute('transform', 'translate(460, 70)');
      uav.setAttribute('class', 'rescue-swarm-drone');
      uav.setAttribute('aria-label', `Rescue drone ${index + 1}${index === 0 ? ', holding over survivors' : ''}`);
      uav.innerHTML = `
        <g transform="scale(0.3)">
          <path d="M-20,-20 L20,20 M-20,20 L20,-20" stroke="#94a3b8" stroke-width="6" stroke-linecap="round"/>
          <circle cx="0" cy="0" r="12" fill="#0f172a" stroke="#fde047" stroke-width="3"/>
          <circle cx="-20" cy="-20" r="14" fill="rgba(253, 224, 71, 0.4)" class="spin-slow"/>
          <circle cx="20" cy="20" r="14" fill="rgba(253, 224, 71, 0.4)" class="spin-slow"/>
          <circle cx="-20" cy="20" r="14" fill="rgba(253, 224, 71, 0.4)" class="spin-slow"/>
          <circle cx="20" cy="-20" r="14" fill="rgba(253, 224, 71, 0.4)" class="spin-slow"/>
        </g>
      `;
      svg.appendChild(uav);
      
      return {
        el: uav,
        x: 460,
        y: 70,
        holdX: tx + offset.x,
        holdY: ty + offset.y,
        index,
        speed: 70 + index * 5
      };
    });

    let lastTime = performance.now();
    const animateSwarm = (time) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      const returning = this.rescuedHouseholds.has(targetId);
      let allReturned = returning;
      let allAtHouse = !returning;
      
      this.swarm.forEach(d => {
        const goalX = returning ? 460 : d.holdX;
        const goalY = returning ? 70 : d.holdY;
        const dx = goalX - d.x;
        const dy = goalY - d.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist > 2 && dt > 0) {
          allReturned = false;
          if (!returning) allAtHouse = false;
          const travel = Math.min(d.speed * dt, dist);
          d.x += (dx / dist) * travel;
          d.y += (dy / dist) * travel;
        } else if (!returning) {
          allReturned = false;
          const hover = d.index === 0 ? 0 : Math.sin(time / 350 + d.index) * 1.5;
          d.x = d.holdX + hover;
          d.y = d.holdY + (d.index === 0 ? 0 : Math.cos(time / 350 + d.index) * 1.5);
        } else {
          d.x = goalX;
          d.y = goalY;
        }
        d.el.setAttribute('transform', `translate(${d.x}, ${d.y})`);
      });

      if (!returning && allAtHouse && !this.swarmArrived) {
        this.swarmArrived = true;
        this.renderRescueQueue(this.simEngine.getState().households);
      }

      if (allReturned) {
        this.swarm.forEach(drone => drone.el.remove());
        this.swarm = [];
        this.swarmDeployed = false;
        this.swarmArrived = false;
        this.swarmRescueTargetId = null;
        this.swarmAnimationId = null;
        return;
      }
      this.swarmAnimationId = requestAnimationFrame(animateSwarm);
    };
    this.swarmAnimationId = requestAnimationFrame(animateSwarm);
  }
}

// Bootstrap once DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new SensoraApp();
});
