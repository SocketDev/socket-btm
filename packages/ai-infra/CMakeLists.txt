cmake_minimum_required(VERSION 3.20)

if(APPLE AND "${CMAKE_OSX_DEPLOYMENT_TARGET}" STREQUAL "")
  set(CMAKE_OSX_DEPLOYMENT_TARGET "13.5" CACHE STRING "Minimum macOS version" FORCE)
endif()

project(smol_ai LANGUAGES C CXX)

option(SMOL_AI_BUILD_NAPI "Build the standalone N-API module" ON)

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(GGML_ACCELERATE OFF CACHE BOOL "" FORCE)
set(GGML_BLAS OFF CACHE BOOL "" FORCE)
set(GGML_CUDA OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)

add_subdirectory(upstream/llama.cpp llama EXCLUDE_FROM_ALL)

add_library(smol_ai_core STATIC src/smol_ai_core.cc)
target_compile_features(smol_ai_core PRIVATE cxx_std_17)
target_include_directories(smol_ai_core PUBLIC
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
  "${CMAKE_CURRENT_SOURCE_DIR}/upstream/llama.cpp/include"
)
target_link_libraries(smol_ai_core PUBLIC llama)

if(SMOL_AI_BUILD_NAPI)
  if(NOT DEFINED NODE_INCLUDE_DIR)
    message(FATAL_ERROR "NODE_INCLUDE_DIR must point to Node.js headers")
  endif()
  add_library(smol_ai MODULE napi/smol_ai_napi.cc)
  target_compile_definitions(smol_ai PRIVATE NAPI_VERSION=8)
  target_compile_features(smol_ai PRIVATE cxx_std_17)
  target_include_directories(smol_ai PRIVATE
    "${NODE_INCLUDE_DIR}"
    "${CMAKE_CURRENT_SOURCE_DIR}/src"
  )
  target_link_libraries(smol_ai PRIVATE smol_ai_core)
  set_target_properties(smol_ai PROPERTIES PREFIX "" SUFFIX ".node")

  if(APPLE)
    target_link_options(smol_ai PRIVATE "-undefined" "dynamic_lookup")
  elseif(WIN32)
    if(NOT DEFINED NODE_IMPORT_LIBRARY)
      message(FATAL_ERROR "NODE_IMPORT_LIBRARY must point to node.lib on Windows")
    endif()
    target_link_libraries(smol_ai PRIVATE "${NODE_IMPORT_LIBRARY}")
  endif()
endif()
