/**
 * bsdsock_compat.h - Cross-platform BSD socket compatibility for Windows
 *
 * Provides:
 * - Socket handle type (socket_handle_t) that works on Windows (SOCKET) and POSIX (int)
 * - Error code macros (BSD_GET_SOCK_ERROR, BSD_WOULD_BLOCK, etc.)
 * - Socket close macro (BSD_CLOSE_SOCK)
 * - MSG_NOSIGNAL definition (0 on Windows where it's not needed)
 * - Platform includes (winsock2.h vs sys/socket.h)
 * - Helper functions: SetNonBlocking(), PollSocket()
 *
 * This header makes Winsock behave like BSD sockets, similar to how
 * posix_compat.h makes Windows file APIs behave like POSIX.
 *
 * Usage: Include this header in any file that uses BSD socket APIs.
 *
 * Note: On Windows, you must link with Ws2_32.lib and call
 * BSD_ENSURE_WINSOCK_INIT() before using sockets.
 */

#ifndef BSDSOCK_COMPAT_H
#define BSDSOCK_COMPAT_H

#include <stdint.h>

#ifndef __cplusplus
#include <stdbool.h>
#endif

#ifdef _WIN32

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "Ws2_32.lib")

/*
 * Socket handle type.
 * Windows SOCKET is UINT_PTR (pointer-sized unsigned).
 * We use uintptr_t to hold it safely without exposing Windows types.
 */
typedef uintptr_t socket_handle_t;
#define SOCKET_HANDLE_INVALID (~(uintptr_t)(0))

/*
 * Error code macros - map Windows WSA errors to BSD-style access.
 */
#define BSD_GET_SOCK_ERROR()   WSAGetLastError()
#define BSD_CLOSE_SOCK(s)      closesocket((SOCKET)(s))
#define BSD_WOULD_BLOCK        WSAEWOULDBLOCK
#define BSD_IN_PROGRESS        WSAEWOULDBLOCK
#define BSD_INTERRUPTED        WSAEINTR

/*
 * MSG_NOSIGNAL doesn't exist on Windows (SIGPIPE not a concern).
 */
#ifndef MSG_NOSIGNAL
#define MSG_NOSIGNAL 0
#endif

/*
 * ssize_t for Windows (if not already defined).
 */
#ifndef _SSIZE_T_DEFINED
#define _SSIZE_T_DEFINED
typedef intptr_t ssize_t;
#endif

/*
 * Windows requires WSAStartup before using sockets.
 * Call this macro at the start of any function that uses sockets.
 * Returns false if initialization fails.
 */
static inline bool BsdEnsureWinsockInit() {
  static bool initialized = false;
  static bool init_success = false;
  if (!initialized) {
    WSADATA wsa_data;
    init_success = (WSAStartup(MAKEWORD(2, 2), &wsa_data) == 0);
    initialized = true;
  }
  return init_success;
}
#define BSD_ENSURE_WINSOCK_INIT() BsdEnsureWinsockInit()

/*
 * Set socket to non-blocking mode.
 */
static inline bool BsdSetNonBlocking(socket_handle_t sock, bool non_blocking) {
  u_long mode = non_blocking ? 1 : 0;
  return ioctlsocket((SOCKET)(sock), FIONBIO, &mode) == 0;
}

/*
 * Poll a single socket for events.
 * Returns: >0 if events ready, 0 on timeout, <0 on error.
 */
static inline int BsdPollSocket(socket_handle_t sock, short events, int timeout_ms) {
  WSAPOLLFD pfd;
  pfd.fd = (SOCKET)(sock);
  pfd.events = events;
  pfd.revents = 0;
  return WSAPoll(&pfd, 1, timeout_ms);
}

/*
 * Cast socket handle for use with Winsock functions that expect SOCKET.
 */
#define BSD_SOCKET_CAST(s) ((SOCKET)(s))

#else  /* POSIX / BSD */

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

/*
 * Socket handle type - just an int on POSIX.
 */
typedef int socket_handle_t;
#define SOCKET_HANDLE_INVALID (-1)

/*
 * Error code macros - direct mapping to errno and constants.
 */
#define BSD_GET_SOCK_ERROR()   errno
#define BSD_CLOSE_SOCK(s)      close(s)
#define BSD_WOULD_BLOCK        EAGAIN
#define BSD_IN_PROGRESS        EINPROGRESS
#define BSD_INTERRUPTED        EINTR

/*
 * No-op on POSIX - WSAStartup not needed.
 */
#define BSD_ENSURE_WINSOCK_INIT() (true)

/*
 * Set socket to non-blocking mode.
 */
static inline bool BsdSetNonBlocking(socket_handle_t sock, bool non_blocking) {
  int flags = fcntl(sock, F_GETFL, 0);
  if (flags < 0) return false;
  if (non_blocking) {
    flags |= O_NONBLOCK;
  } else {
    flags &= ~O_NONBLOCK;
  }
  return fcntl(sock, F_SETFL, flags) == 0;
}

/*
 * Poll a single socket for events.
 * Returns: >0 if events ready, 0 on timeout, <0 on error.
 */
static inline int BsdPollSocket(socket_handle_t sock, short events, int timeout_ms) {
  struct pollfd pfd = {0};
  pfd.fd = sock;
  pfd.events = events;
  return poll(&pfd, 1, timeout_ms);
}

/*
 * No-op cast on POSIX - socket handle is already the right type.
 */
#define BSD_SOCKET_CAST(s) (s)

#endif  /* _WIN32 */

#endif  /* BSDSOCK_COMPAT_H */
