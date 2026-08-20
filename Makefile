PYTHON ?= $(shell if [ -x "$(HOME)/venv-noisegen-qa/bin/python" ]; then echo "$(HOME)/venv-noisegen-qa/bin/python"; else echo python3; fi)

OUT ?= out

.PHONY: render render-pilot qa publish test

render:
	$(PYTHON) orchestrator.py --variants-file config/variants.yaml --output-dir out

render-pilot:
	$(PYTHON) orchestrator.py --variants-file config/variants_pilot.yaml --output-dir out

qa:
	PYTHONPATH=qa:. $(PYTHON) qa/qa_harness.py out --report out/qa_report.html --json out/qa_results.json

publish:
	$(PYTHON) scripts/publish_artifacts.py $(OUT)

test:
	$(PYTHON) -m pytest tests
