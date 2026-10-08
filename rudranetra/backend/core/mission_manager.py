from typing import List
from rudranetra.backend.api.message_schema import MissionCommand, Waypoint

class MissionManager:
    def __init__(self, home_lat: float, home_lon: float):
        self.home_lat = home_lat
        self.home_lon = home_lon

    def generate_waypoints(self, mission: MissionCommand) -> List[Waypoint]:
        offset_deg = 0.009
        alt = 50.0
        
        center_lat = self.home_lat + offset_deg
        center_lon = self.home_lon + offset_deg

        wps = []
        num_lines = 10
        for i in range(num_lines):
            lat_row = center_lat - offset_deg/2 + i * (offset_deg / (num_lines-1))
            if i % 2 == 0:
                wps.append(Waypoint(lat=lat_row, lon=center_lon - offset_deg/2, alt=alt))
                wps.append(Waypoint(lat=lat_row, lon=center_lon + offset_deg/2, alt=alt))
            else:
                wps.append(Waypoint(lat=lat_row, lon=center_lon + offset_deg/2, alt=alt))
                wps.append(Waypoint(lat=lat_row, lon=center_lon - offset_deg/2, alt=alt))
                
        return wps
