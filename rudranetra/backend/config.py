class Config:
    # UAV Kinematics
    MAX_SPEED_MPS = 15.0      # m/s
    MAX_CLIMB_RATE = 3.0      # m/s
    CRUISE_ALTITUDE = 50.0    # m
    BATTERY_MAX_MAH = 10000.0 # mAh
    BATTERY_DRAIN_RATE = 5.0  # mAh per second (base)
    LOW_BATTERY_THRESHOLD = 0.20 # 20%
    CRITICAL_BATTERY_THRESHOLD = 0.05 # 5%

    # Grid / Digital Twin
    GRID_SIZE_KM = 5.0        # 5x5 km area
    CELL_RESOLUTION = 10.0    # meters per cell
    
    # Mission Manager
    WAYPOINT_OVERLAP = 0.2    # 20% overlap
    CAMERA_FOV = 60.0         # degrees
    
    # Simulation
    UPDATE_HZ = 20.0          # 20 Hz tick rate
    DT = 1.0 / UPDATE_HZ

config = Config()
