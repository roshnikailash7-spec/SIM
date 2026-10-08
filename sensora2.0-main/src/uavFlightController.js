export const UAV_CONFIG = {
  maxSpeed: 100, // pixels per second
  maxForce: 150, // steering force
  scanTime: 3, // seconds to collect thermal and signal data
  cruiseAlt: 50, // simulated altitude max
  trailLength: 40 // number of history points
};

export class UavFlightController {
  constructor(simEngine, digitalTwinView, onUavUpdate, onDetection) {
    this.simEngine = simEngine;
    this.digitalTwinView = digitalTwinView;
    this.onUavUpdate = onUavUpdate;
    this.onDetection = onDetection;
    
    this.home = { x: 460, y: 70 }; // Base
    this.x = this.home.x;
    this.y = this.home.y;
    this.yaw = 0;
    this.altitude = 0;
    this.velocity = { x: 0, y: 0 };
    this.state = 'PARKED';
    this.battery = 100;
    this.isLocked = false;
    const housePins = Array.from(
      this.digitalTwinView?.svg?.querySelectorAll('.household-pin') || []
    );
    const houseWaypoints = housePins.map((pin) => {
      const matrix = pin.transform.baseVal.consolidate()?.matrix;
      return matrix ? { x: matrix.e, y: matrix.f, id: pin.dataset.id, type: 'scan' } : null;
    }).filter(Boolean);
    this.waypoints = houseWaypoints;
    this.currentWaypointIndex = 0;
    this.scanTimer = 0;
    this.scanningTarget = null;
    this.trail = [];
    
    this.simEngine.subscribe((state) => {
      this.handleStageChange(state.stageIndex, state.riskTier);
    });

    this.lastTick = performance.now();
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  handleStageChange(stageIndex, riskTier) {
    if (stageIndex === 0 || stageIndex === 1) {
      this.state = 'PARKED';
      this.x = this.home.x;
      this.y = this.home.y;
      this.yaw = 0;
      this.altitude = 0;
      this.velocity = { x: 0, y: 0 };
      this.currentWaypointIndex = 0;
      this.scanTimer = 0;
      this.scanningTarget = null;
      this.battery = 100;
      this.trail = [];
      this.isLocked = false;
      if(this.digitalTwinView && this.digitalTwinView.clearUavTrail) {
         this.digitalTwinView.clearUavTrail();
      }
    } else if (stageIndex === 2) {
      this.state = 'STANDBY';
    } else if (stageIndex >= 3) {
      if ((riskTier === 'HIGH' || riskTier === 'CRITICAL') && ['PARKED', 'STANDBY', 'MISSION_PREP'].includes(this.state)) {
        this.state = 'TAKEOFF';
      }
    }
  }

  tick(now) {
    const deltaMs = now - this.lastTick;
    this.lastTick = now;
    
    const state = this.simEngine.getState();
    if (state.isPlaying) {
      const dt = (deltaMs / 1000) * state.speed;
      this.updatePhysics(dt);
      
      if (this.digitalTwinView && this.digitalTwinView.updateUav) {
        this.digitalTwinView.updateUav(this.x, this.y, this.state, this.yaw, this.altitude, this.trail, this.waypoints, this.currentWaypointIndex);
      }
      
      if (this.onUavUpdate && this.state !== 'PARKED') {
        const speedKmh = Math.round(Math.sqrt(this.velocity.x**2 + this.velocity.y**2) * 3.6);
        this.onUavUpdate({
          x: this.x, y: this.y, 
          state: this.state, 
          battery: this.battery, 
          altitude: Math.round(this.altitude),
          speed: speedKmh,
          target: this.scanningTarget || this.waypoints[this.currentWaypointIndex],
          sensorScanning: Boolean(this.scanningTarget && this.scanTimer > 0)
        });
      }
    }
    requestAnimationFrame(this.tick);
  }

  updatePhysics(dt) {
    if (this.state === 'PARKED' || this.state === 'LANDED' || this.state === 'STANDBY' || this.state === 'MISSION_PREP') return;

    if (this.state === 'TAKEOFF') {
      this.altitude += 30 * dt;
      if (this.altitude >= UAV_CONFIG.cruiseAlt) {
        this.altitude = UAV_CONFIG.cruiseAlt;
        this.state = 'SURVEY';
        this.currentWaypointIndex = 0;
      }
      return;
    }

    if (this.scanTimer > 0 && !this.isLocked) {
      this.scanTimer -= dt;
      if (this.scanTimer <= 0) {
        this.scanTimer = 0;
        this.scanningTarget = null;
      }
    }

    // SURVEY or RETURN movement
    let target = this.state === 'RETURN' ? this.home : this.waypoints[this.currentWaypointIndex];
    let dx = target.x - this.x;
    let dy = target.y - this.y;
    let dist = Math.sqrt(dx*dx + dy*dy);
    
    let arrivalRadius = this.state === 'RETURN' ? 5 : target.type === 'scan' ? 8 : 8;

    if (dist < arrivalRadius) {
      this.x = target.x;
      this.y = target.y;
      this.velocity.x = 0;
      this.velocity.y = 0;
      if (this.state === 'RETURN') {
        this.state = 'LANDING';
      } else {
        if (target.type === 'scan') {
          this.scanTimer = UAV_CONFIG.scanTime;
          this.scanningTarget = target;
          if (this.onDetection && target.id) {
            this.onDetection(target.id);
          }
          this.currentWaypointIndex++;
          if (this.currentWaypointIndex >= this.waypoints.length) {
            this.state = 'RETURN';
          }
        } else {
          this.currentWaypointIndex++;
          if (this.currentWaypointIndex >= this.waypoints.length) {
            this.state = 'RETURN';
          }
        }
      }
      return;
    }

    let speed = UAV_CONFIG.maxSpeed;
    if (this.state === 'RETURN' && dist < 60) {
      speed = Math.max(15, speed * (dist / 60)); 
    }
    
    const travelDistance = Math.min(speed * dt, dist);
    const travelSpeed = dt > 0 ? travelDistance / dt : 0;
    this.velocity.x = (dx / dist) * travelSpeed;
    this.velocity.y = (dy / dist) * travelSpeed;
    this.x += (dx / dist) * travelDistance;
    this.y += (dy / dist) * travelDistance;
    this.battery = Math.max(0, this.battery - dt * 0.3);
    
    // Trail
    if (this.trail.length === 0 || Math.abs(this.trail[this.trail.length-1].x - this.x) > 5 || Math.abs(this.trail[this.trail.length-1].y - this.y) > 5) {
        this.trail.push({x: this.x, y: this.y});
        if (this.trail.length > UAV_CONFIG.trailLength) {
            this.trail.shift();
        }
    }

    if (this.velocity.x !== 0 || this.velocity.y !== 0) {
        let targetYaw = Math.atan2(this.velocity.y, this.velocity.x) * (180 / Math.PI) + 90;
        let diff = targetYaw - this.yaw;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;
        this.yaw += diff * 5 * dt;
    }

    if (this.state === 'LANDING') {
      this.altitude -= 20 * dt;
      if (this.altitude <= 0) {
        this.altitude = 0;
        this.state = 'LANDED';
      }
    }
  }

  toggleTargetLock() {
    this.isLocked = !this.isLocked;
    return this.isLocked;
  }
}
