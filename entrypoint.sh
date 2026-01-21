#!/bin/bash
set -e

# Remove Chrome singleton locks to prevent "profile in use" errors
# This is safe because we assume the container is the only active user of this mount during run
rm -f /app/user_data/SingletonLock
rm -f /app/user_data/SingletonSocket
rm -f /app/user_data/SingletonCookie

# Start Xvfb in the background
# Screen size matches the viewport set in meet.ts (1280x720)
Xvfb :99 -screen 0 1280x720x24 &

# Wait a moment for Xvfb to be ready
sleep 1

# Execute the passed command
exec "$@"
