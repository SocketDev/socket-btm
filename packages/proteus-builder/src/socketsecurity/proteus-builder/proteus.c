/*
 * proteus — fleet credential broker daemon.
 *
 * Cross-platform daemon lifecycle: bind an owner-only local transport, hold it
 * under a single-instance pidfile lock, accept connections from the same user
 * only, and dispatch credential requests against an in-memory TTL cache fronting
 * the OS keystore (macOS Keychain + Touch ID, libsecret, Credential Manager).
 *
 * The transport differs by platform but the wire + protocol are identical:
 *   POSIX  — an AF_UNIX stream socket at <socket-path>; peer-uid via
 *            getpeereid / SO_PEERCRED; idle-exit via SIGALRM.
 *   Win32  — a named pipe at <socket-path> (e.g. \\.\pipe\proteus-sock); peer
 *            identity via GetNamedPipeClientProcessId + token-SID compare;
 *            idle-exit via an overlapped ConnectNamedPipe wait timeout.
 *
 * Design of record: socket-lib/.claude/plans/proteus-credential-broker.md
 */

/* _GNU_SOURCE exposes struct ucred + SO_PEERCRED on glibc; harmless elsewhere.
 * Must precede every include. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#include <windows.h>
typedef HANDLE conn_t;
#define PROTEUS_INVALID_CONN INVALID_HANDLE_VALUE
#else
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <unistd.h>

#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
typedef int conn_t;
#define PROTEUS_INVALID_CONN (-1)
#endif

#include "socketsecurity/keystore-infra/keystore.h"

/* Where the socket/pipe + pidfile live is decided by the launcher (socket-lib's
 * getRuntimeSocketPath) and passed in, so the daemon and its clients never
 * disagree on the path. We accept them as argv rather than recomputing. */
static char g_sock_path[256];
static char g_pid_path[256];

/* A successful biometric unlock is cached for this long so a burst of spawns
 * doesn't re-prompt Touch ID for every child. Configurable later. */
#define PROTEUS_TTL_SECONDS 300
#define PROTEUS_CACHE_SLOTS 32

/* Auto-exit after this many seconds with no connection (0 = never). The
 * launcher re-spawns the daemon on demand, so an idle one needn't linger
 * holding the socket and warm secrets. Override with PROTEUS_IDLE_SECONDS. */
#define PROTEUS_DEFAULT_IDLE_SECONDS 300

typedef struct {
  char key[128]; /* "<service>\0<account>" join */
  char value[512];
  time_t expires_at;
  int occupied;
} cache_entry_t;

static cache_entry_t g_cache[PROTEUS_CACHE_SLOTS];

/* Look up a live (unexpired) cached credential; returns NULL on miss. */
static const char* cache_lookup(const char* key, time_t now) {
  for (int i = 0; i < PROTEUS_CACHE_SLOTS; i++) {
    if (g_cache[i].occupied && g_cache[i].expires_at > now &&
        strncmp(g_cache[i].key, key, sizeof(g_cache[i].key)) == 0) {
      return g_cache[i].value;
    }
  }
  return NULL;
}

/* Insert or refresh a cached value, reusing an existing/expired/free slot
 * before evicting a live one. The TTL is the biometric-unlock grace window. */
static void cache_put(const char* key, const char* value, time_t now) {
  int slot = -1;
  for (int i = 0; i < PROTEUS_CACHE_SLOTS; i++) {
    if (g_cache[i].occupied &&
        strncmp(g_cache[i].key, key, sizeof(g_cache[i].key)) == 0) {
      slot = i;
      break;
    }
    if (slot < 0 && (!g_cache[i].occupied || g_cache[i].expires_at <= now)) {
      slot = i;
    }
  }
  if (slot < 0) {
    slot = 0; /* all slots live: evict the first */
  }
  snprintf(g_cache[slot].key, sizeof(g_cache[slot].key), "%s", key);
  snprintf(g_cache[slot].value, sizeof(g_cache[slot].value), "%s", value);
  g_cache[slot].expires_at = now + PROTEUS_TTL_SECONDS;
  g_cache[slot].occupied = 1;
}

/* Drop a cached value (after a put/delete changes the underlying secret). */
static void cache_evict(const char* key) {
  for (int i = 0; i < PROTEUS_CACHE_SLOTS; i++) {
    if (g_cache[i].occupied &&
        strncmp(g_cache[i].key, key, sizeof(g_cache[i].key)) == 0) {
      memset(&g_cache[i], 0, sizeof(g_cache[i]));
    }
  }
}

