#!/bin/sh
set -eu

require_env() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "Variavel obrigatoria ausente: $name" >&2
    exit 1
  fi
}

require_env OPENCLAW_REMOTE_SSH_HOST
require_env OPENCLAW_REMOTE_SSH_USER
require_env OPENCLAW_REMOTE_DOCKER_CONTAINER
require_env OPENCLAW_REMOTE_BASE_DIR
require_env OPENCLAW_STUDIO_SKILL_ROOT

SSH_PORT="${OPENCLAW_REMOTE_SSH_PORT:-22}"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${SSH_PORT}"

if [ -n "${OPENCLAW_REMOTE_SSH_PASSWORD:-}" ]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "sshpass nao encontrado no container." >&2
    exit 1
  fi
fi

REMOTE_CMD=$(cat <<EOF
docker exec -i "${OPENCLAW_REMOTE_DOCKER_CONTAINER}" sh -lc 'rm -rf "${OPENCLAW_REMOTE_BASE_DIR}" && mkdir -p "${OPENCLAW_REMOTE_BASE_DIR}" && tar -xf - -C "${OPENCLAW_REMOTE_BASE_DIR}"'
EOF
)

if [ -n "${OPENCLAW_REMOTE_SSH_PASSWORD:-}" ]; then
  tar -cf - -C "${OPENCLAW_STUDIO_SKILL_ROOT}" . | sshpass -p "${OPENCLAW_REMOTE_SSH_PASSWORD}" ssh ${SSH_OPTS} "${OPENCLAW_REMOTE_SSH_USER}@${OPENCLAW_REMOTE_SSH_HOST}" "${REMOTE_CMD}"
else
  tar -cf - -C "${OPENCLAW_STUDIO_SKILL_ROOT}" . | ssh ${SSH_OPTS} "${OPENCLAW_REMOTE_SSH_USER}@${OPENCLAW_REMOTE_SSH_HOST}" "${REMOTE_CMD}"
fi
