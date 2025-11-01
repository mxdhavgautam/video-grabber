#!/bin/bash
# VPS Deployment Script
# This script builds and deploys the Video Grabber backend to Docker

set -e

echo "=========================================="
echo "Video Grabber - VPS Deployment"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ensure we're in the project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Step 1: Check if Docker is running
echo -e "\n${BLUE}[1/5] Checking Docker...${NC}"
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed"
    exit 1
fi
docker --version

# Step 2: Build the Docker image (use --no-cache to pick up code changes)
echo -e "\n${BLUE}[2/5] Building Docker image (no cache)...${NC}"
docker build --no-cache -t video-grabber-backend:latest -f deployment-backup/Dockerfile .

# Step 3: Stop existing container if running
echo -e "\n${BLUE}[3/5] Stopping existing container...${NC}"
cd "$PROJECT_ROOT/deployment-backup"
docker-compose down || true

# Step 4: Start container
echo -e "\n${BLUE}[4/5] Starting container...${NC}"
docker-compose up -d

# Step 5: Verify
echo -e "\n${BLUE}[5/5] Verifying deployment...${NC}"
sleep 5
docker-compose logs --tail 30

echo -e "\n${GREEN}✅ Deployment complete!${NC}"
echo -e "Backend URL: http://localhost:3001"
echo -e "Health check: curl http://localhost:3001/health"
echo -e "\nView logs: docker-compose logs -f"
echo -e "\nTo watch pre-warming and startup:"
echo -e "  docker-compose logs -f backend"
