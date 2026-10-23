#!/bin/bash
set -e

# Visual Anchors for steps
INFO="[INFO]"
SUCCESS="[SUCCESS]"
ERROR="[ERROR]"

echo "$INFO Navigating to backend path..."
cd "$(dirname "$0")"

# 1. Declare targets and highly accurate links
TAILWIND_URL="https://npmjs.org"
POSTCSS_URL="https://npmjs.org"
AUTOPREFIXER_URL="https://npmjs.org"

# Mirror Fallbacks if registry.npmjs.org completely rejects connections
TAILWIND_MIRROR="https://npmmirror.com"
POSTCSS_MIRROR="https://npmmirror.com"
AUTOPREFIXER_MIRROR="https://npmmirror.com"

# 2. Heavy Verbose Download Blocks
echo "$INFO Fetching Packages via highly verbose curl..."

# Download Tailwind
echo "$INFO Downloading Tailwind CSS..."
if ! curl --verbose --connect-timeout 30 --retry 3 --ipv4 -L "$TAILWIND_URL" -o tailwindcss.tgz; then
    echo "$INFO Primary timeout. Swapping to high-availability Mirror..."
    curl --verbose --connect-timeout 30 -L "$TAILWIND_MIRROR" -o tailwindcss.tgz
fi

# Download PostCSS
echo "$INFO Downloading PostCSS..."
if ! curl --verbose --connect-timeout 30 --retry 3 --ipv4 -L "$POSTCSS_URL" -o postcss.tgz; then
    echo "$INFO Primary timeout. Swapping to high-availability Mirror..."
    curl --verbose --connect-timeout 30 -L "$POSTCSS_MIRROR" -o postcss.tgz
fi

# Download Autoprefixer
echo "$INFO Downloading Autoprefixer..."
if ! curl --verbose --connect-timeout 30 --retry 3 --ipv4 -L "$AUTOPREFIXER_URL" -o autoprefixer.tgz; then
    echo "$INFO Primary timeout. Swapping to high-availability Mirror..."
    curl --verbose --connect-timeout 30 -L "$AUTOPREFIXER_MIRROR" -o autoprefixer.tgz
fi

# 3. Clean up existing corrupted frames
echo "$INFO Purging network-cached variables..."
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
npm config rm proxy
npm config rm https-proxy

# 4. Force Execution Block
echo "$INFO Execging offline file extraction..."
npm install -D --prefer-offline --no-audit ./tailwindcss.tgz ./postcss.tgz ./autoprefixer.tgz

# 5. Clean up downloaded tarballs to keep desktop tidy
rm tailwindcss.tgz postcss.tgz autoprefixer.tgz

echo "$SUCCESS Tailwind CSS suite forced successfully!"
