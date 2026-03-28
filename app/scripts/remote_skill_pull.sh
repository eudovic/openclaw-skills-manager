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

rm -rf "${OPENCLAW_STUDIO_SKILL_ROOT}"
mkdir -p "${OPENCLAW_STUDIO_SKILL_ROOT}"

REMOTE_CMD=$(cat <<EOF
docker exec "${OPENCLAW_REMOTE_DOCKER_CONTAINER}" sh -lc 'cd "${OPENCLAW_REMOTE_BASE_DIR}" && tar -cf - .'
EOF
)

if [ -n "${OPENCLAW_REMOTE_SSH_PASSWORD:-}" ]; then
  sshpass -p "${OPENCLAW_REMOTE_SSH_PASSWORD}" ssh ${SSH_OPTS} "${OPENCLAW_REMOTE_SSH_USER}@${OPENCLAW_REMOTE_SSH_HOST}" "${REMOTE_CMD}" | tar -xf - -C "${OPENCLAW_STUDIO_SKILL_ROOT}"
else
  ssh ${SSH_OPTS} "${OPENCLAW_REMOTE_SSH_USER}@${OPENCLAW_REMOTE_SSH_HOST}" "${REMOTE_CMD}" | tar -xf - -C "${OPENCLAW_STUDIO_SKILL_ROOT}"
fi
