#include "socketsecurity/http-perf/fast_304_response.h"
#include "env-inl.h"
#include "node_errors.h"
#include "uv.h"
#include <cstdio>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::Local;
using v8::Object;

bool Fast304Response::Write304(
    Environment* env,
    Local<Object> socket,
    const char* etag,
    size_t etag_length) {
  // Format 304 response with ETag.
  char buffer[512];
  int len = snprintf(buffer, sizeof(buffer), kTemplate, etag);

  if (len < 0 || len >= static_cast<int>(sizeof(buffer))) {
    return false;
  }

  // Get UV handle from socket object.
  uv_stream_t* stream = reinterpret_cast<uv_stream_t*>(
      socket->GetAlignedPointerFromInternalField(0));

  if (stream == nullptr) {
    return false;
  }

  // Cork socket for single write.
  uv_tcp_t* tcp = reinterpret_cast<uv_tcp_t*>(stream);
  uv_os_fd_t fd;
  if (uv_fileno(reinterpret_cast<uv_handle_t*>(tcp), &fd) < 0) {
    return false;
  }

#ifdef __linux__
  int cork = 1;
  setsockopt(fd, SOL_TCP, TCP_CORK, &cork, sizeof(cork));
#endif

  // Write response.
  uv_buf_t buf = uv_buf_init(buffer, len);
  uv_write_t* req = new uv_write_t();
  req->data = nullptr;

  int result = uv_write(req, stream, &buf, 1, [](uv_write_t* req, int status) {
    delete req;
  });

#ifdef __linux__
  cork = 0;
  setsockopt(fd, SOL_TCP, TCP_CORK, &cork, sizeof(cork));
#endif

  return result == 0;
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