/* Extract the string value for "key" from a flat JSON request object. This is a
 * minimal scanner for the daemon's own controlled wire, not a general JSON
 * parser: it finds "key", the ':', the opening quote, and copies until the
 * closing quote, decoding \" and \\. Returns 1 on success, 0 otherwise. */
static int json_field(const char* buf, const char* key, char* out,
                      size_t out_len) {
  char needle[64];
  int nlen = snprintf(needle, sizeof(needle), "\"%s\"", key);
  if (nlen < 0 || (size_t)nlen >= sizeof(needle)) {
    return 0;
  }
  const char* p = strstr(buf, needle);
  if (!p) {
    return 0;
  }
  p += nlen;
  while (*p == ' ' || *p == '\t') {
    p++;
  }
  if (*p != ':') {
    return 0;
  }
  p++;
  while (*p == ' ' || *p == '\t') {
    p++;
  }
  if (*p != '"') {
    return 0;
  }
  p++;
  size_t i = 0;
  while (*p && *p != '"') {
    char c = *p;
    if (c == '\\' && p[1]) {
      p++;
      c = *p;
    }
    if (i + 1 >= out_len) {
      return 0;
    }
    out[i++] = c;
    p++;
  }
  if (*p != '"') {
    return 0;
  }
  out[i] = '\0';
  return 1;
}

/* Escape a value into the body of a JSON string (no surrounding quotes). */
static void json_escape(const char* in, char* out, size_t out_len) {
  size_t i = 0;
  for (const char* p = in; *p && i + 2 < out_len; p++) {
    if (*p == '"' || *p == '\\') {
      out[i++] = '\\';
      out[i++] = *p;
    } else if (*p == '\n') {
      out[i++] = '\\';
      out[i++] = 'n';
    } else {
      out[i++] = *p;
    }
  }
  out[i] = '\0';
}

/* Write a full response line to the connection (platform transport). */
static void send_line(conn_t conn, const char* s) {
#ifdef _WIN32
  DWORD wrote = 0;
  WriteFile(conn, s, (DWORD)strlen(s), &wrote, NULL);
#else
  ssize_t r = write(conn, s, strlen(s));
  (void)r;
#endif
}

/* Read one request into `line` (NUL-terminated). Returns bytes read, 0 on EOF,
 * or -1 on error. */
static long conn_read(conn_t conn, char* line, size_t cap) {
#ifdef _WIN32
  DWORD got = 0;
  if (!ReadFile(conn, line, (DWORD)(cap - 1), &got, NULL)) {
    return -1;
  }
  return (long)got;
#else
  ssize_t n = read(conn, line, cap - 1);
  return (long)n;
#endif
}

/* Map a KEYSTORE_ERR_* code to a JSON error response. */
static void send_keystore_error(conn_t conn, int rc) {
  switch (rc) {
    case KEYSTORE_ERR_UNAVAILABLE:
      send_line(conn, "{\"ok\":false,\"error\":\"keystore-unavailable\"}\n");
      break;
    case KEYSTORE_ERR_NOT_FOUND:
      send_line(conn, "{\"ok\":false,\"error\":\"not-found\"}\n");
      break;
    case KEYSTORE_ERR_DENIED:
      send_line(conn, "{\"ok\":false,\"error\":\"denied\"}\n");
      break;
    default:
      send_line(conn, "{\"ok\":false,\"error\":\"keystore-io\"}\n");
      break;
  }
}

/* Reject any peer whose owning user differs from ours: the transport is
 * single-user. POSIX compares uid; Win32 compares the client process's token
 * user SID against our own. */
#ifdef _WIN32
static int win_token_user_sid(HANDLE process, char* buf, DWORD cap) {
  HANDLE token = NULL;
  if (!OpenProcessToken(process, TOKEN_QUERY, &token)) {
    return 0;
  }
  DWORD need = 0;
  GetTokenInformation(token, TokenUser, NULL, 0, &need);
  if (need == 0 || need > cap) {
    CloseHandle(token);
    return 0;
  }
  int ok = GetTokenInformation(token, TokenUser, buf, cap, &need) ? 1 : 0;
  CloseHandle(token);
  return ok;
}

