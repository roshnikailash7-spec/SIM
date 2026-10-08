from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import os
import random
from datetime import datetime, timezone

from rudranetra.backend.api.message_schema import MissionCommand
from rudranetra.backend.core.digital_twin import DigitalTwin
from rudranetra.backend.core.mission_manager import MissionManager
from rudranetra.backend.core.flight_simulator import FlightSimulator
from rudranetra.backend.config import config

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global simulation state
twin = DigitalTwin()
home_lat, home_lon, _ = twin.get_home_location()
manager = MissionManager(home_lat, home_lon)
sims = [FlightSimulator(home_lat, home_lon, uav_id=f"RUDRA-0{i+1}") for i in range(5)]

# Generate a wider set of mock ground truth objects for the drone to find
def populate_twin(t):
    objects = []
    # cluster 1 (flood)
    for i in range(5):
        objects.append({"type": "human", "lat": t.home_lat + 0.002 + random.uniform(-0.001, 0.001), "lon": t.home_lon + 0.002 + random.uniform(-0.001, 0.001)})
    objects.append({"type": "vehicle", "lat": t.home_lat + 0.002, "lon": t.home_lon + 0.0025})
    objects.append({"type": "road_blocked", "lat": t.home_lat + 0.0025, "lon": t.home_lon + 0.002})
    
    # cluster 2
    for i in range(3):
        objects.append({"type": "human", "lat": t.home_lat + 0.007 + random.uniform(-0.001, 0.001), "lon": t.home_lon + 0.006 + random.uniform(-0.001, 0.001)})
    objects.append({"type": "road_blocked", "lat": t.home_lat + 0.008, "lon": t.home_lon + 0.007})
    
    t.objects = objects
    
populate_twin(twin)

@app.post("/api/mission")
async def start_mission(mission: MissionCommand):
    waypoints = manager.generate_waypoints(mission)
    import math
    chunk_size = math.ceil(len(waypoints) / len(sims))
    
    for i, sim in enumerate(sims):
        start_idx = i * chunk_size
        end_idx = min((i + 1) * chunk_size, len(waypoints))
        sim_wps = waypoints[start_idx:end_idx]
        
        sim.load_mission(mission.mission_id, sim_wps)
        sim.start_mission()
        
    return {"status": "started", "mission_id": mission.mission_id}

# WebSocket client list
clients = set()
reported_objects = set()

async def simulation_loop():
    while True:
        all_parked = True
        for sim in sims:
            sim.update()
            if sim.state.value not in ("LANDED", "PARKED"):
                all_parked = False
            
            # Determine if we should send telemetry (20Hz)
            if clients:
                telem = sim.get_telemetry()
                telem_msg = {
                    "type": "telemetry",
                    "uav_id": telem.uav_id,
                    "timestamp": telem.timestamp.isoformat(),
                    "state": telem.state.value,
                    "lat": telem.lat,
                    "lon": telem.lon,
                    "alt": telem.alt,
                    "heading": telem.heading,
                    "speed": telem.speed,
                    "battery_pct": telem.battery_pct,
                    "current_waypoint_idx": telem.current_waypoint_idx,
                    "total_waypoints": telem.total_waypoints
                }
                
                # Broadcast telem
                dead_clients = set()
                for ws in list(clients):
                    try:
                        await ws.send_json(telem_msg)
                    except:
                        dead_clients.add(ws)
                for ws in dead_clients:
                    clients.remove(ws)
                        
                # Simulate sensor detections when in survey mode
                if telem.state.value == "SURVEY":
                    # Sensor footprint at 50m alt ~ 50m radius (approx 0.00045 deg)
                    objects_in_view = twin.get_objects_in_radius(telem.lat, telem.lon, radius_deg=0.0005)
                    for obj in objects_in_view:
                        obj_id = f"{obj['lat']}_{obj['lon']}"
                        if obj_id not in reported_objects:
                            reported_objects.add(obj_id)
                            packet = {
                                "type": "detection",
                                "object_type": obj["type"],
                                "lat": obj["lat"],
                                "lon": obj["lon"],
                                "confidence": round(random.uniform(0.85, 0.98), 2),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                                "uav_id": telem.uav_id
                            }
                            for ws in list(clients):
                                try:
                                    await ws.send_json(packet)
                                except:
                                    pass

        # Reset detections if landed so we can run mission again
        if all_parked:
            reported_objects.clear()
        
        # Sleep to yield event loop, syncing with real time
        await asyncio.sleep(config.DT)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(simulation_loop())

@app.websocket("/ws/telemetry")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    clients.add(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except:
        clients.remove(websocket)

# Mount frontend
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend'))
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
