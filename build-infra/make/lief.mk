# LIEF library paths and configuration.

LIEF_UPSTREAM = ../bin-infra/upstream/lief
LIEF_BUILD_DIR = ../bin-infra/build/$(BUILD_MODE)/out/Final/lief
LIEF_LIB = $(LIEF_BUILD_DIR)/libLIEF.a

# LIEF include flags.
# Use upstream includes if submodule exists (building from source).
# Otherwise use downloaded includes from build directory.
ifneq (,$(wildcard $(LIEF_UPSTREAM)/include))
    LIEF_CFLAGS = -I$(LIEF_UPSTREAM)/include -I$(LIEF_BUILD_DIR)/include
else
    LIEF_CFLAGS = -I$(LIEF_BUILD_DIR)/include
endif

# LIEF library is required for binject (except for clean target).
ifneq ($(MAKECMDGOALS),clean)
ifeq (,$(wildcard $(LIEF_LIB)))
    $(error LIEF library not found at $(LIEF_LIB). Please download LIEF from releases or build it first.)
endif
endif

LIEF_LDFLAGS = $(LIEF_LIB)
LIEF_DEFINES = -DHAVE_LIEF=1
