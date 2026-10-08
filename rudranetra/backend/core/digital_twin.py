class DigitalTwin:
    def __init__(self):
        # Home coordinates
        self.home_lat = 12.9715987
        self.home_lon = 77.5945627
        self.home_alt = 0.0
        
        # Ground truth objects
        self.objects = []
        
    def get_home_location(self):
        return (self.home_lat, self.home_lon, self.home_alt)
        
    def get_objects_in_radius(self, lat, lon, radius_deg=0.001):
        detected = []
        for obj in self.objects:
            # simple euclidean distance for mock sensing
            dist = ((obj["lat"] - lat)**2 + (obj["lon"] - lon)**2)**0.5
            if dist <= radius_deg:
                detected.append(obj)
        return detected
