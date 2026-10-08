from dataclasses import dataclass
from typing import List, Optional, Dict
from datetime import datetime
from enum import Enum

class MissionPriority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class UAVState(str, Enum):
    PARKED = "PARKED"
    STANDBY = "STANDBY"
    MISSION_PREP = "MISSION_PREP"
    TAKEOFF = "TAKEOFF"
    SURVEY = "SURVEY"
    RETURN = "RETURN"
    LANDED = "LANDED"
    ABORTED = "ABORTED"

@dataclass
class Waypoint:
    lat: float
    lon: float
    alt: float

@dataclass
class MissionCommand:
    mission_id: str
    target_zone: str
    priority: MissionPriority
    tasks: List[str]
    survey_area_km2: float

@dataclass
class Telemetry:
    uav_id: str
    timestamp: datetime
    state: UAVState
    lat: float
    lon: float
    alt: float
    heading: float
    speed: float
    battery_pct: float
    current_waypoint_idx: int
    total_waypoints: int

@dataclass
class DetectionPacket:
    mission_id: str
    uav_id: str
    object_type: str # "human|vehicle|road|infrastructure"
    latitude: float
    longitude: float
    confidence: float
    thermal_confirmed: bool
    priority: str
    timestamp: datetime

@dataclass
class AssessmentReport:
    mission_id: str
    zone: str
    priority_score: float
    priority_level: MissionPriority
    people_count: int
    vehicles_count: int
    flooded_area_km2: float
    roads_blocked: int
    infrastructure_status: dict