static int peer_is_owner(conn_t conn) {
  ULONG client_pid = 0;
  if (!GetNamedPipeClientProcessId(conn, &client_pid)) {
    return 0;
  }
  HANDLE client = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE,
                              (DWORD)client_pid);
  if (!client) {
    return 0;
  }
  /* TOKEN_USER is variable-length (SID); 256 bytes covers any real SID. */
  char client_buf[256];
  char self_buf[256];
  int ok = win_token_user_sid(client, client_buf, sizeof(client_buf)) &&
           win_token_user_sid(GetCurrentProcess(), self_buf, sizeof(self_buf));
  CloseHandle(client);
  if (!ok) {
    return 0;
  }
  PSID client_sid = ((TOKEN_USER*)client_buf)->User.Sid;
  PSID self_sid = ((TOKEN_USER*)self_buf)->User.Sid;
  return EqualSid(client_sid, self_sid) ? 1 : 0;
}
#else
static int peer_is_owner(conn_t conn) {
  uid_t peer_uid;
#if defined(__APPLE__)
  gid_t peer_gid;
  if (getpeereid(conn, &peer_uid, &peer_gid) != 0) {
    return 0;
  }
#elif defined(SO_PEERCRED)
  struct ucred cred;
  socklen_t len = sizeof(cred);
  if (getsockopt(conn, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) {
    return 0;
  }
  peer_uid = cred.uid;
#else
  /* No peer-credential mechanism: refuse rather than serve blindly. */
  (void)conn;
  return 0;
#endif
  return peer_uid == getuid();
}
#endif

/*
 * Handle one connection: one NDJSON request line in, one JSON response line
 * out. Requests are flat objects, e.g.
 *   {"op":"get","service":"anthropic","account":"ANTHROPIC_API_KEY"}
 * Supported ops: ping, get, put, delete. A "get" consults the TTL cache first
 * and only then hits the keystore, which raises the biometric prompt on macOS.
 */
static void handle_connection(conn_t conn) {
  if (!peer_is_owner(conn)) {
    send_line(conn, "{\"ok\":false,\"error\":\"peer-uid-mismatch\"}\n");
    return;
  }

  char line[2048];
  long n = conn_read(conn, line, sizeof(line));
  if (n <= 0) {
    return;
  }
  line[n] = '\0';

  char op[32];
  if (!json_field(line, "op", op, sizeof(op))) {
    /* Accept a bare "ping" word too, for a dependency-free liveness probe. */
    if (strncmp(line, "ping", 4) == 0) {
      send_line(conn, "{\"ok\":true,\"pong\":true}\n");
      return;
    }
    send_line(conn, "{\"ok\":false,\"error\":\"bad-request\"}\n");
    return;
  }
  if (strcmp(op, "ping") == 0) {
    send_line(conn, "{\"ok\":true,\"pong\":true}\n");
    return;
  }

  char service[128];
  char account[128];
  if (!json_field(line, "service", service, sizeof(service)) ||
      !json_field(line, "account", account, sizeof(account))) {
    send_line(conn, "{\"ok\":false,\"error\":\"missing-service-or-account\"}\n");
    return;
  }
  char key[260];
  snprintf(key, sizeof(key), "%s:%s", service, account);
  time_t now = time(NULL);

  if (strcmp(op, "get") == 0) {
    char escaped[1040];
    const char* cached = cache_lookup(key, now);
    if (cached) {
      char resp[1200];
      json_escape(cached, escaped, sizeof(escaped));
      snprintf(resp, sizeof(resp),
               "{\"ok\":true,\"cached\":true,\"value\":\"%s\"}\n", escaped);
      send_line(conn, resp);
      return;
    }
    char value[512];
    int rc = keystore_get(service, account, value, sizeof(value));
    if (rc == KEYSTORE_OK) {
      cache_put(key, value, now);
      char resp[1200];
      json_escape(value, escaped, sizeof(escaped));
      snprintf(resp, sizeof(resp),
               "{\"ok\":true,\"cached\":false,\"value\":\"%s\"}\n", escaped);
      send_line(conn, resp);
      /* Don't leave the plaintext secret sitting on the stack. */
      memset(value, 0, sizeof(value));
      memset(escaped, 0, sizeof(escaped));
      return;
    }
    send_keystore_error(conn, rc);
    return;
  }

  if (strcmp(op, "put") == 0) {
    char value[512];
    if (!json_field(line, "value", value, sizeof(value))) {
      send_line(conn, "{\"ok\":false,\"error\":\"missing-value\"}\n");
      return;
    }
    int rc = keystore_put(service, account, value);
    memset(value, 0, sizeof(value));
    if (rc == KEYSTORE_OK) {
      cache_evict(key);
      send_line(conn, "{\"ok\":true,\"stored\":true}\n");
      return;
    }
    send_keystore_error(conn, rc);
    return;
  }

  if (strcmp(op, "delete") == 0) {
    int rc = keystore_delete(service, account);
    if (rc == KEYSTORE_OK) {
      cache_evict(key);
      send_line(conn, "{\"ok\":true,\"deleted\":true}\n");
      return;
    }
    send_keystore_error(conn, rc);
    return;
  }

  send_line(conn, "{\"ok\":false,\"error\":\"unknown-op\"}\n");
}

/* Remove the pidfile (and, on POSIX, the socket file) so a clean restart can
 * re-bind. A Win32 named pipe has no filesystem entry to unlink. */
static void cleanup(void) {
#ifdef _WIN32
  DeleteFileA(g_pid_path);
#else
  unlink(g_sock_path);
  unlink(g_pid_path);
#endif
}

#ifndef _WIN32
static void on_signal(int signo) {
  (void)signo;
  cleanup();
  _exit(0);
}
#else
static BOOL WINAPI on_console_ctrl(DWORD type) {
  (void)type;
  cleanup();
  ExitProcess(0);
  return TRUE;
}
#endif

/*
 * Claim the single-instance lock. The pidfile is created exclusively (POSIX
 * O_CREAT|O_EXCL, Win32 CREATE_NEW), so the exclusive create IS the lock. If it
 * already exists we check whether the named process is still alive: a live pid
 * means another daemon owns the transport (refuse); a dead pid means a stale
 * file from a crash (reclaim it).
 */
#ifdef _WIN32
static int pid_is_alive(DWORD pid) {
  HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!h) {
    return 0;
  }
  DWORD code = 0;
  int alive = GetExitCodeProcess(h, &code) && code == STILL_ACTIVE;
  CloseHandle(h);
  return alive;
}

