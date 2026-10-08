import math
from datetime import datetime, timezone
from typing import List
from rudranetra.backend.api.message_schema import UAVState, Waypoint, Telemetry
from rudranetra.backend.config import config

class FlightSimulator:
    def __init__(self, home_lat: float, home_lon: float, uav_id="RUDRA-01"):
        self.uav_id = uav_id
        self.home_lat = home_lat
        self.home_lon = home_lon
        
        self.lat = home_lat
        self.lon = home_lon
        self.alt = 0.0
        
        self.heading = 0.0
        self.speed = 0.0
        self.battery_mah = config.BATTERY_MAX_MAH
        
        self.state = UAVState.PARKED
        self.waypoints: List[Waypoint] = []
        self.current_wp_idx = 0
        self.mission_id = ""

    def load_mission(self, mission_id: str, waypoints: List[Waypoint]):
        self.mission_id = mission_id
        self.waypoints = waypoints
        self.current_wp_idx = 0
        self.state = UAVState.MISSION_PREP

    def start_mission(self):
        if self.state in [UAVState.MISSION_PREP, UAVState.STANDBY, UAVState.PARKED]:
            if self.waypoints:
                self.state = UAVState.TAKEOFF
            else:
                print("No waypoints loaded.")

    def update(self):
        # Battery drain
        self.battery_mah -= config.BATTERY_DRAIN_RATE * config.DT
        if self.battery_mah < 0:
            self.battery_mah = 0
            
        if self.state == UAVState.PARKED:
            pass
            
        elif self.state == UAVState.TAKEOFF:
            target_alt = config.CRUISE_ALTITUDE
            if self.waypoints:
                target_alt = self.waypoints[0].alt
                
            if self.alt < target_alt:
                self.alt += config.MAX_CLIMB_RATE * config.DT
            else:
                self.alt = target_alt
                self.state = UAVState.SURVEY
                
        elif self.state == UAVState.SURVEY:
            if self.current_wp_idx >= len(self.waypoints):
                self.state = UAVState.RETURN
            else:
                wp = self.waypoints[self.current_wp_idx]
                reached = self._move_towards(wp.lat, wp.lon, wp.alt)
                if reached:
                    self.current_wp_idx += 1
                    
        elif self.state == UAVState.RETURN:
            reached = self._move_towards(self.home_lat, self.home_lon, config.CRUISE_ALTITUDE)
            if reached:
                self.state = UAVState.LANDED
                
        elif self.state == UAVState.LANDED:
            if self.alt > 0:
                self.alt -= config.MAX_CLIMB_RATE * config.DT
                if self.alt <= 0:
                    self.alt = 0
                    self.state = UAVState.PARKED

    def _move_towards(self, target_lat, target_lon, target_alt) -> bool:
        # Simple point mass kinematics
        # 1 deg lat/lon is approx 111km
        lat_diff = target_lat - self.lat
        lon_diff = target_lon - self.lon
        dist_deg = math.hypot(lat_diff, lon_diff)
        dist_m = dist_deg * 111000.0
        
        # Altitude adjustment
        alt_diff = target_alt - self.alt
        if abs(alt_diff) > 0.5:
            self.alt += math.copysign(min(config.MAX_CLIMB_RATE * config.DT, abs(alt_diff)), alt_diff)
        
        if dist_m < 1.0:
            self.lat = target_lat
            self.lon = target_lon
            self.speed = 0.0
            return True
            
        self.heading = math.degrees(math.atan2(lon_diff, lat_diff))
        
        # Move
        move_dist_m = min(config.MAX_SPEED_MPS * config.DT, dist_m)
        self.speed = move_dist_m / config.DT
        
        move_dist_deg = move_dist_m / 111000.0
        self.lat += (lat_diff / dist_deg) * move_dist_deg
        self.lon += (lon_diff / dist_deg) * move_dist_deg
        
        return False

    def get_telemetry(self) -> Telemetry:
        return Telemetry(
            uav_id=self.uav_id,
            timestamp=datetime.now(timezone.utc),
            state=self.state,
            lat=self.lat,
            lon=self.lon,
            alt=self.alt,
            heading=self.heading,
            speed=self.speed,
            battery_pct=self.battery_mah / config.BATTERY_MAX_MAH,
            current_waypoint_idx=self.current_wp_idx,
            total_waypoints=len(self.waypoints)
        )
