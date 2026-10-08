import uvicorn
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

if __name__ == "__main__":
    print("Starting RUDRANETRA Ground Station Server...")
    print("Access the dashboard at: http://localhost:8000")
    uvicorn.run("rudranetra.backend.main:app", host="0.0.0.0", port=8000, reload=False)