static int write_pidfile_excl(void) {
  HANDLE h = CreateFileA(g_pid_path, GENERIC_WRITE, 0, NULL, CREATE_NEW,
                         FILE_ATTRIBUTE_NORMAL, NULL);
  if (h == INVALID_HANDLE_VALUE) {
    return -1;
  }
  char buf[32];
  int len = snprintf(buf, sizeof(buf), "%lu\n", (unsigned long)GetCurrentProcessId());
  DWORD wrote = 0;
  WriteFile(h, buf, (DWORD)len, &wrote, NULL);
  CloseHandle(h);
  return 0;
}

static int claim_pidfile(void) {
  if (write_pidfile_excl() == 0) {
    return 0;
  }
  /* Existing pidfile: is its owner still running? */
  FILE* f = fopen(g_pid_path, "r");
  if (f) {
    unsigned long existing = 0;
    if (fscanf(f, "%lu", &existing) == 1 && existing > 0 &&
        pid_is_alive((DWORD)existing)) {
      fclose(f);
      return -1; /* a live daemon already holds the lock */
    }
    fclose(f);
  }
  /* Stale: reclaim the pidfile. */
  DeleteFileA(g_pid_path);
  return write_pidfile_excl();
}
#else
static int claim_pidfile(void) {
  int fd = open(g_pid_path, O_CREAT | O_EXCL | O_WRONLY, 0600);
  if (fd < 0) {
    if (errno != EEXIST) {
      return -1;
    }
    /* Existing pidfile: is its owner still running? */
    FILE* f = fopen(g_pid_path, "r");
    if (f) {
      long existing = 0;
      if (fscanf(f, "%ld", &existing) == 1 && existing > 0 &&
          kill((pid_t)existing, 0) == 0) {
        fclose(f);
        return -1; /* a live daemon already holds the lock */
      }
      fclose(f);
    }
    /* Stale: reclaim the pidfile and the socket it guarded. */
    unlink(g_pid_path);
    unlink(g_sock_path);
    fd = open(g_pid_path, O_CREAT | O_EXCL | O_WRONLY, 0600);
    if (fd < 0) {
      return -1;
    }
  }
  char buf[32];
  int len = snprintf(buf, sizeof(buf), "%ld\n", (long)getpid());
  ssize_t r = write(fd, buf, (size_t)len);
  (void)r;
  close(fd);
  return 0;
}
#endif

