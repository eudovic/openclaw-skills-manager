from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import socket
import sqlite3
import ssl
import stat as statlib
import subprocess
import time
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse, urlunparse

import yaml
import jsbeautifier
from black import FileMode, InvalidInput, NothingChanged, format_file_contents
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, PublicFormat
from dotenv import load_dotenv
from flask import Flask, has_request_context, jsonify, render_template, request, session
from websocket import WebSocketTimeoutException, create_connection
from websocket._exceptions import WebSocketBadStatusException, WebSocketConnectionClosedException

try:
    import pwd
except ImportError:  # pragma: no cover - compat
    pwd = None  # type: ignore[assignment]

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

APP_TITLE = os.getenv("OPENCLAW_APP_TITLE", "OpenClaw Skill Studio")
APP_LOGIN_USER = os.getenv("OPENCLAW_APP_LOGIN_USER", "")
APP_LOGIN_PASS = os.getenv("OPENCLAW_APP_LOGIN_PASS", "")
APP_AUTH_REQUIRED = bool(APP_LOGIN_USER and APP_LOGIN_PASS)
APP_SESSION_SECRET = os.getenv("OPENCLAW_APP_SESSION_SECRET", secrets.token_hex(32))
APP_SESSION_SECURE = os.getenv("OPENCLAW_APP_SESSION_SECURE", "0") == "1"
WORKSPACE_ROOT = Path(os.getenv("OPENCLAW_WORKSPACE_ROOT") or PROJECT_ROOT).expanduser().resolve()
CONFIGURED_SKILLS_DIR = Path(os.getenv("OPENCLAW_SKILLS_DIR") or (WORKSPACE_ROOT / "skills")).expanduser().resolve()
STUDIO_DATA_ROOT = Path(os.getenv("OPENCLAW_STUDIO_DATA_ROOT") or "/studio-data").expanduser()
STUDIO_DB_PATH = Path(os.getenv("OPENCLAW_STUDIO_DB_PATH") or (STUDIO_DATA_ROOT / "studio.db")).expanduser()
STUDIO_REPO_ROOT = Path(os.getenv("OPENCLAW_STUDIO_REPO_ROOT") or (STUDIO_DATA_ROOT / "skills")).expanduser()
REMOTE_SKILLS_MIRROR_ROOT_RAW = (os.getenv("OPENCLAW_REMOTE_SKILLS_MIRROR_ROOT") or "").strip()
REMOTE_SKILLS_MIRROR_ROOT = Path(REMOTE_SKILLS_MIRROR_ROOT_RAW).expanduser() if REMOTE_SKILLS_MIRROR_ROOT_RAW else None
OPENCLAW_REMOTE_SKILLS_PULL_COMMAND = (os.getenv("OPENCLAW_REMOTE_SKILLS_PULL_COMMAND") or "").strip()
OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND = (os.getenv("OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND") or "").strip()
DEFAULT_GATEWAY_URL = os.getenv("OPENCLAW_GATEWAY_URL", "")
DEFAULT_GATEWAY_TOKEN = os.getenv("OPENCLAW_GATEWAY_TOKEN", "")
DEFAULT_GATEWAY_BASIC_USER = os.getenv("OPENCLAW_GATEWAY_BASIC_USER", "")
DEFAULT_GATEWAY_BASIC_PASS = os.getenv("OPENCLAW_GATEWAY_BASIC_PASS", "")
OPENCLAW_SKILLS_APPLY_COMMAND = os.getenv("OPENCLAW_SKILLS_APPLY_COMMAND", "")
OPENCLAW_GATEWAY_RESTART_COMMAND = os.getenv("OPENCLAW_GATEWAY_RESTART_COMMAND", "")
OPENCLAW_SKILLS_VALIDATE_COMMAND = os.getenv("OPENCLAW_SKILLS_VALIDATE_COMMAND", "")
OPENCLAW_SKILLS_TEST_COMMAND = os.getenv("OPENCLAW_SKILLS_TEST_COMMAND", "")
CONFIGURED_GATEWAY_DEVICE_STATE_FILE = Path(
    os.getenv("OPENCLAW_GATEWAY_DEVICE_STATE_FILE")
    or (WORKSPACE_ROOT / ".openclaw-skill-studio" / "gateway-device.json")
).expanduser()

SKILL_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
FRONTMATTER_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*\r?\n?(.*)$", re.DOTALL)
MAX_TEXT_FILE_BYTES = 2_000_000
OPENCLAW_GATEWAY_PROTOCOL = 3
OPENCLAW_GATEWAY_ROLE = "operator"
OPENCLAW_GATEWAY_CLIENT_ID = "openclaw-control-ui"
OPENCLAW_GATEWAY_CLIENT_MODE = "webchat"
OPENCLAW_GATEWAY_SCOPES = ["operator.admin", "operator.approvals", "operator.pairing"]
OPENCLAW_GATEWAY_USER_AGENT = "openclaw-skill-studio"
REMOTE_WORKSPACE_SOURCE = "openclaw-workspace"

DOC_LINKS = [
    {
        "title": "Creating Skills",
        "url": "https://docs.openclaw.ai/tools/creating-skills",
        "summary": "How to create a skill folder, structure SKILL.md, load the skill, and test it.",
    },
    {
        "title": "Skills Reference",
        "url": "https://docs.openclaw.ai/tools/skills",
        "summary": "Workspace precedence, SKILL.md format, metadata.openclaw, watcher behavior, and session impact.",
    },
    {
        "title": "Skills Config",
        "url": "https://docs.openclaw.ai/tools/skills-config",
        "summary": "Configure entries.<skill>, env/apiKey, watchDebounceMs, extraDirs, and installers.",
    },
    {
        "title": "ClawHub",
        "url": "https://docs.openclaw.ai/clawhub",
        "summary": "Public registry for publishing, discovering, installing, and synchronizing skills.",
    },
    {
        "title": "Gateway Configuration",
        "url": "https://docs.openclaw.ai/gateway/configuration",
        "summary": "Gateway reference, reload modes, and config RPCs for remote operation.",
    },
]

DOC_NOTES = [
    "Workspace skills live in <workspace>/skills and take precedence over local and bundled skills.",
    "Some environments organize those skills under <workspace>/skills/public; the interface tries to detect that layout automatically.",
    "Changes to SKILL.md can refresh the snapshot automatically when the skill watcher is enabled.",
    "To ensure the skill takes effect, the documentation recommends starting a new session (/new) or restarting the gateway.",
    "The macOS UI uses skills.status, skills.install, and skills.update on the gateway for eligibility, installation, and configuration.",
]

TEMPLATE_PRESETS: dict[str, dict[str, Any]] = {
    "blank": {
        "label": "Blank",
        "description": "Minimal structure with SKILL.md and short instructions.",
        "files": {},
        "body": """# {title}

Use this skill when the user asks for {capability}.

## Goal
Explain clearly what this skill does and when it should be chosen.

## Recommended flow
1. Understand the user's intent.
2. Use the necessary tools safely.
3. Deliver the final result and call out risks or the next step.

## Local context
Support files for this skill live in `{baseDir}`.
""",
    },
    "operational": {
        "label": "Operational",
        "description": "Playbook with checklists, notes, and a runbooks folder.",
        "files": {
            "runbooks/checklist.md": """# Checklist

- Define preconditions
- Execute steps in order
- Record validations
""",
            "notes/context.md": """# Context

Document APIs, risks, owners, and external links used by the skill here.
""",
        },
        "body": """# {title}

Use this skill for repeatable {capability} operations.

## How to operate
1. Review `runbooks/checklist.md` before executing any step.
2. Follow the procedure in a deterministic way.
3. Record results and any deviations in `notes/context.md`.

## Guardrails
- Never execute destructive actions without explicit confirmation.
- In the event of a partial failure, describe the current state before continuing.
""",
    },
    "integration": {
        "label": "Integration",
        "description": "Base for skills that integrate APIs, CLIs, or external gateways.",
        "files": {
            "examples/sample-request.json": "{\n  \"id\": \"demo\",\n  \"payload\": {}\n}\n",
            "docs/api-notes.md": """# API Notes

- Base endpoint
- Authentication
- Limits and retries
- Payload examples
""",
        },
        "body": """# {title}

Use this skill to integrate {capability}.

## Procedure
1. Read `docs/api-notes.md` for limits, authentication, and examples.
2. Validate inputs before calling any API or CLI.
3. If payloads are involved, use `examples/sample-request.json` as a reference.

## Expected output
Return a clear summary of what was sent, what came back, and what still depends on manual action.
""",
    },
}

app = Flask(__name__, static_folder="static", template_folder="templates")
app.secret_key = APP_SESSION_SECRET
app.config.update(
    SESSION_COOKIE_NAME="openclaw-skill-studio-session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=APP_SESSION_SECURE,
)


@app.context_processor
def inject_asset_version() -> dict[str, int]:
    return {"asset_version": int(time.time())}


@dataclass
class Operation:
    label: str
    kind: str
    value: list[str] | str
    cwd: Path | None = None
    help_text: str | None = None


@dataclass
class GatewayCredentials:
    url: str
    token: str
    basic_user: str = ""
    basic_pass: str = ""


def unique_paths(paths: list[Path]) -> list[Path]:
    unique: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.expanduser().resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        unique.append(resolved)
    return unique


def direct_skill_dirs(base_dir: Path) -> list[Path]:
    if not base_dir.exists() or not base_dir.is_dir():
        return []
    return [item for item in base_dir.iterdir() if item.is_dir() and (item / "SKILL.md").is_file()]


def resolve_skills_dir() -> tuple[Path, dict[str, Any]]:
    default_skills_dir = (WORKSPACE_ROOT / "skills").expanduser().resolve()
    candidates = unique_paths(
        [
            CONFIGURED_SKILLS_DIR,
            CONFIGURED_SKILLS_DIR / "public",
            default_skills_dir,
            default_skills_dir / "public",
            WORKSPACE_ROOT,
        ]
    )

    discovered: list[dict[str, Any]] = []
    selected = candidates[0]
    first_existing: Path | None = None
    best_skill_count = -1

    for candidate in candidates:
        skill_count = len(direct_skill_dirs(candidate))
        exists = candidate.exists() and candidate.is_dir()
        if exists and first_existing is None:
            first_existing = candidate
        if skill_count > best_skill_count:
            best_skill_count = skill_count
            selected = candidate
        discovered.append(
            {
                "path": candidate.as_posix(),
                "exists": exists,
                "skillCount": skill_count,
            }
        )

    if best_skill_count <= 0 and first_existing is not None:
        selected = first_existing

    return selected, {
        "configuredPath": CONFIGURED_SKILLS_DIR.as_posix(),
        "autoDetected": selected != CONFIGURED_SKILLS_DIR,
        "candidates": discovered,
    }


SKILLS_DIR, SKILLS_DIR_INFO = resolve_skills_dir()


