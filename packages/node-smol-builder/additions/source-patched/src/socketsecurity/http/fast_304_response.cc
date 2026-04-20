// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#include "socketsecurity/http/fast_304_response.h"
#include "env-inl.h"
#include "node_errors.h"
#include "uv.h"
#include <cstdio>
#include <cstring>
#include <new>

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::Local;
using v8::Object;

// Heap-owned async-write state. libuv's uv_write defers the actual send
// until the socket is writable and reads from the buffer at send time —
// the buffer memory MUST stay alive until the callback fires. A prior
// version of this function stored the response in a `char buffer[512]`
// stack local and then returned before uv_write had sent anything, so
// libuv read popped-off stack memory and emitted garbage bytes on the
// wire. This struct bundles the buffer with the uv_write_t so one
// `delete` in the callback frees both at the right time.
struct Fast304WriteState {
  uv_write_t req;
  // 512 matches the previous stack size and is the formatted max for
  // `kTemplate` with a reasonable ETag; snprintf below still range-checks.
  char buffer[512];
};

bool Fast304Response::Write304(
    Environment* env,
    Local<Object> socket,
    const char* etag,
    size_t etag_length) {
  // Allocate the write state up-front so the buffer lives until the
  // uv_write callback fires. Nothrow + null-check because Node.js builds
  // with -fno-exceptions.
  auto* state = new (std::nothrow) Fast304WriteState();
  if (state == nullptr) {
    return false;
  }

  // Format 304 response with ETag into the heap buffer.
  int len = snprintf(state->buffer, sizeof(state->buffer), kTemplate, etag);
  if (len < 0 || len >= static_cast<int>(sizeof(state->buffer))) {
    delete state;
    return false;
  }

  // Get UV handle from socket object.
  uv_stream_t* stream = reinterpret_cast<uv_stream_t*>(
      socket->GetAlignedPointerFromInternalField(0));

  if (stream == nullptr) {
    delete state;
    return false;
  }

  // Cork socket for single write.
  uv_tcp_t* tcp = reinterpret_cast<uv_tcp_t*>(stream);
  uv_os_fd_t fd;
  if (uv_fileno(reinterpret_cast<uv_handle_t*>(tcp), &fd) < 0) {
    delete state;
    return false;
  }

#ifdef __linux__
  int cork = 1;
  setsockopt(fd, SOL_TCP, TCP_CORK, &cork, sizeof(cork));
#endif

  // Point uv_buf at the heap buffer (NOT the stack).
  uv_buf_t buf = uv_buf_init(state->buffer, len);
  state->req.data = state;

  int result = uv_write(&state->req, stream, &buf, 1,
      [](uv_write_t* req, int status) {
        // Free the full write state (req + buffer together).
        auto* s = static_cast<Fast304WriteState*>(req->data);
        delete s;
      });

#ifdef __linux__
  cork = 0;
  setsockopt(fd, SOL_TCP, TCP_CORK, &cork, sizeof(cork));
#endif

  // If uv_write didn't accept the request the callback will NOT fire, so
  // we own the state and must delete it here to avoid a leak.
  if (result != 0) {
    delete state;
    return false;
  }

  return true;
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#pragma GCC diagnostic pop
