from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.services import document_parser
from app.services import file_preview_service
from app.services.summary_generator import summary_generator_service


class ImageSummaryFallbackTests(unittest.TestCase):
    def test_image_vision_failure_is_not_saved_as_rule_fallback(self) -> None:
        file = SimpleNamespace(
            id=901,
            original_name="training-slide.png",
            file_ext=".png",
        )
        parsed = {
            "text": "",
            "parsed_pages": 1,
            "parse_confidence": "low",
            "image_path": "/tmp/training-slide.png",
        }

        with (
            patch.object(document_parser.Path, "exists", return_value=True),
            patch(
                "app.services.summary_generator.llm_service.is_vision_configured",
                return_value=True,
            ),
            patch(
                "app.services.summary_generator.llm_service.chat_with_image",
                side_effect=TimeoutError("vision timed out"),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "vision timed out"):
                summary_generator_service.generate_summary(file=file, parsed=parsed)


class LibreOfficeIsolationTests(unittest.TestCase):
    def test_document_parser_uses_an_isolated_libreoffice_profile(self) -> None:
        captured_command: list[str] = []

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "training.pptx"
            source.write_bytes(b"pptx")

            def fake_run(command, **kwargs):
                captured_command.extend(command)
                (root / "training.pdf").write_bytes(b"pdf")
                return subprocess.CompletedProcess(command, 0, "", "")

            with (
                patch.object(document_parser.shutil, "which", return_value="/usr/bin/soffice"),
                patch.object(document_parser.subprocess, "run", side_effect=fake_run),
            ):
                result = document_parser.document_parser_service._office_to_pdf(source, root)

        self.assertEqual(result.name, "training.pdf")
        self.assertTrue(
            any(value.startswith("-env:UserInstallation=file://") for value in captured_command),
            captured_command,
        )

    def test_preview_converter_uses_an_isolated_libreoffice_profile(self) -> None:
        captured_command: list[str] = []

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "training.pptx"
            output_dir = root / "output"
            source.write_bytes(b"pptx")

            def fake_run(command, timeout):
                captured_command.extend(command)
                output_dir.mkdir(parents=True, exist_ok=True)
                (output_dir / "training.pdf").write_bytes(b"pdf")
                return subprocess.CompletedProcess(command, 0, "", "")

            with (
                patch.object(file_preview_service.shutil, "which", return_value="/usr/bin/soffice"),
                patch.object(file_preview_service, "_run", side_effect=fake_run),
            ):
                result = file_preview_service._office_to_pdf(source, output_dir)

        self.assertEqual(result.name, "training.pdf")
        self.assertTrue(
            any(value.startswith("-env:UserInstallation=file://") for value in captured_command),
            captured_command,
        )


if __name__ == "__main__":
    unittest.main()
