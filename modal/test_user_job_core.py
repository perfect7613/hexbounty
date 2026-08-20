from __future__ import annotations

import hashlib
import unittest

from user_job_core import (
    NINTENDO_LOGO,
    ValidationError,
    candidate_quality,
    derive_job_id,
    parse_allowed_hosts,
    rejected_job_is_retryable,
    sign_request,
    validate_job_id,
    validate_public_metadata,
    validate_rom,
    validate_source_url,
    verify_signature,
)


def valid_rom(*, cgb: bool = False) -> bytes:
    rom = bytearray(32 * 1024)
    rom[0x104:0x134] = NINTENDO_LOGO
    rom[0x134:0x13B] = b"HEXTEST"
    rom[0x143] = 0x80 if cgb else 0
    rom[0x148] = 0
    checksum = 0
    for byte in rom[0x134:0x14D]:
        checksum = (checksum - byte - 1) & 0xFF
    rom[0x14D] = checksum
    return bytes(rom)


class UserJobValidationTests(unittest.TestCase):
    def test_candidate_quality_accepts_playable_approximation(self):
        self.assertEqual(candidate_quality(0, "complete", True), "verified")
        self.assertEqual(candidate_quality(2, "incomplete", True), "approximate")
        self.assertIsNone(candidate_quality(2, "incomplete", False))
        self.assertIsNone(candidate_quality(1, "complete", True))

    def test_rejected_job_retry_requires_an_empty_owner_bound_workspace(self):
        manifest = {
            "jobId": "u-0abc-job-123",
            "owner": "0x" + "1" * 40,
            "kind": "user-reconstruction-v1",
            "status": "rejected",
        }
        kwargs = {
            "job_id": manifest["jobId"],
            "owner": manifest["owner"],
            "manifest_name": "user-job.json",
        }
        self.assertTrue(
            rejected_job_is_retryable(manifest, {"user-job.json"}, **kwargs)
        )
        self.assertFalse(
            rejected_job_is_retryable(
                manifest, {"user-job.json", "input"}, **kwargs
            )
        )
        self.assertFalse(
            rejected_job_is_retryable(
                {**manifest, "status": "running"}, {"user-job.json"}, **kwargs
            )
        )

    def test_canonical_job_id_is_portable_and_owner_bound(self):
        owner = "0x1111111111111111111111111111111111111111"
        self.assertEqual(
            derive_job_id("space-breakout", owner),
            "u-cf816d240c4d53b3bcf9516c8a2fd00e",
        )
        self.assertNotEqual(
            derive_job_id("space-breakout", owner),
            derive_job_id("space-breakout", "0x" + "2" * 40),
        )

    def test_public_game_metadata_is_bounded(self):
        metadata = {
            "slug": "space-breakout",
            "title": "Space Breakout",
            "description": "A reconstructed Game Boy game.",
            "priceMon": "0.01",
            "rightsNote": "I am authorized to submit this binary.",
            "rightsAttestedAt": "2026-08-16T11:15:00.000Z",
            "bountyMon": "0.01",
            "bountyTxHash": "0x" + "12" * 32,
            "bountyId": "7",
            "bountyDeadline": 1787483700,
            "bountyMetadataURI": "https://arcade.example/api/games/space-breakout/metadata",
        }
        self.assertEqual(validate_public_metadata(metadata), metadata)
        for field, invalid in (
            ("slug", "../escape"),
            ("title", ""),
            ("description", "x" * 501),
            ("priceMon", "0"),
            ("rightsNote", "\u0000"),
            ("rightsAttestedAt", "not-a-date"),
            ("bountyMon", "0"),
            ("bountyTxHash", "0x1234"),
            ("bountyId", "0"),
            ("bountyDeadline", 0),
            ("bountyMetadataURI", "http://arcade.example/game"),
        ):
            with self.subTest(field=field):
                with self.assertRaises(ValidationError):
                    validate_public_metadata({**metadata, field: invalid})

    def test_valid_dmg_and_cgb_headers(self):
        self.assertEqual(validate_rom(valid_rom(), ".gb")["platform"], "Game Boy")
        self.assertEqual(
            validate_rom(valid_rom(cgb=True), ".gbc")["platform"], "Game Boy Color"
        )

    def test_rejects_bad_header_size_and_gba(self):
        damaged = bytearray(valid_rom())
        damaged[0x104] ^= 1
        with self.assertRaises(ValidationError):
            validate_rom(bytes(damaged), ".gb")
        with self.assertRaises(ValidationError):
            validate_rom(valid_rom() + bytes(16 * 1024), ".gb")
        with self.assertRaises(ValidationError):
            validate_rom(valid_rom(), ".gba")

    def test_gb_accepts_color_capable_headers_but_gbc_requires_one(self):
        self.assertEqual(
            validate_rom(valid_rom(cgb=True), ".gb")["platform"],
            "Game Boy Color",
        )
        with self.assertRaises(ValidationError):
            validate_rom(valid_rom(), ".gbc")

    def test_url_is_https_allowlisted_and_not_an_ip(self):
        hosts = parse_allowed_hosts("ufs.sh, utfs.io")
        self.assertEqual(
            validate_source_url("https://abc.ufs.sh/f/token?x=1", hosts),
            "https://abc.ufs.sh/f/token?x=1",
        )
        for url in (
            "http://abc.ufs.sh/f/token",
            "https://ufs.sh.evil.example/f/token",
            "https://127.0.0.1/file.gb",
            "https://user:pass@ufs.sh/file.gb",
            "https://ufs.sh:bad/file.gb",
        ):
            with self.assertRaises(ValidationError, msg=url):
                validate_source_url(url, hosts)
        with self.assertRaises(ValidationError):
            parse_allowed_hosts("*.ufs.sh")

    def test_job_id_is_bounded_slug(self):
        self.assertEqual(validate_job_id("u-0abc-job-123"), "u-0abc-job-123")
        for job_id in ("demo", "u-UPPER", "u-../escape", "u-" + "x" * 64):
            with self.assertRaises(ValidationError):
                validate_job_id(job_id)

    def test_signature_binds_every_request_field(self):
        values = dict(
            timestamp="2000000000",
            nonce="a" * 32,
            method="POST",
            path="/v1/jobs",
            owner="0x" + "1" * 40,
            body=b'{"jobId":"u-one"}',
        )
        signature = sign_request("test-secret", **values)
        verify_signature(
            "test-secret", supplied=signature, now=2000000000, **values
        )
        with self.assertRaises(ValidationError):
            verify_signature(
                "test-secret",
                supplied=signature,
                now=2000000000,
                **{**values, "body": b"tampered"},
            )
        self.assertEqual(len(hashlib.sha256(valid_rom()).hexdigest()), 64)


if __name__ == "__main__":
    unittest.main()