def error_response(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def to_iso(ts: float) -> str:
    return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


def cli_available() -> bool:
    return shutil.which("openclaw") is not None


def app_auth_state() -> dict[str, Any]:
    return {
        "required": APP_AUTH_REQUIRED,
        "authenticated": ((not APP_AUTH_REQUIRED) or bool(session.get("app_authenticated")))
        if has_request_context()
        else (not APP_AUTH_REQUIRED),
    }


def default_gateway_state() -> dict[str, Any]:
    return {
        "url": DEFAULT_GATEWAY_URL,
        "token": "",
        "hasToken": False,
        "basicUser": "",
        "basicPass": "",
        "hasBasicAuth": False,
        "hasServerTokenDefault": bool(DEFAULT_GATEWAY_TOKEN),
        "hasServerBasicAuthDefault": bool(DEFAULT_GATEWAY_BASIC_USER and DEFAULT_GATEWAY_BASIC_PASS),
    }


def bootstrap_payload() -> dict[str, Any]:
    skills_dir_exists = SKILLS_DIR.exists()
    return {
        "appTitle": APP_TITLE,
        "workspaceRoot": WORKSPACE_ROOT.as_posix(),
        "workspaceRootExists": WORKSPACE_ROOT.exists(),
        "skillsDir": SKILLS_DIR.as_posix(),
        "skillsDirConfigured": SKILLS_DIR_INFO["configuredPath"],
        "skillsDirExists": skills_dir_exists,
        "skillsDirAutoDetected": SKILLS_DIR_INFO["autoDetected"],
        "skillsDirCandidates": SKILLS_DIR_INFO["candidates"],
        "appAuth": app_auth_state(),
        "gateway": default_gateway_state(),
        "cliAvailable": cli_available(),
        "docs": DOC_LINKS,
        "notes": DOC_NOTES,
        "templates": [
            {"id": key, "label": data["label"], "description": data["description"]}
            for key, data in TEMPLATE_PRESETS.items()
        ],
        "commands": {
            "apply": OPENCLAW_SKILLS_APPLY_COMMAND,
            "restart": OPENCLAW_GATEWAY_RESTART_COMMAND,
            "validate": OPENCLAW_SKILLS_VALIDATE_COMMAND,
            "test": OPENCLAW_SKILLS_TEST_COMMAND,
        },
        "remoteSync": {
            "mirrorRoot": REMOTE_SKILLS_MIRROR_ROOT.as_posix() if REMOTE_SKILLS_MIRROR_ROOT else "",
            "hasPullCommand": bool(OPENCLAW_REMOTE_SKILLS_PULL_COMMAND),
            "hasPushCommand": bool(OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND),
        },
    }


def ensure_skills_root() -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)


def ensure_studio_root() -> None:
    STUDIO_DATA_ROOT.mkdir(parents=True, exist_ok=True)
    STUDIO_REPO_ROOT.mkdir(parents=True, exist_ok=True)


def sanitize_relative_path(raw_path: str | None) -> str:
    cleaned = (raw_path or "").strip().replace("\\", "/").strip("/")
    cleaned = cleaned.lstrip("./")
    return cleaned


def resolve_within(base_dir: Path, raw_path: str | None) -> Path:
    relative = sanitize_relative_path(raw_path)
    candidate = (base_dir / relative).resolve()
    try:
        candidate.relative_to(base_dir.resolve())
    except ValueError as exc:
        raise ValueError("Path escapes the skills directory.") from exc
    return candidate


def skill_root(skill_slug: str) -> Path:
    if not SKILL_RE.fullmatch(skill_slug):
        raise ValueError("Invalid skill slug.")
    return resolve_within(SKILLS_DIR, skill_slug)


def studio_skill_root(skill_slug: str) -> Path:
    if not SKILL_RE.fullmatch(skill_slug):
        raise ValueError("Invalid skill slug.")
    return resolve_within(STUDIO_REPO_ROOT, skill_slug)


def relative_to_skills(path: Path) -> str:
    return path.resolve().relative_to(SKILLS_DIR.resolve()).as_posix()


def relative_to_studio_skills(path: Path) -> str:
    return path.resolve().relative_to(STUDIO_REPO_ROOT.resolve()).as_posix()


def read_text_file(path: Path) -> str:
    if path.stat().st_size > MAX_TEXT_FILE_BYTES:
        raise ValueError("File is too large to edit in the interface.")
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("Binary or non-UTF-8 file. The interface only edits text.") from exc


def format_python_source(content: str) -> str:
    try:
        return format_file_contents(content, fast=False, mode=FileMode())
    except NothingChanged:
        return content
    except InvalidInput as exc:
        raise ValueError(f"Invalid Python for formatting: {exc}") from exc


def format_shell_source(content: str, filename: str) -> str:
    completed = subprocess.run(
        ["shfmt", "-filename", filename, "-i", "2"],
        input=content,
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout or "shell formatting failed").strip()
        raise ValueError(f"Invalid shell for formatting: {details}")
    return completed.stdout


def format_web_source(content: str) -> str:
    options = jsbeautifier.default_options()
    options.indent_size = 2
    options.end_with_newline = True
    return jsbeautifier.beautify(content, options)


def format_yaml_source(content: str) -> str:
    try:
        payload = yaml.safe_load(content)
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid YAML for formatting: {exc}") from exc
    formatted = yaml.safe_dump(payload, sort_keys=False, allow_unicode=True)
    return formatted if formatted.endswith("\n") else f"{formatted}\n"


def format_json_source(content: str) -> str:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON for formatting: {exc}") from exc
    return f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n"


def format_source_content(path: str, content: str) -> tuple[str, str]:
    suffix = Path(path).suffix.lower()
    if suffix in {".py", ".pyi"}:
        return format_python_source(content), "black"
    if suffix in {".sh", ".bash"}:
        return format_shell_source(content, Path(path).name), "shfmt"
    if suffix == ".json":
        return format_json_source(content), "json"
    if suffix in {".yml", ".yaml"}:
        return format_yaml_source(content), "yaml"
    if suffix in {".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css", ".html", ".htm"}:
        return format_web_source(content), "jsbeautifier"
    raise ValueError("No formatter is configured for this file type.")


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str, str | None]:
    match = FRONTMATTER_RE.match(text)
    if not match:
        return {}, text, None
    raw_frontmatter, body = match.groups()
    try:
        parsed = yaml.safe_load(raw_frontmatter) or {}
    except yaml.YAMLError as exc:
        return {}, body, f"Invalid frontmatter: {exc}"
    if not isinstance(parsed, dict):
        return {}, body, "The frontmatter must be a YAML object."
    return parsed, body, None


def quote_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return '""'
    text = str(value)
    if re.fullmatch(r"[A-Za-z0-9_./:+-]+", text) and text.lower() not in {"true", "false", "null"}:
        return text
    return json.dumps(text, ensure_ascii=False)


def serialize_frontmatter(data: dict[str, Any]) -> str:
    preferred_keys = [
        "name",
        "description",
        "homepage",
        "user-invocable",
        "disable-model-invocation",
        "command-dispatch",
        "command-tool",
        "command-arg-mode",
        "metadata",
    ]
    lines: list[str] = []
    for key in preferred_keys + [key for key in data.keys() if key not in preferred_keys]:
        if key not in data:
            continue
        value = data[key]
        if value in ("", None, [], {}):
            continue
        if key == "metadata" and isinstance(value, (dict, list)):
            rendered = json.dumps(value, ensure_ascii=False, separators=(",", ": "))
        elif isinstance(value, (dict, list)):
            rendered = json.dumps(value, ensure_ascii=False, separators=(",", ": "))
        else:
            rendered = quote_scalar(value)
        lines.append(f"{key}: {rendered}")
    return "\n".join(lines).strip()


def build_skill_markdown(frontmatter: dict[str, Any], body: str) -> str:
    header = serialize_frontmatter(frontmatter)
    cleaned_body = body.strip("\n")
    if header:
        return f"---\n{header}\n---\n\n{cleaned_body}\n"
    return f"{cleaned_body}\n"


def extract_skill_metadata(frontmatter: dict[str, Any]) -> dict[str, Any]:
    metadata = frontmatter.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    openclaw_meta = metadata.get("openclaw") or {}
    if not isinstance(openclaw_meta, dict):
        openclaw_meta = {}
    requires = openclaw_meta.get("requires") or {}
    if not isinstance(requires, dict):
        requires = {}
    return {
        "name": frontmatter.get("name", ""),
        "description": frontmatter.get("description", ""),
        "homepage": frontmatter.get("homepage", ""),
        "userInvocable": frontmatter.get("user-invocable", True),
        "disableModelInvocation": frontmatter.get("disable-model-invocation", False),
        "commandDispatch": frontmatter.get("command-dispatch", ""),
        "commandTool": frontmatter.get("command-tool", ""),
        "commandArgMode": frontmatter.get("command-arg-mode", ""),
        "emoji": openclaw_meta.get("emoji", ""),
        "skillKey": openclaw_meta.get("skillKey", ""),
        "primaryEnv": openclaw_meta.get("primaryEnv", ""),
        "os": ", ".join(openclaw_meta.get("os", []) or []),
        "requiresBins": ", ".join(requires.get("bins", []) or []),
        "requiresAnyBins": ", ".join(requires.get("anyBins", []) or []),
        "requiresEnv": ", ".join(requires.get("env", []) or []),
        "requiresConfig": ", ".join(requires.get("config", []) or []),
        "installJson": json.dumps(openclaw_meta.get("install", []), ensure_ascii=False, indent=2)
        if openclaw_meta.get("install")
        else "",
    }


