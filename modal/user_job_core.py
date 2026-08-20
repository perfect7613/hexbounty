"""Pure validation and signing helpers for the user reconstruction API."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import time
import urllib.parse
from datetime import datetime
from decimal import Decimal, InvalidOperation


MAX_ROM_BYTES = 8 * 1024 * 1024
MIN_ROM_BYTES = 32 * 1024
MAX_URL_LENGTH = 2048
SIGNATURE_WINDOW_SECONDS = 5 * 60
JOB_RE = re.compile(r"^u-[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?$")
OWNER_RE = re.compile(r"^0x[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
NONCE_RE = re.compile(r"^[0-9a-f]{32,64}$")
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$")
PRICE_MON_RE = re.compile(r"^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,18})?$")
RIGHTS_AT_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z$"
)
JOB_ID_DOMAIN = "hexbounty-job-v1"

NINTENDO_LOGO = bytes.fromhex(
    "ce ed 66 66 cc 0d 00 0b 03 73 00 83 00 0c 00 0d"
    "00 08 11 1f 88 89 00 0e dc cc 6e e6 dd dd d9 99"
    "bb bb 67 63 6e 0e ec cc dd dc 99 9f bb b9 33 3e"
)
ROM_BYTES_BY_CODE = {
    0x00: 32 * 1024,
    0x01: 64 * 1024,
    0x02: 128 * 1024,
    0x03: 256 * 1024,
    0x04: 512 * 1024,
    0x05: 1024 * 1024,
    0x06: 2 * 1024 * 1024,
    0x07: 4 * 1024 * 1024,
    0x08: 8 * 1024 * 1024,
    0x52: 72 * 16 * 1024,
    0x53: 80 * 16 * 1024,
    0x54: 96 * 16 * 1024,
}


class ValidationError(ValueError):
    """A stable, user-safe validation refusal."""


def candidate_quality(process_returncode: int, run_status: object, candidate_exists: bool) -> str | None:
    """Classify a built candidate without pretending approximate means equivalent."""
    if process_returncode not in (0, 2) or not candidate_exists:
        return None
    return "verified" if process_returncode == 0 and run_status == "complete" else "approximate"


def rejected_job_is_retryable(
    manifest: object,
    retained_names: set[str],
    *,
    job_id: str,
    owner: str,
    manifest_name: str,
) -> bool:
    """Allow retry only when a rejected ingestion retained no source or result."""
    return (
        isinstance(manifest, dict)
        and manifest.get("jobId") == job_id
        and manifest.get("owner") == owner
        and manifest.get("kind") == "user-reconstruction-v1"
        and manifest.get("status") == "rejected"
        and retained_names == {manifest_name}
    )


def validate_job_id(value: object) -> str:
    if not isinstance(value, str) or not JOB_RE.fullmatch(value):
        raise ValidationError("jobId must be a lowercase u- slug of at most 64 characters")
    return value


def validate_owner(value: object) -> str:
    if not isinstance(value, str):
        raise ValidationError("owner must be a lowercase EVM address")
    owner = value.lower()
    if not OWNER_RE.fullmatch(owner):
        raise ValidationError("owner must be a 20-byte EVM address")
    return owner


def validate_slug(value: object) -> str:
    if not isinstance(value, str) or not SLUG_RE.fullmatch(value):
        raise ValidationError(
            "slug must be 1-48 lowercase letters, digits, or hyphens and start/end alphanumeric"
        )
    return value


def derive_job_id(slug: object, owner: object) -> str:
    """Canonical stable lookup key shared by Modal and stateless Vercel."""
    safe_slug = validate_slug(slug)
    safe_owner = validate_owner(owner)
    message = f"{JOB_ID_DOMAIN}\n{safe_owner}\n{safe_slug}".encode("utf-8")
    return "u-" + hashlib.sha256(message).hexdigest()[:32]


def _bounded_public_string(
    value: object, field: str, *, minimum: int, maximum: int
) -> str:
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise ValidationError(f"{field} must be {minimum}-{maximum} characters")
    if value != value.strip():
        raise ValidationError(f"{field} must not have leading or trailing whitespace")
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise ValidationError(f"{field} contains unsupported control characters")
    return value


def validate_public_metadata(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValidationError("public game metadata must be an object")
    expected = {
        "slug",
        "title",
        "description",
        "priceMon",
        "rightsNote",
        "rightsAttestedAt",
        "bountyMon",
        "bountyTxHash",
        "bountyId",
        "bountyDeadline",
        "bountyMetadataURI",
    }
    if set(value) != expected:
        raise ValidationError("public game metadata fields do not match the v1 schema")
    slug = validate_slug(value["slug"])
    title = _bounded_public_string(value["title"], "title", minimum=1, maximum=80)
    description = _bounded_public_string(
        value["description"], "description", minimum=0, maximum=500
    )
    rights_note = _bounded_public_string(
        value["rightsNote"], "rightsNote", minimum=1, maximum=240
    )
    price = value["priceMon"]
    if not isinstance(price, str) or not PRICE_MON_RE.fullmatch(price):
        raise ValidationError("priceMon must be a canonical positive MON decimal with up to 18 places")
    try:
        decimal_price = Decimal(price)
    except InvalidOperation:
        raise ValidationError("priceMon is invalid") from None
    if decimal_price <= 0 or decimal_price > Decimal("1000000"):
        raise ValidationError("priceMon must be greater than 0 and at most 1000000")
    attested_at = value["rightsAttestedAt"]
    if not isinstance(attested_at, str) or len(attested_at) > 32 or not RIGHTS_AT_RE.fullmatch(attested_at):
        raise ValidationError("rightsAttestedAt must be an RFC3339 UTC timestamp")
    try:
        datetime.fromisoformat(attested_at.removesuffix("Z") + "+00:00")
    except ValueError:
        raise ValidationError("rightsAttestedAt is not a valid calendar timestamp") from None
    bounty_mon = value["bountyMon"]
    if not isinstance(bounty_mon, str) or not PRICE_MON_RE.fullmatch(bounty_mon):
        raise ValidationError("bountyMon must be a canonical positive MON decimal")
    try:
        bounty_decimal = Decimal(bounty_mon)
    except InvalidOperation:
        raise ValidationError("bountyMon is invalid") from None
    if bounty_decimal <= 0 or bounty_decimal > Decimal("1000000"):
        raise ValidationError("bountyMon must be greater than 0 and at most 1000000")
    bounty_tx_hash = value["bountyTxHash"]
    if not isinstance(bounty_tx_hash, str) or not re.fullmatch(r"0x[0-9a-f]{64}", bounty_tx_hash):
        raise ValidationError("bountyTxHash must be a lowercase transaction hash")
    bounty_id = value["bountyId"]
    if not isinstance(bounty_id, str) or not re.fullmatch(r"[1-9][0-9]{0,77}", bounty_id):
        raise ValidationError("bountyId must be a positive integer")
    bounty_deadline = value["bountyDeadline"]
    if isinstance(bounty_deadline, bool) or not isinstance(bounty_deadline, int) or bounty_deadline <= 0:
        raise ValidationError("bountyDeadline must be a positive Unix timestamp")
    bounty_metadata_uri = value["bountyMetadataURI"]
    if not isinstance(bounty_metadata_uri, str) or len(bounty_metadata_uri) > 1024:
        raise ValidationError("bountyMetadataURI is invalid")
    parsed_metadata_uri = urllib.parse.urlsplit(bounty_metadata_uri)
    if parsed_metadata_uri.scheme != "https" or not parsed_metadata_uri.hostname:
        raise ValidationError("bountyMetadataURI must use HTTPS")
    return {
        "slug": slug,
        "title": title,
        "description": description,
        "priceMon": price,
        "rightsNote": rights_note,
        "rightsAttestedAt": attested_at,
        "bountyMon": bounty_mon,
        "bountyTxHash": bounty_tx_hash,
        "bountyId": bounty_id,
        "bountyDeadline": bounty_deadline,
        "bountyMetadataURI": bounty_metadata_uri,
    }


def validate_digest(value: object) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ValidationError("sourceSha256 must be 64 lowercase hexadecimal characters")
    return value


def validate_extension(value: object) -> str:
    if value not in (".gb", ".gbc"):
        raise ValidationError("extension must be .gb or .gbc; GBA is not supported")
    return str(value)


def validate_expected_bytes(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError("sourceBytes must be an integer")
    if not MIN_ROM_BYTES <= value <= MAX_ROM_BYTES:
        raise ValidationError(
            f"sourceBytes must be between {MIN_ROM_BYTES} and {MAX_ROM_BYTES}"
        )
    return value


def parse_allowed_hosts(raw: str) -> tuple[str, ...]:
    hosts = tuple(sorted({item.strip().lower().rstrip(".") for item in raw.split(",") if item.strip()}))
    if not hosts:
        raise ValidationError("HEXBOUNTY_UPLOAD_HOSTS is empty")
    for host in hosts:
        labels = host.split(".")
        if (
            ":" in host
            or "/" in host
            or len(host) > 253
            or any(
                not label
                or len(label) > 63
                or not re.fullmatch(r"[a-z0-9-]+", label)
                or label.startswith("-")
                or label.endswith("-")
                for label in labels
            )
        ):
            raise ValidationError("HEXBOUNTY_UPLOAD_HOSTS contains an invalid hostname")
    return hosts


def validate_source_url(value: object, allowed_hosts: tuple[str, ...]) -> str:
    if not isinstance(value, str) or len(value) > MAX_URL_LENGTH:
        raise ValidationError("sourceUrl is missing or too long")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValidationError("sourceUrl must use HTTPS")
    if parsed.username or parsed.password or parsed.fragment:
        raise ValidationError("sourceUrl must not contain credentials or a fragment")
    try:
        port = parsed.port
    except ValueError:
        raise ValidationError("sourceUrl port is invalid") from None
    if port not in (None, 443):
        raise ValidationError("sourceUrl must use the standard HTTPS port")
    hostname = parsed.hostname.lower().rstrip(".")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValidationError("sourceUrl IP literals are not allowed")
    if not any(hostname == host or hostname.endswith("." + host) for host in allowed_hosts):
        raise ValidationError("sourceUrl hostname is not allowlisted")
    return value


def validate_rom(payload: bytes, extension: str) -> dict:
    extension = validate_extension(extension)
    if not isinstance(payload, bytes):
        raise ValidationError("ROM payload must be bytes")
    size = len(payload)
    if not MIN_ROM_BYTES <= size <= MAX_ROM_BYTES or size % 0x4000:
        raise ValidationError("ROM size must be 32 KiB to 8 MiB in complete 16 KiB banks")
    if payload[0x104:0x134] != NINTENDO_LOGO:
        raise ValidationError("Game Boy header logo is invalid")
    declared = ROM_BYTES_BY_CODE.get(payload[0x148])
    if declared is None or declared != size:
        raise ValidationError("Game Boy header ROM-size code does not match the payload")
    checksum = 0
    for byte in payload[0x134:0x14D]:
        checksum = (checksum - byte - 1) & 0xFF
    if checksum != payload[0x14D]:
        raise ValidationError("Game Boy header checksum is invalid")
    cgb_flag = payload[0x143]
    is_cgb = cgb_flag in (0x80, 0xC0)
    if extension == ".gbc" and not is_cgb:
        raise ValidationError(".gbc input must carry a CGB-compatible header flag")
    # `.gb` is the ecosystem's general Game Boy ROM extension and is commonly
    # used for both dual-mode (0x80) and CGB-only (0xC0) cartridges. Keep `.gbc`
    # strict, but do not reject a valid color-capable header solely because the
    # uploader used the broader `.gb` extension.
    return {
        "platform": "Game Boy Color" if is_cgb else "Game Boy",
        "bytes": size,
        "banks": size // 0x4000,
        "cgbFlag": cgb_flag,
        "headerChecksum": payload[0x14D],
    }


def canonical_signature_message(
    *, timestamp: str, nonce: str, method: str, path: str, owner: str, body: bytes
) -> bytes:
    return "\n".join(
        (timestamp, nonce, method.upper(), path, owner, hashlib.sha256(body).hexdigest())
    ).encode("utf-8")


def sign_request(
    secret: str,
    *,
    timestamp: str,
    nonce: str,
    method: str,
    path: str,
    owner: str,
    body: bytes,
) -> str:
    message = canonical_signature_message(
        timestamp=timestamp,
        nonce=nonce,
        method=method,
        path=path,
        owner=owner,
        body=body,
    )
    return "sha256=" + hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify_signature(
    secret: str,
    *,
    timestamp: str,
    nonce: str,
    method: str,
    path: str,
    owner: str,
    body: bytes,
    supplied: str,
    now: int | None = None,
) -> None:
    if not NONCE_RE.fullmatch(nonce):
        raise ValidationError("request nonce is invalid")
    try:
        epoch = int(timestamp)
    except (TypeError, ValueError):
        raise ValidationError("request timestamp is invalid") from None
    if abs((int(time.time()) if now is None else now) - epoch) > SIGNATURE_WINDOW_SECONDS:
        raise ValidationError("request timestamp is outside the five-minute window")
    expected = sign_request(
        secret,
        timestamp=timestamp,
        nonce=nonce,
        method=method,
        path=path,
        owner=owner,
        body=body,
    )
    if not hmac.compare_digest(expected, supplied):
        raise ValidationError("request signature is invalid")
