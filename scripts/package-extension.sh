#!/bin/sh
# Builds dist/subtok-extension.zip for a GitHub release. Files sit at the zip root, so unzipping gives one folder to load.
set -eu
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/subtok-extension.zip
(cd extension && zip -q -r -X ../dist/subtok-extension.zip . -x '.*')
echo "dist/subtok-extension.zip (version $(python3 -c "import json; print(json.load(open('extension/manifest.json'))['version'])"))"