def normalize_csv_field(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def metadata_from_form(payload: dict[str, Any]) -> dict[str, Any]:
    frontmatter: dict[str, Any] = {
        "name": (payload.get("name") or "").strip(),
        "description": (payload.get("description") or "").strip(),
    }
    if payload.get("homepage"):
        frontmatter["homepage"] = payload["homepage"].strip()
    if payload.get("userInvocable") is False:
        frontmatter["user-invocable"] = False
    if payload.get("disableModelInvocation") is True:
        frontmatter["disable-model-invocation"] = True
    if payload.get("commandDispatch"):
        frontmatter["command-dispatch"] = payload["commandDispatch"].strip()
    if payload.get("commandTool"):
        frontmatter["command-tool"] = payload["commandTool"].strip()
    if payload.get("commandArgMode"):
        frontmatter["command-arg-mode"] = payload["commandArgMode"].strip()

    openclaw_meta: dict[str, Any] = {}
    if payload.get("emoji"):
        openclaw_meta["emoji"] = payload["emoji"].strip()
    if payload.get("skillKey"):
        openclaw_meta["skillKey"] = payload["skillKey"].strip()
    if payload.get("primaryEnv"):
        openclaw_meta["primaryEnv"] = payload["primaryEnv"].strip()

    os_values = normalize_csv_field(payload.get("os"))
    if os_values:
        openclaw_meta["os"] = os_values

    requires: dict[str, Any] = {}
    bins = normalize_csv_field(payload.get("requiresBins"))
    any_bins = normalize_csv_field(payload.get("requiresAnyBins"))
    env_items = normalize_csv_field(payload.get("requiresEnv"))
    config_items = normalize_csv_field(payload.get("requiresConfig"))
    if bins:
        requires["bins"] = bins
    if any_bins:
        requires["anyBins"] = any_bins
    if env_items:
        requires["env"] = env_items
    if config_items:
        requires["config"] = config_items
    if requires:
        openclaw_meta["requires"] = requires

    install_json = (payload.get("installJson") or "").strip()
    if install_json:
        parsed_install = json.loads(install_json)
        openclaw_meta["install"] = parsed_install

    if openclaw_meta:
        frontmatter["metadata"] = {"openclaw": openclaw_meta}

    return frontmatter


def studio_db() -> sqlite3.Connection:
    ensure_studio_root()
    connection = sqlite3.connect(STUDIO_DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS studio_skills (
            slug TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            remote_manifest_path TEXT NOT NULL DEFAULT '',
            remote_base_dir TEXT NOT NULL DEFAULT '',
            current_revision_id INTEGER,
            last_synced_revision_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS studio_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_slug TEXT NOT NULL,
            revision_number INTEGER NOT NULL,
            origin TEXT NOT NULL,
            note TEXT NOT NULL,
            changed_path TEXT NOT NULL DEFAULT '',
            archive BLOB NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(skill_slug) REFERENCES studio_skills(slug) ON DELETE CASCADE,
            UNIQUE(skill_slug, revision_number)
        );
        """
    )
    return connection


def utc_now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def create_skill_archive_bytes(root: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if not root.exists():
            return b""
        for item in sorted(root.rglob("*"), key=lambda value: value.as_posix()):
            relative_path = item.relative_to(root).as_posix()
            if item.is_dir():
                if not any(item.iterdir()):
                    archive.writestr(f"{relative_path}/", b"")
                continue
            archive.writestr(relative_path, item.read_bytes())
    return buffer.getvalue()


def extract_archive_bytes(root: Path, archive_bytes: bytes) -> None:
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True, exist_ok=True)
    if not archive_bytes:
        return
    with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as archive:
        for member in archive.infolist():
            member_name = member.filename.rstrip("/")
            if not member_name:
                continue
            destination = resolve_within(root, member_name)
            if member.is_dir() or member.filename.endswith("/"):
                destination.mkdir(parents=True, exist_ok=True)
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(member))


def restore_archive_member(root: Path, archive_bytes: bytes, relative_path: str) -> None:
    target = resolve_within(root, relative_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    restored = False
    with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as archive:
        for member in archive.infolist():
            normalized = member.filename.rstrip("/")
            if normalized != relative_path:
                continue
            if member.is_dir() or member.filename.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.write_bytes(archive.read(member))
            restored = True
            break
    if not restored and target.exists():
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()


def studio_skill_row(connection: sqlite3.Connection, skill_slug: str) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM studio_skills WHERE slug = ?", (skill_slug,)).fetchone()


def studio_revision_row(connection: sqlite3.Connection, revision_id: int) -> sqlite3.Row | None:
    return connection.execute("SELECT * FROM studio_revisions WHERE id = ?", (revision_id,)).fetchone()


def previous_studio_revision_row(
    connection: sqlite3.Connection,
    skill_slug: str,
    revision_number: int,
) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT *
        FROM studio_revisions
        WHERE skill_slug = ? AND revision_number < ?
        ORDER BY revision_number DESC
        LIMIT 1
        """,
        (skill_slug, revision_number),
    ).fetchone()


def next_revision_number(connection: sqlite3.Connection, skill_slug: str) -> int:
    row = connection.execute(
        "SELECT COALESCE(MAX(revision_number), 0) AS last_revision FROM studio_revisions WHERE skill_slug = ?",
        (skill_slug,),
    ).fetchone()
    return int(row["last_revision"]) + 1 if row else 1


def record_studio_revision(
    connection: sqlite3.Connection,
    skill_slug: str,
    origin: str,
    note: str,
    changed_path: str = "",
) -> sqlite3.Row:
    root = studio_skill_root(skill_slug)
    archive_bytes = create_skill_archive_bytes(root)
    created_at = utc_now_iso()
    revision_number = next_revision_number(connection, skill_slug)
    cursor = connection.execute(
        """
        INSERT INTO studio_revisions (skill_slug, revision_number, origin, note, changed_path, archive, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (skill_slug, revision_number, origin, note, changed_path, archive_bytes, created_at),
    )
    revision_id = int(cursor.lastrowid)
    connection.execute(
        "UPDATE studio_skills SET current_revision_id = ?, updated_at = ? WHERE slug = ?",
        (revision_id, created_at, skill_slug),
    )
    row = studio_revision_row(connection, revision_id)
    if row is None:  # pragma: no cover - consistency
        raise ValueError("Failed to record the skill revision.")
    return row


def archive_snapshot_entries(archive_bytes: bytes) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    if not archive_bytes:
        return entries
    with zipfile.ZipFile(io.BytesIO(archive_bytes), "r") as archive:
        for member in archive.infolist():
            normalized = member.filename.rstrip("/")
            if not normalized:
                continue
            path_obj = PurePosixPath(normalized)
            for parent in path_obj.parents:
                parent_text = parent.as_posix()
                if parent_text in ("", "."):
                    continue
                entries.setdefault(
                    parent_text,
                    {"path": parent_text, "name": parent.name, "type": "directory", "size": None, "digest": ""},
                )
            if member.is_dir() or member.filename.endswith("/"):
                entries[normalized] = {
                    "path": normalized,
                    "name": path_obj.name,
                    "type": "directory",
                    "size": None,
                    "digest": "",
                }
                continue
            content = archive.read(member)
            entries[normalized] = {
                "path": normalized,
                "name": path_obj.name,
                "type": "file",
                "size": len(content),
                "digest": hashlib.sha1(content).hexdigest(),
            }
    return entries


def ancestor_paths(path: str) -> list[str]:
    result: list[str] = []
    for parent in PurePosixPath(path).parents:
        parent_text = parent.as_posix()
        if parent_text in ("", "."):
            continue
        result.append(parent_text)
    return result


def revision_file_listing_payload(
    connection: sqlite3.Connection,
    skill_slug: str,
    revision_id: int,
) -> dict[str, Any]:
    revision = studio_revision_row(connection, revision_id)
    if revision is None or revision["skill_slug"] != skill_slug:
        raise ValueError("Revision not found for this skill.")
    previous = previous_studio_revision_row(connection, skill_slug, int(revision["revision_number"]))
    current_entries = archive_snapshot_entries(revision["archive"])
    previous_entries = archive_snapshot_entries(previous["archive"] if previous is not None else b"")
    all_paths = sorted(set(current_entries) | set(previous_entries), key=lambda value: (value.count("/"), value.lower()))
    statuses: dict[str, str] = {}
    changed_dirs: set[str] = set()

    for path in all_paths:
        current_entry = current_entries.get(path)
        previous_entry = previous_entries.get(path)
        if current_entry and not previous_entry:
            status = "added"
        elif previous_entry and not current_entry:
            status = "deleted"
        elif not current_entry or not previous_entry:
            status = "modified"
        elif current_entry["type"] != previous_entry["type"]:
            status = "modified"
        elif current_entry["type"] == "file":
            status = "unchanged" if current_entry["digest"] == previous_entry["digest"] else "modified"
        else:
            status = "unchanged"
        statuses[path] = status
        if status != "unchanged":
            changed_dirs.update(ancestor_paths(path))

    items: list[dict[str, Any]] = []
    summary = {"added": 0, "modified": 0, "deleted": 0, "unchanged": 0, "files": 0}
    for path in all_paths:
        current_entry = current_entries.get(path)
        previous_entry = previous_entries.get(path)
        entry = current_entry or previous_entry
        if entry is None:
            continue
        status = statuses[path]
        if entry["type"] == "directory" and status == "unchanged" and path in changed_dirs:
            status = "modified"
        size = entry["size"] if entry["type"] == "file" else None
        if entry["type"] == "file":
            summary["files"] += 1
            summary[status] += 1
        items.append(
            {
                "path": path,
                "name": entry["name"],
                "type": entry["type"],
                "size": size,
                "status": status,
                "presentInRevision": current_entry is not None,
                "restorable": current_entry is not None and entry["type"] == "file",
            }
        )

    items.sort(key=lambda item: (item["path"].count("/"), item["path"].lower(), 0 if item["type"] == "directory" else 1))
    return {
        "revision": {
            "id": revision["id"],
            "revisionNumber": revision["revision_number"],
            "origin": revision["origin"],
            "note": revision["note"],
            "changedPath": revision["changed_path"],
            "createdAt": revision["created_at"],
            "current": False,
            "synced": False,
        },
        "compareToRevisionNumber": previous["revision_number"] if previous is not None else 0,
        "entries": items,
        "summary": summary,
    }


def copy_tree(source: Path, destination: Path) -> None:
    shutil.rmtree(destination, ignore_errors=True)
    shutil.copytree(source, destination)


def find_remote_skill_by_slug(snapshot: dict[str, Any], skill_slug: str) -> dict[str, Any] | None:
    for skill in snapshot.get("skills") or []:
        if str(skill.get("slug") or "") == skill_slug:
            return skill
    return None


def remote_mirror_skill_root(skill_slug: str) -> Path | None:
    if REMOTE_SKILLS_MIRROR_ROOT is None:
        return None
    return resolve_within(REMOTE_SKILLS_MIRROR_ROOT, skill_slug)


def infer_remote_workspace_skill_paths(workspace_target: Path, payload: dict[str, Any]) -> tuple[str, str]:
    credentials = request_gateway_credentials(payload)
    if not credentials.url:
        raise ValueError("Could not infer the remote target: gateway is not configured.")
    snapshot = fetch_gateway_workspace_skills(
        credentials.url,
        credentials.token,
        credentials.basic_user,
        credentials.basic_pass,
    )
    workspace_dir = str(snapshot.get("workspaceDir") or "").strip()
    if not workspace_dir:
        raise ValueError("The gateway did not report the remote workspace needed to infer the skill target.")
    try:
        relative_path = workspace_target.resolve().relative_to(WORKSPACE_ROOT.resolve()).as_posix()
    except ValueError as exc:
        raise ValueError("Could not map the local skill to a workspace-relative path.") from exc
    remote_base_dir = (PurePosixPath(workspace_dir) / PurePosixPath(relative_path)).as_posix()
    remote_manifest_path = (PurePosixPath(remote_base_dir) / "SKILL.md").as_posix()
    return remote_base_dir, remote_manifest_path


def remote_sync_env(skill_slug: str, studio_root: Path, remote_skill: dict[str, Any] | None = None) -> dict[str, str]:
    remote_base_dir = str((remote_skill or {}).get("remoteBaseDir") or "")
    remote_manifest_path = str((remote_skill or {}).get("remoteFilePath") or (remote_skill or {}).get("manifestPath") or "")
    mirror_root = remote_mirror_skill_root(skill_slug)
    env = os.environ.copy()
    env.update(
        {
            "OPENCLAW_SKILL_SLUG": skill_slug,
            "OPENCLAW_STUDIO_SKILL_ROOT": studio_root.as_posix(),
            "OPENCLAW_WORKSPACE_SKILL_ROOT": skill_root(skill_slug).as_posix(),
            "OPENCLAW_REMOTE_BASE_DIR": remote_base_dir,
            "OPENCLAW_REMOTE_MANIFEST_PATH": remote_manifest_path,
            "OPENCLAW_REMOTE_SKILLS_MIRROR_ROOT": REMOTE_SKILLS_MIRROR_ROOT.as_posix() if REMOTE_SKILLS_MIRROR_ROOT else "",
            "OPENCLAW_REMOTE_MIRROR_SKILL_ROOT": mirror_root.as_posix() if mirror_root else "",
        }
    )
    return env


def run_remote_sync_command(command: str, env: dict[str, str], label: str) -> None:
    completed = subprocess.run(
        command,
        shell=True,
        cwd=WORKSPACE_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    if completed.returncode == 0:
        return
    stderr = (completed.stderr or "").strip()
    stdout = (completed.stdout or "").strip()
    details = stderr or stdout or f"exit code {completed.returncode}"
    raise ValueError(f"{label} failed: {details}")


def import_remote_skill_files(
    skill_slug: str,
    root: Path,
    remote_skill: dict[str, Any] | None = None,
) -> tuple[str, str, str, str]:
    remote_manifest_path = str((remote_skill or {}).get("remoteFilePath") or (remote_skill or {}).get("manifestPath") or "")
    remote_base_dir = str((remote_skill or {}).get("remoteBaseDir") or "")
    mirror_root = remote_mirror_skill_root(skill_slug)

    if mirror_root is not None and (mirror_root / "SKILL.md").is_file():
        copy_tree(mirror_root, root)
        return (
            "remote-mirror",
            f"Importado do espelho remoto em {mirror_root.as_posix()}.",
            remote_manifest_path,
            remote_base_dir,
        )

    if OPENCLAW_REMOTE_SKILLS_PULL_COMMAND:
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True, exist_ok=True)
        try:
            run_remote_sync_command(
                OPENCLAW_REMOTE_SKILLS_PULL_COMMAND,
                remote_sync_env(skill_slug, root, remote_skill),
                "Importacao remota da skill",
            )
        except Exception:
            shutil.rmtree(root, ignore_errors=True)
            raise
        if not (root / "SKILL.md").is_file():
            shutil.rmtree(root, ignore_errors=True)
            raise ValueError(
                "The remote import command finished without materializing `SKILL.md` in the Studio working copy."
            )
        return (
            "remote-command",
            "Imported from the remote source through the server-configured command.",
            remote_manifest_path,
            remote_base_dir,
        )

    raise ValueError(
        "The gateway does not expose the skill file tree over RPC. Configure `OPENCLAW_REMOTE_SKILLS_MIRROR_ROOT` "
        "or `OPENCLAW_REMOTE_SKILLS_PULL_COMMAND` to materialize the real remote skill in Studio."
    )


def sync_remote_skill_files(
    skill_slug: str,
    source_root: Path,
    remote_base_dir: str = "",
    remote_manifest_path: str = "",
) -> str:
    mirror_root = remote_mirror_skill_root(skill_slug)
    if mirror_root is not None and mirror_root.parent.is_dir():
        copy_tree(source_root, mirror_root)
        return f"Working copy synchronized to the remote mirror at {mirror_root.as_posix()}."
    if OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND:
        remote_skill = {"remoteBaseDir": remote_base_dir, "remoteFilePath": remote_manifest_path}
        run_remote_sync_command(
            OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND,
            remote_sync_env(skill_slug, source_root, remote_skill),
            "Remote skill synchronization",
        )
        return "Working copy synchronized to the remote target through the server-configured command."
    raise ValueError(
        "This skill came from a remote workspace, but no push mechanism is configured. "
        "Set `OPENCLAW_REMOTE_SKILLS_MIRROR_ROOT` or `OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND`."
    )


def studio_status_payload(connection: sqlite3.Connection, skill_slug: str) -> dict[str, Any]:
    row = studio_skill_row(connection, skill_slug)
    if row is None:
        raise ValueError("The skill has not been imported into Studio yet.")
    current_revision = (
        studio_revision_row(connection, int(row["current_revision_id"])) if row["current_revision_id"] is not None else None
    )
    synced_revision = (
        studio_revision_row(connection, int(row["last_synced_revision_id"]))
        if row["last_synced_revision_id"] is not None
        else None
    )
    managed_root = studio_skill_root(skill_slug)
    workspace_target = skill_root(skill_slug)
    return {
        "slug": skill_slug,
        "sourceType": row["source_type"],
        "managedRoot": managed_root.as_posix(),
        "workspaceTarget": workspace_target.as_posix(),
        "dirty": row["current_revision_id"] != row["last_synced_revision_id"],
        "currentRevisionId": row["current_revision_id"],
        "currentRevisionNumber": current_revision["revision_number"] if current_revision else 0,
        "lastSyncedRevisionId": row["last_synced_revision_id"],
        "lastSyncedRevisionNumber": synced_revision["revision_number"] if synced_revision else 0,
        "remoteManifestPath": row["remote_manifest_path"],
        "remoteBaseDir": row["remote_base_dir"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "workspaceMounted": SKILLS_DIR.exists(),
    }


def ensure_studio_skill(
    skill_slug: str,
    remote_skill: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_studio_root()
    root = studio_skill_root(skill_slug)
    local_root = skill_root(skill_slug)
    with studio_db() as connection:
        row = studio_skill_row(connection, skill_slug)
        if row and root.exists():
            if row["source_type"] != "remote-metadata":
                return studio_status_payload(connection, skill_slug)
            if local_root.exists():
                copy_tree(local_root, root)
                connection.execute(
                    """
                    UPDATE studio_skills
                    SET source_type = ?, remote_manifest_path = ?, remote_base_dir = ?, updated_at = ?
                    WHERE slug = ?
                    """,
                    ("workspace", "", "", utc_now_iso(), skill_slug),
                )
                record_studio_revision(connection, skill_slug, "reimport", "Working copy reconstruida a partir do workspace local.")
                return studio_status_payload(connection, skill_slug)
            if remote_skill is not None or REMOTE_SKILLS_MIRROR_ROOT is not None or OPENCLAW_REMOTE_SKILLS_PULL_COMMAND:
                source_type, note, remote_manifest_path, remote_base_dir = import_remote_skill_files(
                    skill_slug,
                    root,
                    remote_skill
                    or {
                        "remoteBaseDir": str(row["remote_base_dir"] or ""),
                        "remoteFilePath": str(row["remote_manifest_path"] or ""),
                    },
                )
                connection.execute(
                    """
                    UPDATE studio_skills
                    SET source_type = ?, remote_manifest_path = ?, remote_base_dir = ?, updated_at = ?
                    WHERE slug = ?
                    """,
                    (source_type, remote_manifest_path, remote_base_dir, utc_now_iso(), skill_slug),
                )
                record_studio_revision(connection, skill_slug, "reimport", note)
                return studio_status_payload(connection, skill_slug)
            raise ValueError(
                "This legacy working copy was created only from gateway metadata and does not represent the real skill tree. "
                "Connect to the gateway and configure a remote mirror/command to reimport the skill correctly."
            )

        created_at = utc_now_iso()
        source_type = "workspace"
        note = "Imported from the local workspace."
        remote_manifest_path = ""
        remote_base_dir = ""

        if local_root.exists():
            copy_tree(local_root, root)
        elif remote_skill is not None or REMOTE_SKILLS_MIRROR_ROOT is not None or OPENCLAW_REMOTE_SKILLS_PULL_COMMAND:
            source_type, note, remote_manifest_path, remote_base_dir = import_remote_skill_files(skill_slug, root, remote_skill)
        else:
            raise ValueError("The skill does not exist locally and was not found in the gateway for import.")

        connection.execute(
            """
            INSERT INTO studio_skills (slug, source_type, remote_manifest_path, remote_base_dir, current_revision_id, last_synced_revision_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
            ON CONFLICT(slug) DO UPDATE SET
                source_type = excluded.source_type,
                remote_manifest_path = excluded.remote_manifest_path,
                remote_base_dir = excluded.remote_base_dir,
                updated_at = excluded.updated_at
            """,
            (skill_slug, source_type, remote_manifest_path, remote_base_dir, created_at, created_at),
        )
        record_studio_revision(connection, skill_slug, "import", note)
        return studio_status_payload(connection, skill_slug)


def studio_history_payload(connection: sqlite3.Connection, skill_slug: str, limit: int = 20) -> list[dict[str, Any]]:
    row = studio_skill_row(connection, skill_slug)
    if row is None:
        return []
    rows = connection.execute(
        """
        SELECT id, revision_number, origin, note, changed_path, created_at
        FROM studio_revisions
        WHERE skill_slug = ?
        ORDER BY revision_number DESC
        LIMIT ?
        """,
        (skill_slug, limit),
    ).fetchall()
    return [
        {
            "id": entry["id"],
            "revisionNumber": entry["revision_number"],
            "origin": entry["origin"],
            "note": entry["note"],
            "changedPath": entry["changed_path"],
            "createdAt": entry["created_at"],
            "current": row["current_revision_id"] == entry["id"],
            "synced": row["last_synced_revision_id"] == entry["id"],
        }
        for entry in rows
    ]


def skill_warnings(skill_dir: Path, frontmatter: dict[str, Any], body: str, parse_error: str | None) -> list[str]:
    warnings: list[str] = []
    if parse_error:
        warnings.append(parse_error)
    if not frontmatter:
        warnings.append("SKILL.md sem frontmatter valido.")
    name = frontmatter.get("name", "")
    if not name:
        warnings.append("Campo obrigatorio 'name' ausente.")
    elif not re.fullmatch(r"[a-z0-9_]+", str(name)):
        warnings.append("Campo 'name' deveria usar snake_case.")
    description = frontmatter.get("description", "")
    if not description:
        warnings.append("Campo obrigatorio 'description' ausente.")
    if len(body.strip()) < 40:
        warnings.append("Corpo da skill esta muito curto; pode faltar orientacao para o agente.")
    return warnings


def build_skill_summary(skill_dir: Path) -> dict[str, Any]:
    manifest = skill_dir / "SKILL.md"
    frontmatter: dict[str, Any] = {}
    body = ""
    parse_error: str | None = None
    warnings: list[str] = []
    if manifest.exists():
        try:
            content = read_text_file(manifest)
            frontmatter, body, parse_error = parse_frontmatter(content)
            warnings.extend(skill_warnings(skill_dir, frontmatter, body, parse_error))
        except ValueError as exc:
            warnings.append(str(exc))
    else:
        warnings.append("SKILL.md not found.")

    files = [item for item in skill_dir.rglob("*") if item.is_file()]
    last_mtime = max((item.stat().st_mtime for item in files), default=skill_dir.stat().st_mtime)

    metadata = frontmatter.get("metadata") or {}
    if not isinstance(metadata, dict):
        metadata = {}
    openclaw_meta = metadata.get("openclaw") or {}
    if not isinstance(openclaw_meta, dict):
        openclaw_meta = {}

    return {
        "slug": skill_dir.name,
        "path": relative_to_skills(skill_dir),
        "manifestPath": relative_to_skills(manifest) if manifest.exists() else "",
        "name": frontmatter.get("name", skill_dir.name.replace("-", "_")),
        "description": frontmatter.get("description", ""),
        "homepage": frontmatter.get("homepage") or openclaw_meta.get("homepage", ""),
        "emoji": openclaw_meta.get("emoji", ""),
        "primaryEnv": openclaw_meta.get("primaryEnv", ""),
        "warnings": warnings,
        "hasManifest": manifest.exists(),
        "fileCount": len(files),
        "lastUpdated": to_iso(last_mtime),
    }


def list_skills() -> list[dict[str, Any]]:
    if not SKILLS_DIR.exists():
        return []
    skills = [item for item in SKILLS_DIR.iterdir() if item.is_dir()]
    summaries: list[dict[str, Any]] = []
    for item in skills:
        try:
            summaries.append(build_skill_summary(item))
        except Exception as exc:  # pragma: no cover - fallback defensivo
            summaries.append(
                {
                    "slug": item.name,
                    "path": relative_to_skills(item),
                    "manifestPath": "",
                    "name": item.name.replace("-", "_"),
                    "description": "",
                    "homepage": "",
                    "emoji": "",
                    "primaryEnv": "",
                    "warnings": [f"Failed to read the skill: {exc}"],
                    "hasManifest": False,
                    "fileCount": 0,
                    "lastUpdated": to_iso(item.stat().st_mtime),
                }
            )
    return sorted(summaries, key=lambda item: item["slug"].lower())


def build_tree(root: Path, relative_path_builder=relative_to_skills) -> dict[str, Any]:
    root = root.resolve()

    def node(path: Path) -> dict[str, Any]:
        metadata = path_metadata(path)
        payload = {
            "name": path.name,
            "path": relative_path_builder(path),
            "type": "directory" if path.is_dir() else "file",
            **metadata,
        }
        if path.is_dir():
            children = sorted(path.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))
            payload["children"] = [node(child) for child in children]
        return payload

    return node(root)


def owner_name(uid: int) -> str:
    if pwd is None:
        return str(uid)
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return str(uid)


def path_metadata(path: Path) -> dict[str, Any]:
    stats = path.stat()
    return {
        "size": stats.st_size if path.is_file() else 0,
        "createdAt": to_iso(stats.st_ctime),
        "updatedAt": to_iso(stats.st_mtime),
        "permissions": statlib.filemode(stats.st_mode),
        "owner": owner_name(stats.st_uid),
    }


def generate_skill_files(payload: dict[str, Any]) -> dict[str, str]:
    template_id = payload.get("template", "blank")
    template = TEMPLATE_PRESETS.get(template_id, TEMPLATE_PRESETS["blank"])
    skill_name = payload["name"]
    description = payload["description"]
    title = payload.get("title") or skill_name.replace("_", " ").replace("-", " ").title()
    capability = payload.get("capability") or description or "uma tarefa especializada"

    frontmatter = metadata_from_form(
        {
            **payload,
            "name": skill_name,
            "description": description,
        }
    )

    body = template["body"].format(
        title=title,
        capability=capability,
        baseDir=payload["slug"],
    )
    files = {"SKILL.md": build_skill_markdown(frontmatter, body)}
    for extra_path, extra_content in template["files"].items():
        files[extra_path] = extra_content
    return files


def run_command(operation: Operation) -> dict[str, Any]:
    timeout_seconds = 90
    try:
        if operation.kind == "argv":
            result = subprocess.run(
                operation.value,  # type: ignore[arg-type]
                capture_output=True,
                text=True,
                cwd=(operation.cwd or WORKSPACE_ROOT),
                timeout=timeout_seconds,
                check=False,
            )
            rendered_command = " ".join(operation.value)  # type: ignore[arg-type]
        else:
            result = subprocess.run(
                operation.value,  # type: ignore[arg-type]
                shell=True,
                executable="/bin/bash",
                capture_output=True,
                text=True,
                cwd=(operation.cwd or WORKSPACE_ROOT),
                timeout=timeout_seconds,
                check=False,
            )
            rendered_command = operation.value  # type: ignore[assignment]
    except FileNotFoundError as exc:
        raise ValueError(str(exc)) from exc
    except subprocess.TimeoutExpired as exc:
        raise ValueError(f"Comando excedeu {timeout_seconds}s: {exc.cmd}") from exc

    stdout = result.stdout.strip()
    stderr = result.stderr.strip()
    parsed_json = None
    if stdout:
        try:
            parsed_json = json.loads(stdout)
        except json.JSONDecodeError:
            parsed_json = None

    return {
        "label": operation.label,
        "command": rendered_command,
        "exitCode": result.returncode,
        "stdout": stdout,
        "stderr": stderr,
        "json": parsed_json,
        "helpText": operation.help_text,
    }


def encode_base64_urlsafe(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def normalize_gateway_url(raw_url: str) -> str:
    gateway_url = (raw_url or "").strip()
    if not gateway_url:
        raise ValueError("Provide a gateway URL or use offline mode.")

    parsed = urlparse(gateway_url)
    if parsed.scheme not in {"ws", "wss", "http", "https"}:
        raise ValueError("Invalid gateway URL. Use ws://, wss://, http://, or https://.")
    if not parsed.hostname:
        raise ValueError("Invalid gateway URL. Missing host.")

    scheme = {"http": "ws", "https": "wss"}.get(parsed.scheme, parsed.scheme)
    normalized = parsed._replace(scheme=scheme, path=parsed.path or "/", fragment="")
    return urlunparse(normalized)


def gateway_connection_info(gateway_url: str) -> dict[str, Any]:
    parsed = urlparse(gateway_url)
    default_ports = {
        "ws": 80,
        "wss": 443,
    }
    port = parsed.port or default_ports[parsed.scheme]
    try:
        address = socket.gethostbyname(parsed.hostname or "")
    except OSError as exc:
        raise ValueError(f"Failed to resolve DNS for {parsed.hostname}: {exc}") from exc
    return {
        "url": gateway_url,
        "host": parsed.hostname,
        "ip": address,
        "port": port,
        "scheme": parsed.scheme,
    }


def gateway_state_defaults() -> dict[str, Any]:
    return {
        "identity": None,
        "deviceTokens": {},
    }


def path_can_be_created(target: Path) -> bool:
    probe = target.parent
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return probe.exists() and os.access(probe, os.W_OK)


def gateway_state_file_path() -> Path:
    if path_can_be_created(CONFIGURED_GATEWAY_DEVICE_STATE_FILE):
        return CONFIGURED_GATEWAY_DEVICE_STATE_FILE
    workspace_candidate = WORKSPACE_ROOT / ".openclaw-skill-studio" / "gateway-device.json"
    if path_can_be_created(workspace_candidate):
        return workspace_candidate
    return PROJECT_ROOT / ".openclaw-skill-studio" / "gateway-device.json"


def load_gateway_state() -> dict[str, Any]:
    state_file = gateway_state_file_path()
    if not state_file.exists():
        return gateway_state_defaults()
    try:
        data = json.loads(state_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return gateway_state_defaults()
    if not isinstance(data, dict):
        return gateway_state_defaults()
    state = gateway_state_defaults()
    state.update(data)
    return state


def save_gateway_state(state: dict[str, Any]) -> None:
    state_file = gateway_state_file_path()
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def load_or_create_gateway_identity(state: dict[str, Any]) -> dict[str, str]:
    identity = state.get("identity")
    if isinstance(identity, dict):
        private_key_raw = identity.get("privateKey")
        public_key_raw = identity.get("publicKey")
        device_id = identity.get("deviceId")
        if private_key_raw and public_key_raw and device_id:
            return {
                "privateKey": str(private_key_raw),
                "publicKey": str(public_key_raw),
                "deviceId": str(device_id),
            }

    private_key = Ed25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    public_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    identity = {
        "privateKey": base64.b64encode(private_bytes).decode("ascii"),
        "publicKey": encode_base64_urlsafe(public_bytes),
        "deviceId": hashlib.sha256(public_bytes).hexdigest(),
    }
    state["identity"] = identity
    save_gateway_state(state)
    return identity


def gateway_private_key(identity: dict[str, str]) -> Ed25519PrivateKey:
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(identity["privateKey"]))


def build_gateway_connect_params(
    gateway_token: str,
    nonce: str,
    device_token: str = "",
) -> tuple[dict[str, Any], dict[str, str]]:
    state = load_gateway_state()
    identity = load_or_create_gateway_identity(state)
    private_key = gateway_private_key(identity)
    signed_at = int(time.time() * 1000)
    version = "v2" if nonce else "v1"
    sign_parts = [
        version,
        identity["deviceId"],
        OPENCLAW_GATEWAY_CLIENT_ID,
        OPENCLAW_GATEWAY_CLIENT_MODE,
        OPENCLAW_GATEWAY_ROLE,
        ",".join(OPENCLAW_GATEWAY_SCOPES),
        str(signed_at),
        gateway_token or "",
    ]
    if version == "v2":
        sign_parts.append(nonce)
    payload_to_sign = "|".join(sign_parts)
    signature = encode_base64_urlsafe(private_key.sign(payload_to_sign.encode("utf-8")))

    auth_payload: dict[str, Any] = {}
    if gateway_token:
        auth_payload["token"] = gateway_token
    if device_token:
        auth_payload["deviceToken"] = device_token

    params = {
        "minProtocol": OPENCLAW_GATEWAY_PROTOCOL,
        "maxProtocol": OPENCLAW_GATEWAY_PROTOCOL,
        "client": {
            "id": OPENCLAW_GATEWAY_CLIENT_ID,
            "version": "skill-studio",
            "platform": "linux",
            "mode": OPENCLAW_GATEWAY_CLIENT_MODE,
        },
        "role": OPENCLAW_GATEWAY_ROLE,
        "scopes": OPENCLAW_GATEWAY_SCOPES,
        "device": {
            "id": identity["deviceId"],
            "publicKey": identity["publicKey"],
            "signature": signature,
            "signedAt": signed_at,
            "nonce": nonce,
        },
        "caps": [],
        "auth": auth_payload,
        "locale": "pt-BR",
        "userAgent": OPENCLAW_GATEWAY_USER_AGENT,
    }
    return params, identity


def maybe_store_device_token(payload: dict[str, Any]) -> None:
    auth = payload.get("auth") or {}
    if not isinstance(auth, dict):
        return
    device_token = auth.get("deviceToken")
    if not device_token:
        return
    state = load_gateway_state()
    device_tokens = state.get("deviceTokens")
    if not isinstance(device_tokens, dict):
        device_tokens = {}
    device_tokens[OPENCLAW_GATEWAY_ROLE] = str(device_token)
    state["deviceTokens"] = device_tokens
    save_gateway_state(state)


def format_gateway_error(exc: Exception, info: dict[str, Any]) -> ValueError:
    if isinstance(exc, WebSocketBadStatusException):
        status_code = getattr(exc, "status_code", None)
        headers = getattr(exc, "resp_headers", None) or {}
        if status_code == 401 and "basic" in str(headers.get("www-authenticate", "")).lower():
            return ValueError(
                f"Gateway protected by HTTP Basic at {info['host']}:{info['port']}. "
                "The edge requires HTTP credentials before the gateway token."
            )
        reason = str(exc).strip() or "WebSocket handshake failed"
        return ValueError(f"The gateway returned an error during the WebSocket handshake at {info['host']}:{info['port']}: {reason}")
    if isinstance(exc, WebSocketTimeoutException):
        return ValueError(f"The gateway did not respond at {info['host']}:{info['port']} within the configured timeout.")
    if isinstance(exc, WebSocketConnectionClosedException):
        return ValueError(f"WebSocket connection closed unexpectedly by {info['host']}:{info['port']}.")
    if isinstance(exc, OSError):
        return ValueError(f"Gateway unreachable at {info['host']}:{info['port']}: {exc}")
    if isinstance(exc, ValueError):
        return exc
    return ValueError(f"Failed to talk to the gateway at {info['host']}:{info['port']}: {exc}")


class GatewayRpcClient:
    def __init__(self, credentials: GatewayCredentials):
        self.credentials = credentials
        self.info = gateway_connection_info(credentials.url)
        self.ws: Any | None = None
        self.request_id = 0
        self.hello_payload: dict[str, Any] | None = None

    def __enter__(self) -> "GatewayRpcClient":
        self.connect()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def connect(self) -> None:
        if self.ws is not None:
            return
        headers: list[str] = []
        if self.credentials.basic_user and self.credentials.basic_pass:
            basic_token = base64.b64encode(
                f"{self.credentials.basic_user}:{self.credentials.basic_pass}".encode("utf-8")
            ).decode("ascii")
            headers.append(f"Authorization: Basic {basic_token}")

        ssl_options = {"cert_reqs": ssl.CERT_REQUIRED} if self.info["scheme"] == "wss" else {}

        try:
            self.ws = create_connection(self.credentials.url, timeout=8, header=headers, sslopt=ssl_options)
            first_message = self.recv_json()
            if first_message.get("type") != "event" or first_message.get("event") != "connect.challenge":
                raise ValueError("The gateway did not send the expected connect.challenge event.")
            challenge_payload = first_message.get("payload") or {}
            if not isinstance(challenge_payload, dict):
                raise ValueError("The gateway returned an invalid challenge.")
            self.authenticate(challenge_payload)
        except Exception as exc:  # pragma: no cover - protege chamadas externas
            self.close()
            raise format_gateway_error(exc, self.info) from exc

    def close(self) -> None:
        if self.ws is None:
            return
        try:
            self.ws.close()
        finally:
            self.ws = None

    def recv_json(self) -> dict[str, Any]:
        if self.ws is None:
            raise ValueError("The gateway connection has not been opened yet.")
        raw_message = self.ws.recv()
        if isinstance(raw_message, bytes):
            raw_message = raw_message.decode("utf-8", "ignore")
        message = json.loads(raw_message)
        if not isinstance(message, dict):
            raise ValueError("The gateway returned an invalid JSON payload.")
        return message

    def authenticate(self, challenge_payload: dict[str, Any]) -> None:
        nonce = str(challenge_payload.get("nonce") or "")
        state = load_gateway_state()
        stored_tokens = state.get("deviceTokens")
        if not isinstance(stored_tokens, dict):
            stored_tokens = {}
        stored_device_token = str(stored_tokens.get(OPENCLAW_GATEWAY_ROLE) or "")
        params, identity = build_gateway_connect_params(self.credentials.token, nonce, stored_device_token)
        params["client"]["platform"] = "linux"
        params["client"]["version"] = "dev"

        hello_payload = self.call("connect", params)
        maybe_store_device_token(hello_payload)
        self.hello_payload = hello_payload

        snapshot = hello_payload.get("snapshot") or {}
        if isinstance(snapshot, dict):
            presence = snapshot.get("presence") or []
            if isinstance(presence, list):
                state["lastPresence"] = presence
        state["lastIdentity"] = identity["deviceId"]
        save_gateway_state(state)

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self.ws is None:
            raise ValueError("The gateway connection has not been opened yet.")
        self.request_id += 1
        request_id = str(self.request_id)
        self.ws.send(
            json.dumps(
                {
                    "id": request_id,
                    "type": "req",
                    "method": method,
                    "params": params,
                }
            )
        )
        while True:
            message = self.recv_json()
            if message.get("type") != "res" or message.get("id") != request_id:
                continue
            if not message.get("ok"):
                error_payload = message.get("error") or message.get("payload") or message
                raise ValueError(f"The gateway rejected {method}: {error_payload}")
            payload = message.get("payload") or {}
            if not isinstance(payload, dict):
                raise ValueError(f"The gateway returned an invalid payload in {method}.")
            return payload


def remote_skill_warnings(skill: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if skill.get("disabled"):
        warnings.append("Remote skill disabled on the gateway.")
    if skill.get("blockedByAllowlist"):
        warnings.append("Remote skill blocked by the gateway allowlist.")
    if skill.get("eligible") is False:
        warnings.append("The gateway marked this skill as ineligible on the remote host.")
    missing = skill.get("missing") or {}
    if isinstance(missing, dict):
        label_map = {
            "bins": "bins",
            "anyBins": "anyBins",
            "env": "env",
            "config": "config",
            "os": "os",
        }
        for key, label in label_map.items():
            values = missing.get(key) or []
            if values:
                warnings.append(f"Missing {label}: {', '.join(str(value) for value in values)}")
    return warnings


def remote_skill_metadata(skill: dict[str, Any]) -> dict[str, Any]:
    requirements = skill.get("requirements") or {}
    if not isinstance(requirements, dict):
        requirements = {}
    return {
        "name": skill.get("skillKey") or skill.get("name") or "",
        "description": skill.get("description") or "",
        "homepage": skill.get("homepage") or "",
        "userInvocable": True,
        "disableModelInvocation": False,
        "commandDispatch": "",
        "commandTool": "",
        "commandArgMode": "",
        "emoji": skill.get("emoji") or "",
        "skillKey": skill.get("skillKey") or "",
        "primaryEnv": skill.get("primaryEnv") or "",
        "os": ", ".join(requirements.get("os") or []),
        "requiresBins": ", ".join(requirements.get("bins") or []),
        "requiresAnyBins": ", ".join(requirements.get("anyBins") or []),
        "requiresEnv": ", ".join(requirements.get("env") or []),
        "requiresConfig": ", ".join(requirements.get("config") or []),
        "installJson": json.dumps(skill.get("install") or [], ensure_ascii=False, indent=2)
        if skill.get("install")
        else "",
    }


def normalize_remote_skill(skill: dict[str, Any]) -> dict[str, Any]:
    base_dir = str(skill.get("baseDir") or "")
    slug = Path(base_dir).name if base_dir else str(skill.get("name") or "")
    manifest_path = str(skill.get("filePath") or "")
    return {
        "slug": slug,
        "path": slug,
        "manifestPath": manifest_path,
        "name": str(skill.get("name") or slug.replace("-", "_")),
        "description": str(skill.get("description") or ""),
        "homepage": str(skill.get("homepage") or ""),
        "emoji": str(skill.get("emoji") or ""),
        "primaryEnv": str(skill.get("primaryEnv") or ""),
        "warnings": remote_skill_warnings(skill),
        "hasManifest": bool(manifest_path),
        "fileCount": 0,
        "lastUpdated": "remote gateway",
        "remote": True,
        "source": str(skill.get("source") or ""),
        "eligible": bool(skill.get("eligible")),
        "disabled": bool(skill.get("disabled")),
        "blockedByAllowlist": bool(skill.get("blockedByAllowlist")),
        "bundled": bool(skill.get("bundled")),
        "remoteBaseDir": base_dir,
        "remoteFilePath": manifest_path,
        "metadataFields": remote_skill_metadata(skill),
        "requirements": skill.get("requirements") or {},
        "missing": skill.get("missing") or {},
    }


def fetch_gateway_workspace_skills(
    raw_url: str,
    gateway_token: str = "",
    basic_user: str = "",
    basic_pass: str = "",
) -> dict[str, Any]:
    normalized_url = normalize_gateway_url(raw_url)
    credentials = GatewayCredentials(
        url=normalized_url,
        token=(gateway_token or "").strip(),
        basic_user=(basic_user or "").strip(),
        basic_pass=(basic_pass or "").strip(),
    )
    with GatewayRpcClient(credentials) as client:
        status_payload = client.call("skills.status", {})

    raw_skills = status_payload.get("skills") or []
    if not isinstance(raw_skills, list):
        raise ValueError("The gateway returned an invalid format for skills.status.")
    workspace_skills = [
        normalize_remote_skill(skill)
        for skill in raw_skills
        if isinstance(skill, dict) and skill.get("source") == REMOTE_WORKSPACE_SOURCE
    ]
    return {
        **client.info,
        "reachable": True,
        "authenticated": True,
        "workspaceDir": status_payload.get("workspaceDir") or "",
        "managedSkillsDir": status_payload.get("managedSkillsDir") or "",
        "workspaceSkillCount": len(workspace_skills),
        "allSkillCount": len(raw_skills),
        "skills": sorted(workspace_skills, key=lambda item: item["slug"].lower()),
        "server": client.hello_payload.get("server") if isinstance(client.hello_payload, dict) else {},
    }


def probe_gateway_url(
    raw_url: str,
    gateway_token: str = "",
    basic_user: str = "",
    basic_pass: str = "",
) -> dict[str, Any]:
    snapshot = fetch_gateway_workspace_skills(raw_url, gateway_token, basic_user, basic_pass)
    return {
        "url": snapshot["url"],
        "host": snapshot["host"],
        "ip": snapshot["ip"],
        "port": snapshot["port"],
        "scheme": snapshot["scheme"],
        "reachable": snapshot["reachable"],
        "authenticated": snapshot["authenticated"],
        "workspaceDir": snapshot["workspaceDir"],
        "workspaceSkillCount": snapshot["workspaceSkillCount"],
        "allSkillCount": snapshot["allSkillCount"],
        "server": snapshot["server"],
    }


def build_operation(action: str, payload: dict[str, Any]) -> Operation:
    gateway_url = (payload.get("gatewayUrl") or DEFAULT_GATEWAY_URL or "").strip()
    gateway_token = (payload.get("gatewayToken") or DEFAULT_GATEWAY_TOKEN or "").strip()
    selected_skill = (payload.get("skill") or "").strip()

    if action == "skills_list":
        if not cli_available():
            raise ValueError("The 'openclaw' CLI is not available in this host PATH.")
        return Operation(
            label="Listar skills locais",
            kind="argv",
            value=["openclaw", "skills", "list", "--json"],
            cwd=WORKSPACE_ROOT,
            help_text="Usa o CLI local para listar as skills vistas no workspace atual.",
        )

    if action == "skills_check":
        if OPENCLAW_SKILLS_VALIDATE_COMMAND:
            return Operation(
                label="Validar skills",
                kind="shell",
                value=OPENCLAW_SKILLS_VALIDATE_COMMAND,
                cwd=WORKSPACE_ROOT,
                help_text="Executa o comando customizado definido em OPENCLAW_SKILLS_VALIDATE_COMMAND.",
            )
        if not cli_available():
            raise ValueError("The 'openclaw' CLI is not available in this host PATH.")
        return Operation(
            label="Validar skills",
            kind="argv",
            value=["openclaw", "skills", "check", "--json"],
            cwd=WORKSPACE_ROOT,
            help_text="Validacao local via CLI. Use um comando customizado se seu fluxo exigir outra verificacao.",
        )

    if action == "gateway_skills_status":
        if not cli_available():
            raise ValueError("The 'openclaw' CLI is not available in this host PATH.")
        argv = ["openclaw", "gateway", "call", "skills.status", "--params", "{}", "--json"]
        if gateway_url:
            argv.extend(["--url", gateway_url])
        if gateway_token:
            argv.extend(["--token", gateway_token])
        return Operation(
            label="Consultar skills.status no gateway",
            kind="argv",
            value=argv,
            cwd=WORKSPACE_ROOT,
            help_text="A documentacao do app macOS indica que o gateway expõe skills.status para elegibilidade e requisitos.",
        )

    if action == "apply_skill":
        if OPENCLAW_SKILLS_APPLY_COMMAND:
            return Operation(
                label="Aplicar mudancas da skill",
                kind="shell",
                value=OPENCLAW_SKILLS_APPLY_COMMAND,
                cwd=WORKSPACE_ROOT,
                help_text="Executa o comando definido em OPENCLAW_SKILLS_APPLY_COMMAND.",
            )
        raise ValueError(
            "Nenhum OPENCLAW_SKILLS_APPLY_COMMAND definido. Pela documentacao, use /new para nova sessao ou configure um comando de apply/reload."
        )

    if action == "restart_gateway_local":
        if OPENCLAW_GATEWAY_RESTART_COMMAND:
            return Operation(
                label="Reiniciar gateway",
                kind="shell",
                value=OPENCLAW_GATEWAY_RESTART_COMMAND,
                cwd=WORKSPACE_ROOT,
                help_text="Executa o comando definido em OPENCLAW_GATEWAY_RESTART_COMMAND.",
            )
        if not cli_available():
            raise ValueError("The 'openclaw' CLI is not available in this host PATH.")
        return Operation(
            label="Reiniciar gateway local",
            kind="argv",
            value=["openclaw", "gateway", "restart"],
            cwd=WORKSPACE_ROOT,
            help_text="Reinicio local. Para gateway remoto, configure OPENCLAW_GATEWAY_RESTART_COMMAND com o seu fluxo (ssh, systemctl, etc.).",
        )

    if action == "test_skill":
        if OPENCLAW_SKILLS_TEST_COMMAND:
            return Operation(
                label="Testar skill",
                kind="shell",
                value=OPENCLAW_SKILLS_TEST_COMMAND,
                cwd=WORKSPACE_ROOT,
                help_text="Executa o comando definido em OPENCLAW_SKILLS_TEST_COMMAND.",
            )
        if not cli_available():
            raise ValueError("The 'openclaw' CLI is not available in this host PATH.")
        message = payload.get("message") or f"use the {selected_skill or 'custom'} skill"
        return Operation(
            label="Testar skill",
            kind="argv",
            value=["openclaw", "agent", "--message", message],
            cwd=WORKSPACE_ROOT,
            help_text="Teste local via CLI; ajuste a mensagem no painel de operacoes se quiser um prompt especifico.",
        )

    raise ValueError("Unknown operation.")


def request_gateway_credentials(payload: dict[str, Any]) -> GatewayCredentials:
    return GatewayCredentials(
        url=str(payload.get("gatewayUrl") or DEFAULT_GATEWAY_URL or "").strip(),
        token=str(payload.get("gatewayToken") or DEFAULT_GATEWAY_TOKEN or "").strip(),
        basic_user=str(payload.get("basicUser") or DEFAULT_GATEWAY_BASIC_USER or "").strip(),
        basic_pass=str(payload.get("basicPass") or DEFAULT_GATEWAY_BASIC_PASS or "").strip(),
    )


def app_auth_error_response():
    return jsonify({"ok": False, "error": "App authentication is required."}), 401


@app.before_request
def require_app_auth():
    if not APP_AUTH_REQUIRED:
        return None
    if request.endpoint in {"static", "index", "api_bootstrap", "api_health", "api_app_auth_login"}:
        return None
    if session.get("app_authenticated"):
        return None
    if request.path.startswith("/api/"):
        return app_auth_error_response()
    return None


@app.get("/")
def index():
    return render_template("index.html", bootstrap_json=json.dumps(bootstrap_payload(), ensure_ascii=False))


@app.get("/docs")
def docs_page():
    return render_template("docs.html", docs=DOC_LINKS, notes=DOC_NOTES)


@app.get("/skills/<skill_slug>")
def skill_page(skill_slug: str):
    return render_template(
        "skill_detail.html",
        bootstrap_json=json.dumps(bootstrap_payload(), ensure_ascii=False),
        skill_page_json=json.dumps({"slug": skill_slug}, ensure_ascii=False),
        skill_slug=skill_slug,
    )


@app.get("/skills/<skill_slug>/history")
def skill_history_page(skill_slug: str):
    return render_template(
        "skill_history.html",
        bootstrap_json=json.dumps(bootstrap_payload(), ensure_ascii=False),
        history_page_json=json.dumps({"slug": skill_slug}, ensure_ascii=False),
        skill_slug=skill_slug,
    )


@app.get("/api/bootstrap")
def api_bootstrap():
    return jsonify({"ok": True, "data": bootstrap_payload()})


@app.post("/api/app-auth/login")
def api_app_auth_login():
    if not APP_AUTH_REQUIRED:
        session["app_authenticated"] = True
        return jsonify({"ok": True, "data": app_auth_state()})

    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        return error_response("Provide the app username and password.")
    if not secrets.compare_digest(username, APP_LOGIN_USER) or not secrets.compare_digest(password, APP_LOGIN_PASS):
        return error_response("Invalid app username or password.", 401)

    session.clear()
    session["app_authenticated"] = True
    session["app_user"] = username
    return jsonify({"ok": True, "data": app_auth_state()})


@app.post("/api/app-auth/logout")
def api_app_auth_logout():
    session.clear()
    return jsonify({"ok": True, "data": app_auth_state()})


@app.get("/api/skills")
def api_skills():
    ensure_skills_root()
    return jsonify({"ok": True, "data": list_skills()})


@app.post("/api/skills")
def api_create_skill():
    ensure_skills_root()
    payload = request.get_json(silent=True) or {}
    slug = (payload.get("slug") or "").strip()
    name = (payload.get("name") or "").strip()
    description = (payload.get("description") or "").strip()

    if not slug:
        return error_response("Provide the skill folder slug.")
    if not SKILL_RE.fullmatch(slug):
        return error_response("Invalid slug. Use lowercase letters, numbers, '_' or '-'.")
    if not name:
        return error_response("Provide the internal skill name (snake_case).")
    if not re.fullmatch(r"[a-z0-9_]+", name):
        return error_response("The internal name must use snake_case.")
    if not description:
        return error_response("Provide a short description.")

    target = skill_root(slug)
    if target.exists():
        return error_response("A skill with this slug already exists.")

    target.mkdir(parents=True, exist_ok=False)
    try:
        generated_files = generate_skill_files({**payload, "slug": slug})
    except json.JSONDecodeError as exc:
        shutil.rmtree(target, ignore_errors=True)
        return error_response(f"Invalid installer JSON: {exc}")

    for relative_path, content in generated_files.items():
        destination = resolve_within(target, relative_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content, encoding="utf-8")

    return jsonify({"ok": True, "data": build_skill_summary(target)})


@app.get("/api/skills/<skill_slug>/tree")
def api_skill_tree(skill_slug: str):
    try:
        root = skill_root(skill_slug)
    except ValueError as exc:
        return error_response(str(exc))
    if not root.exists():
        return error_response("Skill not found.", 404)
    return jsonify({"ok": True, "data": build_tree(root)})


@app.get("/api/skills/<skill_slug>/metadata")
def api_skill_metadata(skill_slug: str):
    try:
        root = skill_root(skill_slug)
    except ValueError as exc:
        return error_response(str(exc))
    manifest = root / "SKILL.md"
    if not manifest.exists():
        return error_response("SKILL.md not found.", 404)
    content = read_text_file(manifest)
    frontmatter, body, parse_error = parse_frontmatter(content)
    warnings = skill_warnings(root, frontmatter, body, parse_error)
    return jsonify(
        {
            "ok": True,
            "data": {
                "path": relative_to_skills(manifest),
                "body": body,
                "fields": extract_skill_metadata(frontmatter),
                "warnings": warnings,
            },
        }
    )


@app.put("/api/skills/<skill_slug>/metadata")
def api_update_skill_metadata(skill_slug: str):
    try:
        root = skill_root(skill_slug)
    except ValueError as exc:
        return error_response(str(exc))
    manifest = root / "SKILL.md"
    if not manifest.exists():
        return error_response("SKILL.md not found.", 404)
    payload = request.get_json(silent=True) or {}
    try:
        frontmatter = metadata_from_form(payload)
    except json.JSONDecodeError as exc:
        return error_response(f"Invalid installer JSON: {exc}")

    if not frontmatter.get("name"):
        return error_response("Field 'name' is required.")
    if not re.fullmatch(r"[a-z0-9_]+", str(frontmatter["name"])):
        return error_response("Field 'name' must use snake_case.")
    if not frontmatter.get("description"):
        return error_response("Field 'description' is required.")

    current_content = read_text_file(manifest)
    _, body, _ = parse_frontmatter(current_content)
    manifest.write_text(build_skill_markdown(frontmatter, body), encoding="utf-8")
    return jsonify({"ok": True, "data": build_skill_summary(root)})


@app.get("/api/file")
def api_read_file():
    relative_path = request.args.get("path")
    if not relative_path:
        return error_response("Provide the file path.")
    try:
        file_path = resolve_within(SKILLS_DIR, relative_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not file_path.exists():
        return error_response("File not found.", 404)
    if file_path.is_dir():
        return error_response("The provided path is a directory.")
    try:
        content = read_text_file(file_path)
    except ValueError as exc:
        return error_response(str(exc))
    return jsonify(
        {
            "ok": True,
            "data": {
                "path": relative_to_skills(file_path),
                "name": file_path.name,
                "content": content,
                **path_metadata(file_path),
            },
        }
    )


@app.put("/api/file")
def api_write_file():
    payload = request.get_json(silent=True) or {}
    relative_path = payload.get("path")
    content = payload.get("content")
    if relative_path is None:
        return error_response("Provide the file path.")
    if content is None:
        return error_response("Provide the content.")
    try:
        file_path = resolve_within(SKILLS_DIR, relative_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not file_path.exists():
        return error_response("File not found.", 404)
    if file_path.is_dir():
        return error_response("Cannot save content into a directory.")
    file_path.write_text(str(content), encoding="utf-8")
    return jsonify({"ok": True, "data": {"path": relative_to_skills(file_path), "updatedAt": to_iso(file_path.stat().st_mtime)}})


@app.post("/api/fs/create")
def api_create_path():
    payload = request.get_json(silent=True) or {}
    base_path = payload.get("basePath")
    name = (payload.get("name") or "").strip().strip("/")
    node_type = payload.get("type")
    content = payload.get("content", "")

    if not name:
        return error_response("Provide the file or folder name.")
    try:
        parent = resolve_within(SKILLS_DIR, base_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not parent.exists():
        return error_response("Base folder not found.", 404)
    if parent.is_file():
        parent = parent.parent

    target = resolve_within(parent, name)
    if target.exists():
        return error_response("An item with this name already exists.")

    if node_type == "folder":
        target.mkdir(parents=True, exist_ok=False)
    elif node_type == "file":
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content), encoding="utf-8")
    else:
        return error_response("Invalid type. Use 'file' or 'folder'.")

    return jsonify({"ok": True, "data": {"path": relative_to_skills(target), "type": node_type}})


@app.post("/api/fs/rename")
def api_rename_path():
    payload = request.get_json(silent=True) or {}
    current_path = payload.get("path")
    new_name = (payload.get("newName") or "").strip().strip("/")
    if not current_path or not new_name:
        return error_response("Provide the current path and the new name.")
    try:
        source = resolve_within(SKILLS_DIR, current_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not source.exists():
        return error_response("Item not found.", 404)

    destination = source.with_name(new_name)
    try:
        destination.relative_to(SKILLS_DIR.resolve())
    except ValueError:
        return error_response("Invalid destination.")
    if destination.exists():
        return error_response("An item with this name already exists.")
    source.rename(destination)
    return jsonify({"ok": True, "data": {"path": relative_to_skills(destination)}})


@app.delete("/api/fs/delete")
def api_delete_path():
    payload = request.get_json(silent=True) or {}
    relative_path = payload.get("path")
    if not relative_path:
        return error_response("Provide the path.")
    try:
        target = resolve_within(SKILLS_DIR, relative_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not target.exists():
        return error_response("Item not found.", 404)
    if target == SKILLS_DIR:
        return error_response("Removing the skills root is not allowed.")

    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return jsonify({"ok": True, "data": {"path": sanitize_relative_path(relative_path)}})


@app.get("/api/search")
def api_search():
    skill_slug = (request.args.get("skill") or "").strip()
    query = (request.args.get("q") or "").strip()
    if not skill_slug:
        return error_response("Provide the skill.")
    if len(query) < 2:
        return error_response("Type at least 2 characters to search.")
    try:
        root = skill_root(skill_slug)
    except ValueError as exc:
        return error_response(str(exc))
    if not root.exists():
        return error_response("Skill not found.", 404)

    results: list[dict[str, Any]] = []
    query_lower = query.lower()
    for file_path in root.rglob("*"):
        if not file_path.is_file():
            continue
        try:
            content = read_text_file(file_path)
        except ValueError:
            continue
        for line_number, line in enumerate(content.splitlines(), start=1):
            if query_lower in line.lower():
                results.append(
                    {
                        "path": relative_to_skills(file_path),
                        "lineNumber": line_number,
                        "excerpt": line.strip() or "(empty line)",
                    }
                )
                if len(results) >= 50:
                    break
        if len(results) >= 50:
            break
    return jsonify({"ok": True, "data": results})


@app.post("/api/studio/skills/<skill_slug>/ensure")
def api_studio_ensure_skill(skill_slug: str):
    payload = request.get_json(silent=True) or {}
    try:
        local_root = skill_root(skill_slug)
    except ValueError as exc:
        return error_response(str(exc))

    remote_skill = None
    if not local_root.exists():
        credentials = request_gateway_credentials(payload)
        if credentials.url:
            try:
                snapshot = fetch_gateway_workspace_skills(
                    credentials.url,
                    credentials.token,
                    credentials.basic_user,
                    credentials.basic_pass,
                )
                remote_skill = find_remote_skill_by_slug(snapshot, skill_slug)
            except ValueError as exc:
                return error_response(str(exc))

    try:
        status = ensure_studio_skill(skill_slug, remote_skill=remote_skill)
        with studio_db() as connection:
            history = studio_history_payload(connection, skill_slug)
    except ValueError as exc:
        return error_response(str(exc), 404)
    return jsonify({"ok": True, "data": {"status": status, "history": history}})


@app.get("/api/studio/skills/<skill_slug>/tree")
def api_studio_skill_tree(skill_slug: str):
    try:
        root = studio_skill_root(skill_slug)
    except ValueError as exc:
        return error_response(str(exc))
    if not root.exists():
        return error_response("The skill has not been imported into Studio yet.", 404)
    return jsonify({"ok": True, "data": build_tree(root, relative_to_studio_skills)})


@app.get("/api/studio/file")
def api_studio_read_file():
    relative_path = request.args.get("path")
    if not relative_path:
        return error_response("Provide the file path.")
    try:
        file_path = resolve_within(STUDIO_REPO_ROOT, relative_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not file_path.exists():
        return error_response("File not found.", 404)
    if file_path.is_dir():
        return error_response("The provided path is a directory.")
    try:
        content = read_text_file(file_path)
    except ValueError as exc:
        return error_response(str(exc))
    return jsonify(
        {
            "ok": True,
            "data": {
                "path": relative_to_studio_skills(file_path),
                "name": file_path.name,
                "content": content,
                **path_metadata(file_path),
            },
        }
    )


@app.put("/api/studio/file")
def api_studio_write_file():
    payload = request.get_json(silent=True) or {}
    relative_path = payload.get("path")
    content = payload.get("content")
    if relative_path is None:
        return error_response("Provide the file path.")
    if content is None:
        return error_response("Provide the content.")
    try:
        file_path = resolve_within(STUDIO_REPO_ROOT, relative_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not file_path.exists():
        return error_response("File not found.", 404)
    if file_path.is_dir():
        return error_response("Cannot save content into a directory.")
    file_path.write_text(str(content), encoding="utf-8")
    skill_slug = Path(sanitize_relative_path(relative_path)).parts[0]
    with studio_db() as connection:
        record_studio_revision(
            connection,
            skill_slug,
            "save",
            f"File saved: {relative_to_studio_skills(file_path)}",
            changed_path=relative_to_studio_skills(file_path),
        )
        status = studio_status_payload(connection, skill_slug)
    return jsonify(
        {
            "ok": True,
            "data": {
                "path": relative_to_studio_skills(file_path),
                **path_metadata(file_path),
                "studioStatus": status,
            },
        }
    )


@app.post("/api/studio/format")
def api_studio_format_file():
    payload = request.get_json(silent=True) or {}
    relative_path = payload.get("path")
    content = payload.get("content")
    if relative_path is None:
        return error_response("Provide the file path.")
    if content is None:
        return error_response("Provide the content to format.")
    try:
        file_path = resolve_within(STUDIO_REPO_ROOT, relative_path)
        formatted, formatter = format_source_content(str(relative_path), str(content))
    except ValueError as exc:
        return error_response(str(exc))
    return jsonify(
        {
            "ok": True,
            "data": {
                "path": relative_to_studio_skills(file_path),
                "content": formatted,
                "formatter": formatter,
            },
        }
    )


@app.post("/api/studio/fs/create")
def api_studio_create_path():
    payload = request.get_json(silent=True) or {}
    base_path = payload.get("basePath")
    name = (payload.get("name") or "").strip().strip("/")
    node_type = payload.get("type")
    content = payload.get("content", "")
    if not name:
        return error_response("Provide the file or folder name.")
    try:
        parent = resolve_within(STUDIO_REPO_ROOT, base_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not parent.exists():
        return error_response("Base folder not found.", 404)
    if parent.is_file():
        parent = parent.parent
    target = resolve_within(parent, name)
    if target.exists():
        return error_response("An item with this name already exists.")
    if node_type == "folder":
        target.mkdir(parents=True, exist_ok=False)
    elif node_type == "file":
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content), encoding="utf-8")
    else:
        return error_response("Invalid type. Use 'file' or 'folder'.")
    skill_slug = Path(relative_to_studio_skills(target)).parts[0]
    with studio_db() as connection:
        record_studio_revision(
            connection,
            skill_slug,
            "create",
            f"Item created: {relative_to_studio_skills(target)}",
            changed_path=relative_to_studio_skills(target),
        )
        status = studio_status_payload(connection, skill_slug)
    return jsonify(
        {
            "ok": True,
            "data": {"path": relative_to_studio_skills(target), "type": node_type, "studioStatus": status},
        }
    )


@app.post("/api/studio/fs/rename")
def api_studio_rename_path():
    payload = request.get_json(silent=True) or {}
    current_path = payload.get("path")
    new_name = (payload.get("newName") or "").strip().strip("/")
    if not current_path or not new_name:
        return error_response("Provide the current path and the new name.")
    try:
        source = resolve_within(STUDIO_REPO_ROOT, current_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not source.exists():
        return error_response("Item not found.", 404)
    destination = source.with_name(new_name)
    try:
        destination.relative_to(STUDIO_REPO_ROOT.resolve())
    except ValueError:
        return error_response("Invalid destination.")
    if destination.exists():
        return error_response("An item with this name already exists.")
    source.rename(destination)
    skill_slug = Path(relative_to_studio_skills(destination)).parts[0]
    with studio_db() as connection:
        record_studio_revision(
            connection,
            skill_slug,
            "rename",
            f"Item renamed to: {relative_to_studio_skills(destination)}",
            changed_path=relative_to_studio_skills(destination),
        )
        status = studio_status_payload(connection, skill_slug)
    return jsonify({"ok": True, "data": {"path": relative_to_studio_skills(destination), "studioStatus": status}})


@app.delete("/api/studio/fs/delete")
def api_studio_delete_path():
    payload = request.get_json(silent=True) or {}
    relative_path = payload.get("path")
    reason = re.sub(r"\s+", " ", str(payload.get("reason") or "")).strip()
    if not relative_path:
        return error_response("Provide the path.")
    try:
        target = resolve_within(STUDIO_REPO_ROOT, relative_path)
    except ValueError as exc:
        return error_response(str(exc))
    if not target.exists():
        return error_response("Item not found.", 404)
    if target == STUDIO_REPO_ROOT:
        return error_response("Removing the Studio root is not allowed.")
    removed_path = relative_to_studio_skills(target)
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    skill_slug = Path(removed_path).parts[0]
    with studio_db() as connection:
        note = f"Item removed from the working copy: {removed_path}"
        if reason:
            note = f"{note} | Reason: {reason}"
        record_studio_revision(
            connection,
            skill_slug,
            "delete",
            note,
            changed_path=removed_path,
        )
        status = studio_status_payload(connection, skill_slug)
    return jsonify({"ok": True, "data": {"path": removed_path, "studioStatus": status}})


@app.post("/api/studio/skills/<skill_slug>/sync")
def api_studio_sync_skill(skill_slug: str):
    payload = request.get_json(silent=True) or {}
    try:
        source_root = studio_skill_root(skill_slug)
        target_root = skill_root(skill_slug)
    except ValueError as exc:
        return error_response(str(exc))
    if not source_root.exists():
        return error_response("The skill has not been imported into Studio yet.", 404)

    with studio_db() as connection:
        row = studio_skill_row(connection, skill_slug)
        if row is None or row["current_revision_id"] is None:
            return error_response("The skill has no active revision in Studio.", 400)
        if row["source_type"] == "workspace":
            sync_target_type = "workspace"
            ensure_skills_root()
            shutil.rmtree(target_root, ignore_errors=True)
            shutil.copytree(source_root, target_root)
            if REMOTE_SKILLS_MIRROR_ROOT is not None or OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND:
                remote_base_dir = ""
                remote_manifest_path = ""
                if OPENCLAW_REMOTE_SKILLS_PUSH_COMMAND:
                    try:
                        remote_base_dir, remote_manifest_path = infer_remote_workspace_skill_paths(target_root, payload)
                    except ValueError as exc:
                        return error_response(str(exc))
                remote_message = sync_remote_skill_files(
                    skill_slug,
                    source_root,
                    remote_base_dir,
                    remote_manifest_path,
                )
                sync_target_type = "workspace+remote"
                message = (
                    "Skill synchronized to the local workspace mounted in this UI and published remotely. "
                    f"{remote_message}"
                )
            else:
                message = (
                    "Skill synchronized to the local workspace mounted in this UI. "
                    "No remote push mechanism is configured on this server."
                )
        else:
            try:
                sync_target_type = str(row["source_type"] or "remote")
                message = sync_remote_skill_files(
                    skill_slug,
                    source_root,
                    str(row["remote_base_dir"] or ""),
                    str(row["remote_manifest_path"] or ""),
                )
            except ValueError as exc:
                return error_response(str(exc))
        connection.execute(
            "UPDATE studio_skills SET last_synced_revision_id = ?, updated_at = ? WHERE slug = ?",
            (row["current_revision_id"], utc_now_iso(), skill_slug),
        )
        status = studio_status_payload(connection, skill_slug)
    return jsonify(
        {
            "ok": True,
            "data": {
                "studioStatus": status,
                "workspaceTarget": target_root.as_posix(),
                "syncTargetType": sync_target_type,
                "message": message,
            },
        }
    )


@app.get("/api/studio/skills/<skill_slug>/history")
def api_studio_skill_history(skill_slug: str):
    with studio_db() as connection:
        history = studio_history_payload(connection, skill_slug)
        if not history:
            return error_response("No history was found for this skill.", 404)
        status = studio_status_payload(connection, skill_slug)
    return jsonify({"ok": True, "data": {"history": history, "status": status}})


@app.get("/api/studio/skills/<skill_slug>/history/<int:revision_id>")
def api_studio_skill_revision_detail(skill_slug: str, revision_id: int):
    with studio_db() as connection:
        payload = revision_file_listing_payload(connection, skill_slug, revision_id)
        status = studio_status_payload(connection, skill_slug)
    payload["revision"]["current"] = status["currentRevisionId"] == revision_id
    payload["revision"]["synced"] = status["lastSyncedRevisionId"] == revision_id
    return jsonify({"ok": True, "data": {**payload, "status": status}})


@app.post("/api/studio/skills/<skill_slug>/restore")
def api_studio_restore_skill(skill_slug: str):
    payload = request.get_json(silent=True) or {}
    revision_id = payload.get("revisionId")
    restore_mode = str(payload.get("mode") or "skill")
    target_path = str(payload.get("path") or "")
    if revision_id in (None, ""):
        return error_response("Provide the revision to restore.")

    try:
        revision_id_int = int(revision_id)
        managed_root = studio_skill_root(skill_slug)
    except (TypeError, ValueError) as exc:
        return error_response(f"Invalid request: {exc}")
    if not managed_root.exists():
        return error_response("The skill has not been imported into Studio yet.", 404)

    with studio_db() as connection:
        revision = studio_revision_row(connection, revision_id_int)
        if revision is None or revision["skill_slug"] != skill_slug:
            return error_response("Revision not found for this skill.", 404)

        if restore_mode == "skill":
            extract_archive_bytes(managed_root, revision["archive"])
            note = f"Skill restored to revision {revision['revision_number']}."
            changed_path = ""
            origin = "restore-skill"
        elif restore_mode == "file":
            cleaned_target = sanitize_relative_path(target_path)
            if not cleaned_target:
                return error_response("Provide the file to restore.")
            relative_inside_skill = cleaned_target.removeprefix(f"{skill_slug}/")
            restore_archive_member(managed_root, revision["archive"], relative_inside_skill)
            note = f"File restored from revision {revision['revision_number']}: {cleaned_target}"
            changed_path = cleaned_target
            origin = "restore-file"
        else:
            return error_response("Invalid restore mode. Use 'skill' or 'file'.")

        record_studio_revision(connection, skill_slug, origin, note, changed_path=changed_path)
        status = studio_status_payload(connection, skill_slug)
        history = studio_history_payload(connection, skill_slug)
    return jsonify({"ok": True, "data": {"studioStatus": status, "history": history}})


@app.post("/api/operations/run")
def api_run_operation():
    payload = request.get_json(silent=True) or {}
    action = payload.get("action")
    if not action:
        return error_response("Provide the operation.")
    if action == "gateway_skills_status":
        credentials = request_gateway_credentials(payload)
        try:
            snapshot = fetch_gateway_workspace_skills(
                credentials.url,
                credentials.token,
                credentials.basic_user,
                credentials.basic_pass,
            )
        except ValueError as exc:
            return error_response(str(exc))
        return jsonify(
            {
                "ok": True,
                "data": {
                    "label": "Consultar skills.status no gateway",
                    "command": "skills.status",
                    "exitCode": 0,
                    "stdout": "",
                    "stderr": "",
                    "json": snapshot,
                    "helpText": "Consulta remota via WebSocket autenticado no gateway.",
                },
            }
        )
    try:
        operation = build_operation(action, payload)
        result = run_command(operation)
    except ValueError as exc:
        return error_response(str(exc))
    return jsonify({"ok": True, "data": result})


@app.post("/api/gateway/probe")
def api_gateway_probe():
    payload = request.get_json(silent=True) or {}
    credentials = request_gateway_credentials(payload)
    try:
        result = probe_gateway_url(credentials.url, credentials.token, credentials.basic_user, credentials.basic_pass)
    except ValueError as exc:
        return error_response(str(exc))
    return jsonify({"ok": True, "data": result})


@app.post("/api/gateway/skills")
def api_gateway_skills():
    payload = request.get_json(silent=True) or {}
    credentials = request_gateway_credentials(payload)
    try:
        result = fetch_gateway_workspace_skills(
            credentials.url,
            credentials.token,
            credentials.basic_user,
            credentials.basic_pass,
        )
    except ValueError as exc:
        return error_response(str(exc))
    return jsonify({"ok": True, "data": result})


@app.get("/api/health")
def api_health():
    return jsonify(
        {
            "ok": True,
            "data": {
                "appTitle": APP_TITLE,
                "workspaceRoot": WORKSPACE_ROOT.as_posix(),
                "skillsDir": SKILLS_DIR.as_posix(),
                "cliAvailable": cli_available(),
            },
        }
    )


if __name__ == "__main__":
    ensure_skills_root()
    port = int(os.getenv("PORT", "8765"))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(host="0.0.0.0", port=port, debug=debug)
