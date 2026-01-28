#!/bin/bash
set -e

# Start Xvfb in the background
# Screen size matches the viewport set in meet.ts (1280x720)
Xvfb :99 -screen 0 1280x720x24 &

# Wait a moment for Xvfb to be ready
sleep 1

# Execute the passed command
exec "$@"
