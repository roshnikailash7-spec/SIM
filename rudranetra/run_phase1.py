import time
import sys
import os

# Ensure the parent directory is in the path so rudranetra imports work
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from rudranetra.backend.config import config
from rudranetra.backend.api.message_schema import MissionCommand, MissionPriority
from rudranetra.backend.core.digital_twin import DigitalTwin
from rudranetra.backend.core.mission_manager import MissionManager
from rudranetra.backend.core.flight_simulator import FlightSimulator

def main():
    print("--- RUDRANETRA Phase 1 Test ---")
    twin = DigitalTwin()
    home_lat, home_lon, _ = twin.get_home_location()
    
    manager = MissionManager(home_lat, home_lon)
    sim = FlightSimulator(home_lat, home_lon)
    
    cmd = MissionCommand(
        mission_id="PRV-UAV-001",
        target_zone="Zone 04",
        priority=MissionPriority.CRITICAL,
        tasks=["survey", "detect_humans"],
        survey_area_km2=5.0
    )
    
    print(f"Generating waypoints for mission: {cmd.mission_id}")
    waypoints = manager.generate_waypoints(cmd)
    print(f"Generated {len(waypoints)} waypoints.")
    
    sim.load_mission(cmd.mission_id, waypoints)
    sim.start_mission()
    
    print("Starting simulation loop...")
    tick = 0
    while sim.state.value != "PARKED":
        sim.update()
        if tick % int(config.UPDATE_HZ) == 0:  # Print every simulated second
            telem = sim.get_telemetry()
            print(f"[{telem.state.value}] Alt: {telem.alt:.1f}m | Speed: {telem.speed:.1f}m/s | "
                  f"Bat: {telem.battery_pct*100:.1f}% | WP: {telem.current_waypoint_idx}/{telem.total_waypoints} | "
                  f"Pos: {telem.lat:.6f}, {telem.lon:.6f}")
        
        # Fast-forward simulation
        tick += 1
        
        # Failsafe infinite loop break
        if tick > 100000:
            print("Timeout!")
            break
            
    print("Mission complete. UAV Parked.")

if __name__ == "__main__":
    main()
