#!/usr/bin/env sh
set -eu

IMAGE="${IMAGE:-industree-tests}"

docker build -f Dockerfile.test -t "$IMAGE" .
docker run --rm "$IMAGE"
