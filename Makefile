.DEFAULT_GOAL := check

CHECK_TASKS := lint test build
BUILD_OUTPUTS :=
TEST_OUTPUTS :=
CHECK_ADMISSION :=

# Forward command data without interpreting embedded Make variable references.
override COMMAND := $(value COMMAND)
override TEST_ARGS := $(value TEST_ARGS)

export CHECK_TASKS BUILD_OUTPUTS TEST_OUTPUTS CHECK_ADMISSION TEST_ARGS COMMAND
export CHECK_TIMEOUT_SECONDS CHECK_SCRATCH_SIZE CHECK_WORK_SIZE CHECK_TMP_SIZE CHECK_MEMORY CONTAINER_IMAGE

.PHONY: check check-info lint test build command

check lint test build command:
	@./tests/container/run $@

check-info:
	@./tests/container/run info
