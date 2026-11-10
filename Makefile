.DEFAULT_GOAL := check

# Private execution order for the project image, not a discovery interface.
CHECK_TASKS := lint test build
export CHECK_TASKS

.PHONY: check

check:
	@./tests/container/run check
