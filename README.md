# OpenClaw Skill Studio

OpenClaw Skill Studio is a web UI for browsing, editing, versioning, reviewing, and synchronizing OpenClaw skills from a real workspace.

It is designed to work both for local development and for remote OpenClaw deployments, including Docker-based environments, as long as the Studio can access the actual skill files through a mounted filesystem or through pull/push hooks.

This project was developed with Codex GPT-5.4 in a vibe-coding workflow, with iterative product and implementation work done directly in the repository.

## Features

- skills dashboard and per-skill cockpit
- file tree and in-browser code editor
- local working copy with revision history per skill
- restore flow for full revisions or individual files
- explicit synchronization from the Studio working copy to the target workspace
- optional remote sync through shared Docker data or server-side scripts
- built-in app authentication and gateway connection settings

## How it works

1. The Studio reads a real workspace directory from the local machine or from a mounted path inside the container.
2. When a skill is opened, the Studio creates or refreshes a managed working copy.
3. Edits, file creation, rename, delete, and restore operations generate local revisions.
4. The sync action publishes the working copy back to the configured target.
5. If the gateway does not expose file read APIs, the Studio must use either a mounted mirror of the remote skills or server-side pull/push hooks.

## Remote OpenClaw in Docker

Yes, this project is prepared to work with a remote OpenClaw deployment running in Docker, but there is an important constraint:

The Studio must be able to reach the real skill files, not only the gateway metadata.

That means one of these setups must be true:

1. The Studio mounts the same workspace path that the OpenClaw gateway uses.
2. The Studio mounts the same Docker data volume and points to the remote skill mirror.
3. The Studio uses pull/push scripts to import and publish the remote skill through SSH or another server-side mechanism.

If your remote environment does not follow the same directory or volume layout used in this repository, that is fine, but you must adapt the configuration:

- `OPENCLAW_WORKSPACE_HOST_PATH`
- `OPENCLAW_WORKSPACE_ROOT`
- `OPENCLAW_SKILLS_DIR`
- `OPENCLAW_REMOTE_DATA_VOLUME_NAME`
- `OPENCLAW_REMOTE_DATA_MOUNT`
- `OPENCLAW_REMOTE_SKILLS_MIRROR_ROOT`
- `OPENCLAW_REMOTE_SKILLS_PULL_COMMAND`
- `OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND`

Without one of those filesystem access strategies, some things will not work correctly:

- browsing the real remote file tree
- opening file contents
- importing a remote skill into the Studio working copy
- publishing edits back to the remote runtime

The gateway connection alone is not enough for full file editing if the gateway only exposes skill metadata.

## Supported deployment modes

### 1. Local workspace

Use this when the Studio can read the workspace directly from the host.

Example:

```env
OPENCLAW_WORKSPACE_HOST_PATH=.
OPENCLAW_WORKSPACE_ROOT=/workspace
OPENCLAW_SKILLS_DIR=/workspace/skills
```

### 2. Shared Docker data volume

Use this when the Studio can mount the same Docker volume or data path used by the OpenClaw deployment.

Start with:

```bash
docker compose -f docker-compose.yml -f docker-compose.remote-data.yml up -d --build
```

Relevant variables:

- `OPENCLAW_REMOTE_DATA_VOLUME_NAME`
- `OPENCLAW_REMOTE_DATA_MOUNT`
- `OPENCLAW_REMOTE_SKILLS_MIRROR_ROOT`

### 3. Remote pull/push hooks

Use this when the Studio cannot directly mount the remote storage. In that case, the backend imports and publishes the real skill through scripts.

Included helper scripts:

- [`app/scripts/remote_skill_pull.sh`](./app/scripts/remote_skill_pull.sh)
- [`app/scripts/remote_skill_push.sh`](./app/scripts/remote_skill_push.sh)

## Quick start with Docker

Requirements:

- Docker
- Docker Compose
- access to the workspace or remote sync mechanism you intend to use

Copy the example environment file:

```bash
cp .env.example .env
```