/* Resolve the configured idle timeout (seconds; 0 disables). */
static unsigned int idle_seconds(void) {
  const char* idle_env = getenv("PROTEUS_IDLE_SECONDS");
  return idle_env ? (unsigned int)atoi(idle_env) : PROTEUS_DEFAULT_IDLE_SECONDS;
}

#ifdef _WIN32
/* Win32 serve loop: one pipe instance, overlapped ConnectNamedPipe with an idle
 * timeout. Each served request resets the countdown; a timeout cleans up + exits. */
static int serve(void) {
  unsigned int idle = idle_seconds();
  DWORD timeout = idle == 0 ? INFINITE : idle * 1000u;
  HANDLE evt = CreateEventA(NULL, TRUE, FALSE, NULL);
  if (!evt) {
    cleanup();
    return 1;
  }
  fprintf(stdout, "daemon started pid=%lu sock=%s\n",
          (unsigned long)GetCurrentProcessId(), g_sock_path);
  fflush(stdout);
  for (;;) {
    HANDLE pipe = CreateNamedPipeA(
        g_sock_path, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, PIPE_UNLIMITED_INSTANCES,
        4096, 4096, 0, NULL);
    if (pipe == INVALID_HANDLE_VALUE) {
      cleanup();
      CloseHandle(evt);
      return 1;
    }
    OVERLAPPED ov;
    memset(&ov, 0, sizeof(ov));
    ov.hEvent = evt;
    ResetEvent(evt);
    BOOL connected = ConnectNamedPipe(pipe, &ov);
    DWORD err = GetLastError();
    if (!connected && err == ERROR_IO_PENDING) {
      if (WaitForSingleObject(evt, timeout) == WAIT_TIMEOUT) {
        CancelIo(pipe);
        CloseHandle(pipe);
        cleanup();
        CloseHandle(evt);
        ExitProcess(0);
      }
    } else if (!connected && err != ERROR_PIPE_CONNECTED) {
      CloseHandle(pipe);
      continue;
    }
    handle_connection(pipe);
    FlushFileBuffers(pipe);
    DisconnectNamedPipe(pipe);
    CloseHandle(pipe);
  }
}
#else
/* POSIX serve loop: AF_UNIX accept loop with SIGALRM idle timeout. */
static int serve(void) {
  signal(SIGTERM, on_signal);
  signal(SIGINT, on_signal);
  signal(SIGPIPE, SIG_IGN);
  /* Idle timeout fires SIGALRM, handled like SIGTERM (cleanup + exit). */
  signal(SIGALRM, on_signal);

  int srv = socket(AF_UNIX, SOCK_STREAM, 0);
  if (srv < 0) {
    cleanup();
    return 1;
  }
  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  snprintf(addr.sun_path, sizeof(addr.sun_path), "%s", g_sock_path);
  unlink(g_sock_path);
  if (bind(srv, (struct sockaddr*)&addr, sizeof(addr)) != 0) {
    cleanup();
    return 1;
  }
  /* Owner-only: defense in depth alongside the per-connection peer-uid check. */
  chmod(g_sock_path, 0600);
  if (listen(srv, 8) != 0) {
    cleanup();
    return 1;
  }

  unsigned int idle = idle_seconds();
  fprintf(stdout, "daemon started pid=%ld sock=%s\n", (long)getpid(),
          g_sock_path);
  fflush(stdout);

  alarm(idle);
  for (;;) {
    int conn = accept(srv, NULL, NULL);
    if (conn < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }
    handle_connection(conn);
    close(conn);
    /* Reset the idle countdown after serving a request. */
    alarm(idle);
  }
  cleanup();
  return 0;
}
#endif

int main(int argc, char** argv) {
  if (argc < 3) {
    fprintf(stderr, "usage: proteus <socket-path> <pidfile-path>\n");
    return 2;
  }
  snprintf(g_sock_path, sizeof(g_sock_path), "%s", argv[1]);
  snprintf(g_pid_path, sizeof(g_pid_path), "%s", argv[2]);

  if (claim_pidfile() != 0) {
    fprintf(stderr, "proteus: already running or pidfile unavailable\n");
    return 1;
  }

#ifdef _WIN32
  SetConsoleCtrlHandler(on_console_ctrl, TRUE);
#endif

  return serve();
}
