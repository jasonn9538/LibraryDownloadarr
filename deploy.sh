#!/bin/bash
# Deploy script - validates, waits for GitHub Actions build and redeploys via Portainer API

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========================================"
echo "  LibraryDownloadarr Deploy Script"
echo "========================================"
echo ""

# ==========================================
# PRE-FLIGHT VALIDATION CHECKS
# ==========================================
echo "Running pre-flight validation checks..."
echo ""

# Check 1: Backend TypeScript compilation
echo -n "  Checking backend TypeScript... "
BACKEND_ERRORS=$(cd backend && npx tsc --noEmit 2>&1)
if [ $? -ne 0 ]; then
    echo -e "${RED}FAILED${NC}"
    echo "$BACKEND_ERRORS"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

# Check 2: Frontend TypeScript + Vite build
echo -n "  Checking frontend build... "
FRONTEND_ERRORS=$(cd frontend && npx tsc --noEmit 2>&1)
if [ $? -ne 0 ]; then
    echo -e "${RED}FAILED${NC}"
    echo "$FRONTEND_ERRORS"
    exit 1
fi
echo -e "${GREEN}OK${NC}"

echo ""
echo -e "${GREEN}All validation checks passed!${NC}"
echo ""

# ==========================================
# LOAD SECRETS AND CONFIG
# ==========================================
if [ -f "$SCRIPT_DIR/.secrets" ]; then
    source "$SCRIPT_DIR/.secrets"
else
    echo -e "${RED}Error: .secrets file not found!${NC}"
    echo "Create a .secrets file with: PORTAINER_API_KEY=\"your-api-key\""
    exit 1
fi

PORTAINER_URL="http://localhost:9000"
STACK_ID="16"
ENDPOINT_ID="2"
IMAGE="ghcr.io/jasonn9538/librarydownloadarr:latest"

# ==========================================
# BUILD MODE SELECTION
# ==========================================
if [ "$1" = "--local" ] || [ "$1" = "-l" ]; then
    echo "Building image locally..."
    echo ""
    sudo docker build -t "$IMAGE" .
    if [ $? -ne 0 ]; then
        echo -e "${RED}Local build failed!${NC}"
        exit 1
    fi
    echo -e "${GREEN}Local build complete!${NC}"
else
    # ==========================================
    # WAIT FOR GITHUB BUILD
    # ==========================================
    echo "Checking latest GitHub Actions build..."

    # Wait for the latest workflow run to complete
    RUN_ID=$(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')

    if [ -z "$RUN_ID" ]; then
        echo -e "${RED}No workflow runs found${NC}"
        exit 1
    fi

    echo "Waiting for build #$RUN_ID to complete..."
    gh run watch "$RUN_ID" --exit-status

    if [ $? -ne 0 ]; then
        echo -e "${RED}Build failed!${NC}"
        exit 1
    fi

    echo -e "${GREEN}Build complete!${NC}"

    # Pull the latest image
    echo "Pulling latest image..."
    sudo docker pull "$IMAGE"
fi

echo ""
echo "Deploying via Portainer..."

# Stop the stack via Portainer API
echo "Stopping stack..."
curl -s -X POST \
    -H "X-API-Key: $PORTAINER_API_KEY" \
    "$PORTAINER_URL/api/stacks/$STACK_ID/stop?endpointId=$ENDPOINT_ID" > /dev/null

sleep 2

# Start the stack via Portainer API
echo "Starting stack..."
curl -s -X POST \
    -H "X-API-Key: $PORTAINER_API_KEY" \
    "$PORTAINER_URL/api/stacks/$STACK_ID/start?endpointId=$ENDPOINT_ID" > /dev/null

sleep 5

# Verify
echo "Verifying..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5069/api/health)

if [ "$HTTP_CODE" = "200" ]; then
    echo ""
    echo -e "${GREEN}Deployment successful! App is live at http://localhost:5069${NC}"
else
    echo ""
    echo -e "${YELLOW}Site returned HTTP $HTTP_CODE - check logs with: sudo docker logs librarydownloadarr${NC}"
fi