Fill in at least:

- `OPENCLAW_APP_LOGIN_USER`
- `OPENCLAW_APP_LOGIN_PASS`
- `OPENCLAW_APP_SESSION_SECRET`
- `OPENCLAW_WORKSPACE_HOST_PATH`
- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_GATEWAY_TOKEN`

Then start the app:

```bash
docker compose up -d --build
```

Default URL: `http://localhost:8765`

## Run without Docker

```bash
cd app
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python app.py
```

## Environment configuration

The committed file is [`.env.example`](./.env.example). The intended workflow is to copy it to `.env` and fill it locally.

Main groups:

- App:
  - `OPENCLAW_APP_TITLE`
  - `OPENCLAW_APP_LOGIN_USER`
  - `OPENCLAW_APP_LOGIN_PASS`
  - `OPENCLAW_APP_SESSION_SECRET`
- Workspace:
  - `OPENCLAW_WORKSPACE_HOST_PATH`
  - `OPENCLAW_WORKSPACE_ROOT`
  - `OPENCLAW_SKILLS_DIR`
  - `OPENCLAW_STUDIO_DATA_ROOT`
- Gateway:
  - `OPENCLAW_GATEWAY_URL`
  - `OPENCLAW_GATEWAY_TOKEN`
  - `OPENCLAW_GATEWAY_BASIC_USER`
  - `OPENCLAW_GATEWAY_BASIC_PASS`
- Optional remote sync:
  - `OPENCLAW_REMOTE_DATA_VOLUME_NAME`
  - `OPENCLAW_REMOTE_DATA_MOUNT`
  - `OPENCLAW_REMOTE_SKILLS_MIRROR_ROOT`
  - `OPENCLAW_REMOTE_SKILLS_PULL_COMMAND`
  - `OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND`
  - `OPENCLAW_REMOTE_SSH_HOST`
  - `OPENCLAW_REMOTE_SSH_PORT`
  - `OPENCLAW_REMOTE_SSH_USER`
  - `OPENCLAW_REMOTE_SSH_PASSWORD`
  - `OPENCLAW_REMOTE_DOCKER_CONTAINER`

## Security for a public repository

- Never commit `.env` or any local environment variant with real credentials.
- Never commit gateway tokens, HTTP Basic credentials, SSH passwords, or session secrets.
- Keep only placeholder values in committed example files.
- Use a low-privilege gateway user when possible.
- Rotate any credential that may have been exposed before publishing the repository.

The [`.gitignore`](./.gitignore) in this repository covers common environment files, key files, and local runtime artifacts, but it only protects future commits. It does not clean already-published Git history.

## License and liability

This repository is released under the MIT license. That means people may use, copy, modify, publish, distribute, sublicense, and reuse the software freely, subject to the license terms.

See:

- [`LICENSE`](./LICENSE)
- [`DISCLAIMER.md`](./DISCLAIMER.md)

Important:

- the software is provided "as is"
- there is no warranty
- users are responsible for their own deployment, compliance, data handling, backups, and operational decisions
- the license and disclaimer are intended to limit author liability, but they are not a substitute for jurisdiction-specific legal advice

## Project structure

- [`docker-compose.yml`](./docker-compose.yml): default Studio deployment
- [`docker-compose.remote-data.yml`](./docker-compose.remote-data.yml): optional shared-volume deployment override
- [`app/`](./app): Flask app, templates, static assets, and helper scripts
- [`app/app.py`](./app/app.py): main backend
- [`app/static/`](./app/static): JavaScript and CSS
- [`app/templates/`](./app/templates): HTML pages and partials

## Contributing

Contributions are welcome.

Suggested workflow:

1. Create a fork or a working branch.
2. Describe the proposed change and the expected behavior clearly.
3. Include screenshots for UI changes.
4. Do not include credentials, internal hosts, real usernames, or private paths in examples.
5. Update the documentation when setup, environment variables, or sync behavior changes.

## License

This repository uses the MIT license. See [`LICENSE`](./LICENSE).
