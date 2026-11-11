.DEFAULT_GOAL := check

.PHONY: check lint test build

check lint test build:
	@./tests/container/check-stock $@
