"""Read-only command-line QA harness for rendered noise variants."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import soundfile as sf
from checks import (
    CheckResult,
    Sidecar,
    SidecarError,
    analyze_spectrum,
    clipping,
    dc_offset,
    decoded_pcm_hash,
    decorrelation,
    duration_format,
    green_bell,
    loop_seam,
    loudness,
    silence,
    spectral_tilt,
    true_peak,
)
from report import (
    ComparisonResult,
    FileReport,
    RunReport,
    RunSummary,
    VariantComparison,
    write_reports,
)


def compare_dirs(original: Path, rerender: Path) -> ComparisonResult:
    left = {path.name: path for path in original.glob("*.wav")}
    right = {path.name: path for path in rerender.glob("*.wav")}
    variants: list[VariantComparison] = []
    for name in sorted(set(left) | set(right)):
        if name not in left or name not in right:
            side = "original" if name not in left else "comparison"
            variants.append(VariantComparison(name, False, reason=f"missing in {side} directory"))
            continue
        try:
            left_hash = decoded_pcm_hash(left[name])
            right_hash = decoded_pcm_hash(right[name])
            variants.append(VariantComparison(name, left_hash == right_hash, left_hash, right_hash))
        except (OSError, RuntimeError, ValueError) as exc:
            variants.append(VariantComparison(name, False, reason=str(exc)))
    if not variants:
        variants.append(VariantComparison("<directory>", False, reason="no FLAC variants found in comparison"))
    return ComparisonResult(all(variant.passed for variant in variants), tuple(variants))


def failed_file(filename: str, message: str) -> FileReport:
    result = CheckResult("Input", message, "valid sidecar and readable audio", False)
    return FileReport(filename, (result,), input_error=message)


def inspect_file(path: Path) -> FileReport:
    try:
        sidecar = Sidecar.from_json(path.with_suffix(".json"))
        with sf.SoundFile(path) as info:
            format_check = duration_format(info, sidecar)
        data, _ = sf.read(path, dtype="float64", always_2d=True)
        if data.ndim != 2 or data.shape[1] != 2:
            raise ValueError("audio must decode as stereo")
        spectrum = analyze_spectrum(data, sidecar)
        checks = (
            loudness(data, sidecar),
            true_peak(data, sidecar),
            clipping(data, sidecar),
            dc_offset(data),
            loop_seam(data, sidecar),
            spectral_tilt(spectrum, sidecar),
            green_bell(spectrum, sidecar),
            silence(data, sidecar),
            decorrelation(data),
            format_check,
        )
    except (OSError, RuntimeError, ValueError, SidecarError) as exc:
        return failed_file(path.name, str(exc))
    try:
        digest = decoded_pcm_hash(path)
    except (OSError, RuntimeError, ValueError) as exc:
        return failed_file(path.name, str(exc))
    return FileReport(path.name, checks, digest)


def _summary(files: tuple[FileReport, ...], comparison: ComparisonResult | None, error: str | None) -> RunSummary:
    failing = sorted({check.name for file_report in files for check in file_report.checks if not check.passed})
    if comparison is not None and not comparison.passed:
        failing.append("Determinism comparison")
    if error is not None:
        failing.append("Input")
    failed = sum(not file_report.passed for file_report in files) + (1 if error is not None else 0)
    comparison_failed = comparison is not None and not comparison.passed
    return RunSummary(
        len(files),
        len(files) - failed,
        failed,
        tuple(sorted(set(failing))),
        "PASS" if failed == 0 and not comparison_failed and error is None else "FAIL",
    )


def run(output_dir: Path, compare_dir: Path | None, report: Path, json_path: Path) -> int:
    files = tuple(inspect_file(path) for path in sorted(output_dir.glob("wn_*.wav")) if path.is_file())
    by_hash: dict[str, list[str]] = {}
    for file_report in files:
        if file_report.decoded_pcm_sha256 is not None:
            by_hash.setdefault(file_report.decoded_pcm_sha256, []).append(file_report.filename)
    updated: list[FileReport] = []
    for file_report in files:
        digest = file_report.decoded_pcm_sha256
        if digest is not None and len(by_hash[digest]) > 1:
            duplicates = ", ".join(name for name in by_hash[digest] if name != file_report.filename)
            updated.append(file_report.with_check(CheckResult("Uniqueness", f"duplicate of {duplicates}", "no duplicate decoded PCM", False)))
        else:
            updated.append(file_report.with_check(CheckResult("Uniqueness", "unique decoded PCM", "no duplicate decoded PCM", True)))
    final_files = tuple(updated)
    comparison = compare_dirs(output_dir, compare_dir) if compare_dir is not None else None
    error = "no matching wn_*.wav files found" if not final_files else None
    result = RunReport(_summary(final_files, comparison, error), final_files, comparison, error)
    write_reports(report, json_path, result)
    return 0 if result.summary.overall_verdict == "PASS" else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--compare-dir", type=Path)
    parser.add_argument("--report", type=Path, default=Path("qa_report.html"))
    parser.add_argument("--json", dest="json_path", type=Path, default=Path("qa_results.json"))
    args = parser.parse_args(argv)
    return run(args.output_dir, args.compare_dir, args.report, args.json_path)


if __name__ == "__main__":
    sys.exit(main())
