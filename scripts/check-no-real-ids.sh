#!/bin/sh
set -eu
node "$(dirname "$0")/checks.mjs" ids
