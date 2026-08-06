"""Typed report models plus HTML and JSON rendering."""

from __future__ import annotations

import html
import json
from dataclasses import dataclass
from pathlib import Path

from checks import CheckResult


@dataclass(frozen=True)
class FileReport:
    filename: str
    checks: tuple[CheckResult, ...]
    decoded_pcm_sha256: str | None = None
    input_error: str | None = None

    @property
    def passed(self) -> bool:
        return all(check.passed for check in self.checks)

    def with_check(self, check: CheckResult) -> FileReport:
        return FileReport(self.filename, self.checks + (check,), self.decoded_pcm_sha256, self.input_error)

    def as_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "filename": self.filename,
            "passed": self.passed,
            "checks": [check.as_dict() for check in self.checks],
        }
        if self.decoded_pcm_sha256 is not None:
            result["decoded_pcm_sha256"] = self.decoded_pcm_sha256
        if self.input_error is not None:
            result["input_error"] = self.input_error
        return result


@dataclass(frozen=True)
class VariantComparison:
    filename: str
    passed: bool
    left_sha256: str | None = None
    right_sha256: str | None = None
    reason: str | None = None

    def as_dict(self) -> dict[str, object]:
        result: dict[str, object] = {"filename": self.filename, "passed": self.passed}
        if self.left_sha256 is not None:
            result["left_sha256"] = self.left_sha256
        if self.right_sha256 is not None:
            result["right_sha256"] = self.right_sha256
        if self.reason is not None:
            result["reason"] = self.reason
        return result


@dataclass(frozen=True)
class ComparisonResult:
    passed: bool
    variants: tuple[VariantComparison, ...]

    def as_dict(self) -> dict[str, object]:
        return {"passed": self.passed, "variants": [variant.as_dict() for variant in self.variants]}


@dataclass(frozen=True)
class RunSummary:
    file_count: int
    passed: int
    failed: int
    failing_check_names: tuple[str, ...]
    overall_verdict: str
    schema: str = "noisegen-qa/v1"

    def as_dict(self) -> dict[str, object]:
        return {
            "file_count": self.file_count,
            "passed": self.passed,
            "failed": self.failed,
            "failing_check_names": list(self.failing_check_names),
            "overall_verdict": self.overall_verdict,
            "schema": self.schema,
        }


@dataclass(frozen=True)
class RunReport:
    summary: RunSummary
    files: tuple[FileReport, ...]
    comparison: ComparisonResult | None = None
    run_error: str | None = None

    def as_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "summary": self.summary.as_dict(),
            "files": [file_report.as_dict() for file_report in self.files],
            "comparison": self.comparison.as_dict() if self.comparison else None,
        }
        if self.run_error is not None:
            result["run_error"] = self.run_error
        return result


def _check_rows(file_report: FileReport) -> str:
    rows = [
        f"<h2>{html.escape(file_report.filename)} — {'PASS' if file_report.passed else 'FAIL'}</h2>",
        "<table><tr><th>Check</th><th>Measured</th><th>Threshold</th><th>Verdict</th></tr>",
    ]
    for check in file_report.checks:
        rows.append(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td class='{}'>{}</td></tr>".format(
                html.escape(check.name),
                html.escape(check.measured),
                html.escape(check.threshold),
                "pass" if check.passed else "fail",
                "PASS" if check.passed else "FAIL",
            )
        )
        bands = check.details.get("third_octave_db") if check.details else None
        if isinstance(bands, dict):
            rows.append("<tr><td colspan='4'><details><summary>Third-octave band table</summary><table><tr><th>Center (Hz)</th><th>dB</th></tr>")
            rows.extend(
                f"<tr><td>{html.escape(str(center))}</td><td>{html.escape(str(value))}</td></tr>"
                for center, value in bands.items()
            )
            rows.append("</table></details></td></tr>")
    rows.append("</table>")
    return "".join(rows)


def render_html(report: RunReport) -> str:
    summary = report.summary
    comparison_html = ""
    if report.comparison is not None:
        comparison_html = f"<h2>Determinism comparison — {'PASS' if report.comparison.passed else 'FAIL'}</h2><pre>{html.escape(json.dumps(report.comparison.as_dict(), indent=2, sort_keys=True))}</pre>"
    error_html = f"<p class='fail'>{html.escape(report.run_error)}</p>" if report.run_error else ""
    files_html = "".join(_check_rows(file_report) for file_report in report.files)
    return f"""<!doctype html><html><head><meta charset='utf-8'><title>Noise QA</title>
<style>body{{font:14px sans-serif;margin:2rem}}table{{border-collapse:collapse;margin:0 0 1.5rem}}th,td{{border:1px solid #bbb;padding:.35rem .6rem}}.pass{{color:green}}.fail{{color:#b00}}h1{{color:{'green' if summary.overall_verdict == 'PASS' else '#b00'}}}</style></head>
<body><h1>Noise QA: {html.escape(summary.overall_verdict)}</h1><p>Files: {summary.file_count}; passed: {summary.passed}; failed: {summary.failed}</p>
<p>Failing checks: {html.escape(', '.join(summary.failing_check_names) or 'none')}</p>{error_html}{comparison_html}{files_html}</body></html>"""


def write_reports(report_path: Path, json_path: Path, report: RunReport) -> None:
    report_path.write_text(render_html(report), encoding="utf-8")
    json_path.write_text(json.dumps(report.as_dict(), indent=2, sort_keys=True), encoding="utf-8")
