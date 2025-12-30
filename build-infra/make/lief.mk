# LIEF library paths and configuration.

LIEF_UPSTREAM = ../bin-infra/upstream/lief
LIEF_BUILD_DIR = ../bin-infra/build/$(BUILD_MODE)/out/Final/lief
LIEF_LIB = $(LIEF_BUILD_DIR)/libLIEF.a
LIEF_INCLUDE_DIR = $(LIEF_UPSTREAM)/include

# LIEF include flags.
LIEF_CFLAGS = -I$(LIEF_INCLUDE_DIR) -I$(LIEF_BUILD_DIR)/include

# Add LIEF library if it exists.
ifneq (,$(wildcard $(LIEF_LIB)))
    LIEF_LDFLAGS = $(LIEF_LIB)
    LIEF_DEFINES = -DHAVE_LIEF=1
else
    LIEF_LDFLAGS =
    LIEF_DEFINES =
endif
