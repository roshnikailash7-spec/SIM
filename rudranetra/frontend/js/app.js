// app.js

const map = L.map('map', {
    zoomControl: false
}).setView([12.9715987, 77.5945627], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
}).addTo(map);

// Add zoom control to bottom right
L.control.zoom({ position: 'bottomright' }).addTo(map);

// UAV Marker
const uavIcon = L.divIcon({
    className: 'uav-marker',
    html: `<div style="width:16px;height:16px;background:#3b82f6;border-radius:50%;border:2px solid #fff;box-shadow:0 0 15px #3b82f6;"></div>`,
    iconSize: [16, 16]
});
let uavMarker = L.marker([12.9715987, 77.5945627], {icon: uavIcon}).addTo(map);

// Path Polyline
const pathPolyline = L.polyline([], {color: '#3b82f6', weight: 2, opacity: 0.7}).addTo(map);
// Footprint Circle
let footprintCircle = L.circle([12.9715987, 77.5945627], {radius: 50, color: '#3b82f6', fillOpacity: 0.1, weight: 1, dashArray: '5, 5'}).addTo(map);

// Detections
let detectionMarkers = [];
const detectionIcons = {
    'human': L.divIcon({html: '<div style="width:10px;height:10px;background:#f59e0b;border-radius:50%;border:1px solid #fff;"></div>', iconSize: [10,10], className:''}),
    'vehicle': L.divIcon({html: '<div style="width:12px;height:12px;background:#10b981;border-radius:0;border:1px solid #fff;"></div>', iconSize: [12,12], className:''}),
    'road_blocked': L.divIcon({html: '<div style="width:12px;height:12px;background:#ef4444;transform:rotate(45deg);border:1px solid #fff;"></div>', iconSize: [12,12], className:''}),
};

let stats = { people: 0, vehicles: 0, roads: 0 };

// WebSocket Connection
const connectWebSocket = () => {
    const ws = new WebSocket(`ws://${window.location.host}/ws/telemetry`);
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if(data.type === 'telemetry') {
            updateTelemetry(data);
        } else if(data.type === 'detection') {
            handleDetection(data);
        }
    };
    
    ws.onclose = () => {
        addLog("WebSocket disconnected. Reconnecting...");
        setTimeout(connectWebSocket, 1000);
    };
};

connectWebSocket();

function updateTelemetry(telem) {
    document.getElementById('val-state').textContent = telem.state;
    document.getElementById('val-battery').textContent = (telem.battery_pct * 100).toFixed(1) + '%';
    document.getElementById('val-alt').textContent = telem.alt.toFixed(1) + ' m';
    document.getElementById('val-speed').textContent = telem.speed.toFixed(1) + ' m/s';

    const newLatLng = [telem.lat, telem.lon];
    uavMarker.setLatLng(newLatLng);
    pathPolyline.addLatLng(newLatLng);
    footprintCircle.setLatLng(newLatLng);
    
    // Smooth pan if moving
    if(telem.state === 'TAKEOFF' || telem.state === 'SURVEY' || telem.state === 'RETURN') {
        map.panTo(newLatLng, {animate: true, duration: 0.1});
    }
    
    if(telem.state === 'LANDED') {
        document.getElementById('btn-start').disabled = false;
        document.getElementById('btn-start').textContent = 'DISPATCH UAV';
        
        // Mock Assessment Score once landed
        document.getElementById('zone-score').textContent = '92.5';
        document.getElementById('zone-level').innerHTML = '<span style="color:#ef4444;font-weight:bold;">IMMEDIATE</span>';
    }
}

function handleDetection(det) {
    addLog(`DETECTED: ${det.object_type.toUpperCase()} (Conf: ${(det.confidence*100).toFixed(1)}%)`, true);
    
    let icon = detectionIcons[det.object_type] || detectionIcons['human'];
    L.marker([det.lat, det.lon], {icon: icon}).addTo(map);
    
    // Update stats
    if(det.object_type === 'human') {
        stats.people++;
        document.getElementById('val-people').textContent = stats.people;
    } else if(det.object_type === 'vehicle') {
        stats.vehicles++;
        document.getElementById('val-vehicles').textContent = stats.vehicles;
    } else if(det.object_type === 'road_blocked') {
        stats.roads++;
        document.getElementById('val-roads').textContent = stats.roads;
    }
}

function addLog(msg, isDetection=false) {
    const log = document.getElementById('event-log');
    const el = document.createElement('div');
    el.className = 'log-entry' + (isDetection ? ' detection' : '');
    const d = new Date();
    el.textContent = `[${d.toLocaleTimeString()}] ${msg}`;
    log.prepend(el);
}

addLog("System initialized. Awaiting mission.");

// Dispatch Mission
document.getElementById('btn-start').addEventListener('click', async () => {
    addLog("Sending mission PRV-UAV-001...");
    pathPolyline.setLatLngs([]); // clear previous path
    
    // Reset stats
    stats = { people: 0, vehicles: 0, roads: 0 };
    document.getElementById('val-people').textContent = '0';
    document.getElementById('val-vehicles').textContent = '0';
    document.getElementById('val-roads').textContent = '0';
    document.getElementById('zone-score').textContent = '--';
    document.getElementById('zone-level').textContent = 'PENDING';

    try {
        const res = await fetch('/api/mission', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                mission_id: "PRV-UAV-001",
                target_zone: "Zone 04",
                priority: "CRITICAL",
                tasks: ["survey"],
                survey_area_km2: 5.0
            })
        });
        if(res.ok) {
            addLog("Mission accepted. Standby for takeoff.");
            document.getElementById('btn-start').disabled = true;
            document.getElementById('btn-start').textContent = 'MISSION IN PROGRESS';
        }
    } catch (e) {
        addLog("Failed to send mission to backend.");
    }
});
