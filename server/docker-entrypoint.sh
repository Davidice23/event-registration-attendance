#!/bin/sh
set -eu

# Replace the entrypoint process so Node (or a one-shot migration/seed command)
# receives container signals directly.
exec "$@"
