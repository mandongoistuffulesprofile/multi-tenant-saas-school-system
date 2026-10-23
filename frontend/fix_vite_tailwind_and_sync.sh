#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}====================================================================${NC}"
echo -e "${CYAN}>>> FIXING VITE POSTCSS / TAILWIND DEPENDENCY & SYNCING TO GITHUB <<<${NC}"
echo -e "${CYAN}====================================================================${NC}"

# Detect Git branch & remote
if [ ! -d ".git" ]; then
    echo -e "${RED}[ERROR] .git folder not found. Run from the project root!${NC}"
    exit 1
fi

CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD)
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)

# Detect frontend directory
if [ -d "frontend" ]; then
    FRONTEND_DIR="frontend"
elif [ -f "package.json" ]; then
    FRONTEND_DIR="."
else
    echo -e "${RED}[ERROR] Cannot find frontend directory!${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/4] Installing tailwindcss, autoprefixer & postcss in ${FRONTEND_DIR}...${NC}"
(
    cd "$FRONTEND_DIR"
    npm install --save-dev tailwindcss@^3.4.0 autoprefixer@^10.4.0 postcss@^8.4.0
)

echo -e "${YELLOW}[2/4] Ensuring tailwind.config.js is configured correctly...${NC}"
cat << 'TAILWIND_EOF' > "$FRONTEND_DIR/tailwind.config.js"
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
TAILWIND_EOF

echo -e "${YELLOW}[3/4] Ensuring postcss.config.js is clean...${NC}"
cat << 'POSTCSS_EOF' > "$FRONTEND_DIR/postcss.config.js"
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
POSTCSS_EOF

# Verify build passes
echo -e "${YELLOW}[4/4] Verifying Vite build...${NC}"
(
    cd "$FRONTEND_DIR"
    npm run build
)
echo -e "${GREEN}  ✓ Vite build succeeded with zero PostCSS errors!${NC}"

# ------------------------------------------------------------------------------
# GIT COMMIT, PUSH & VERIFY LIVE GITHUB HASH
# ------------------------------------------------------------------------------
echo -e "\n${CYAN}====================================================================${NC}"
echo -e "${CYAN}>>> COMMITTING & PUSHING TAILWIND FIX TO GITHUB...               <<<${NC}"
echo -e "${CYAN}====================================================================${NC}"

git add -A

if git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}[!] Working tree is already clean.${NC}"
else
    COMMIT_MSG="fix(frontend): install local tailwindcss and autoprefixer to resolve PostCSS crash

- Installed tailwindcss, autoprefixer, and postcss in frontend/package.json
- Created frontend/tailwind.config.js with scan paths for React components
- Verified clean Vite build without PostCSS plugin errors"

    git commit -m "$COMMIT_MSG"
    echo -e "${GREEN}  ✓ Created Git commit successfully.${NC}"
fi

echo -e "${YELLOW}[+] Pushing branch '${CURRENT_BRANCH}' to origin...${NC}"
git push origin "$CURRENT_BRANCH"

LOCAL_HASH=$(git rev-parse HEAD)
REMOTE_HASH=$(git ls-remote origin "refs/heads/${CURRENT_BRANCH}" | awk '{print $1}')

if [ "$LOCAL_HASH" = "$REMOTE_HASH" ]; then
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "${GREEN}>>> SUCCESS: TAILWIND FIX COMMITTED & LIVE ON GITHUB!           <<<${NC}"
    echo -e "${GREEN}====================================================================${NC}"
    echo -e "Commit SHA : ${LOCAL_HASH}"
    echo -e "Branch     : ${CURRENT_BRANCH}"
    echo -e "Remote Repo: ${REMOTE_URL}"
else
    echo -e "${RED}[ERROR] Remote hash mismatch!${NC}"
    exit 1
fi
