#!/bin/bash

echo "Starting RTMP Viewer..."
echo "========================"
echo ""
echo "RTMP Server: rtmp://localhost/live/stream"
echo "Web Interface: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop all servers"
echo "========================"
echo ""

# Trap Ctrl+C and kill all child processes
trap 'kill 0' EXIT

# Start the combined server
node server.js

# Wait for all background processes
wait