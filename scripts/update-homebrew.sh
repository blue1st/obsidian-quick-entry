#!/bin/bash

# This script updates the Homebrew Cask definition in the tap repository.
# Expected environment variables:
# HOMEBREW_TAP_TOKEN: GitHub Personal Access Token with repo scope

set -e

TAP_REPO="blue1st/homebrew-taps"
CASK_NAME="obsidian-quick-entry"
PACKAGE_JSON="package.json"

# Get version from package.json
VERSION=$(node -p "require('./$PACKAGE_JSON').version")
echo "Updating Homebrew Cask to version $VERSION"

# Find DMG
DMG_UNIVERSAL=$(find . -name "*_universal.dmg" | head -n 1)

if [ -z "$DMG_UNIVERSAL" ]; then
  echo "Error: Could not find universal DMG file"
  exit 1
fi

SHA256_UNIVERSAL=$(shasum -a 256 "$DMG_UNIVERSAL" | awk '{print $1}')

echo "Universal DMG SHA256: $SHA256_UNIVERSAL"

# Clone the tap repository
TMP_DIR=$(mktemp -d)
git clone "https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/${TAP_REPO}.git" "$TMP_DIR"

# Ensure Casks directory exists
mkdir -p "$TMP_DIR/Casks"

CASK_FILE="$TMP_DIR/Casks/${CASK_NAME}.rb"

# Create or update the Cask file
cat <<EOF > "$CASK_FILE"
cask "${CASK_NAME}" do
  version "${VERSION}"
  sha256 "${SHA256_UNIVERSAL}"

  url "https://github.com/blue1st/obsidian-quick-entry/releases/download/v#{version}/Obsidian.Quick.Entry_#{version}_universal.dmg"
  name "Obsidian Quick Entry"
  desc "Obsidian quick entry widget for system tray"
  homepage "https://github.com/blue1st/obsidian-quick-entry"

  app "Obsidian Quick Entry.app"

  postflight do
    system_command "xattr",
                   args: ["-cr", "#{appdir}/Obsidian Quick Entry.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/com.t-kawasaki.obsidian-quick-entry",
    "~/Library/Preferences/com.t-kawasaki.obsidian-quick-entry.plist",
    "~/Library/Saved Application State/com.t-kawasaki.obsidian-quick-entry.savedState",
  ]
end
EOF

# Commit and push
cd "$TMP_DIR"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add "Casks/${CASK_NAME}.rb"
git commit -m "Update ${CASK_NAME} to v${VERSION}" || echo "No changes to commit"
git push origin main

echo "Homebrew tap updated successfully!"
