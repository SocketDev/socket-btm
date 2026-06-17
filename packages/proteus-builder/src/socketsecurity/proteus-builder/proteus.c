/*
 * proteus — fleet credential broker daemon (Phase 1 skeleton).
 *
 * This file is the cross-platform daemon lifecycle: bind an owner-only local
 * socket, hold it under a single-instance pidfile lock, accept connections from
 * the same uid only, and dispatch credential requests against an in-memory TTL
 * cache. The cache is fronted by a keystore whose real implementation (macOS
 * Keychain + Touch ID, libsecret, Credential Manager) lands in a later phase;
 * here keystore_lookup() is a gated stub that reports "not implemented" so the
 * wire path and lifecycle can be exercised end to end without secrets.
 *
 * Design of record: socket-lib/.claude/plans/proteus-credential-broker.md
 */

/* _GNU_SOURCE exposes struct ucred + SO_PEERCRED on glibc; harmless elsewhere.
 * Must precede every include. */
#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>

#include "socketsecurity/keystore-infra/keystore.h"

/* Where the socket + pidfile live is decided by the launcher (socket-lib's
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

static void send_line(int fd, const char* s) {
  write(fd, s, strlen(s));
}

/* Map a KEYSTORE_ERR_* code to a JSON error response. */
static void send_keystore_error(int fd, int rc) {
  switch (rc) {
    case KEYSTORE_ERR_UNAVAILABLE:
      send_line(fd, "{\"ok\":false,\"error\":\"keystore-unavailable\"}\n");
      break;
    case KEYSTORE_ERR_NOT_FOUND:
      send_line(fd, "{\"ok\":false,\"error\":\"not-found\"}\n");
      break;
    case KEYSTORE_ERR_DENIED:
      send_line(fd, "{\"ok\":false,\"error\":\"denied\"}\n");
      break;
    default:
      send_line(fd, "{\"ok\":false,\"error\":\"keystore-io\"}\n");
      break;
  }
}

/* Reject any peer whose uid differs from ours: the socket is single-user. */
static int peer_is_owner(int conn_fd) {
  uid_t peer_uid;
#if defined(__APPLE__)
  gid_t peer_gid;
  if (getpeereid(conn_fd, &peer_uid, &peer_gid) != 0) {
    return 0;
  }
#elif defined(SO_PEERCRED)
  struct ucred cred;
  socklen_t len = sizeof(cred);
  if (getsockopt(conn_fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0) {
    return 0;
  }
  peer_uid = cred.uid;
#else
  /* No peer-credential mechanism: refuse rather than serve blindly. */
  (void)conn_fd;
  return 0;
#endif
  return peer_uid == getuid();
}

/*
 * Handle one connection: one NDJSON request line in, one JSON response line
 * out. Requests are flat objects, e.g.
 *   {"op":"get","service":"anthropic","account":"ANTHROPIC_API_KEY"}
 * Supported ops: ping, get, put, delete. A "get" consults the TTL cache first
 * and only then hits the keystore, which raises the biometric prompt on macOS.
 */
static void handle_connection(int conn_fd) {
  if (!peer_is_owner(conn_fd)) {
    send_line(conn_fd, "{\"ok\":false,\"error\":\"peer-uid-mismatch\"}\n");
    return;
  }

  char line[2048];
  ssize_t n = read(conn_fd, line, sizeof(line) - 1);
  if (n <= 0) {
    return;
  }
  line[n] = '\0';

  char op[32];
  if (!json_field(line, "op", op, sizeof(op))) {
    /* Accept a bare "ping" word too, for a dependency-free liveness probe. */
    if (strncmp(line, "ping", 4) == 0) {
      send_line(conn_fd, "{\"ok\":true,\"pong\":true}\n");
      return;
    }
    send_line(conn_fd, "{\"ok\":false,\"error\":\"bad-request\"}\n");
    return;
  }
  if (strcmp(op, "ping") == 0) {
    send_line(conn_fd, "{\"ok\":true,\"pong\":true}\n");
    return;
  }

  char service[128];
  char account[128];
  if (!json_field(line, "service", service, sizeof(service)) ||
      !json_field(line, "account", account, sizeof(account))) {
    send_line(conn_fd, "{\"ok\":false,\"error\":\"missing-service-or-account\"}\n");
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
      send_line(conn_fd, resp);
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
      send_line(conn_fd, resp);
      /* Don't leave the plaintext secret sitting on the stack. */
      memset(value, 0, sizeof(value));
      memset(escaped, 0, sizeof(escaped));
      return;
    }
    send_keystore_error(conn_fd, rc);
    return;
  }

  if (strcmp(op, "put") == 0) {
    char value[512];
    if (!json_field(line, "value", value, sizeof(value))) {
      send_line(conn_fd, "{\"ok\":false,\"error\":\"missing-value\"}\n");
      return;
    }
    int rc = keystore_put(service, account, value);
    memset(value, 0, sizeof(value));
    if (rc == KEYSTORE_OK) {
      cache_evict(key);
      send_line(conn_fd, "{\"ok\":true,\"stored\":true}\n");
      return;
    }
    send_keystore_error(conn_fd, rc);
    return;
  }

  if (strcmp(op, "delete") == 0) {
    int rc = keystore_delete(service, account);
    if (rc == KEYSTORE_OK) {
      cache_evict(key);
      send_line(conn_fd, "{\"ok\":true,\"deleted\":true}\n");
      return;
    }
    send_keystore_error(conn_fd, rc);
    return;
  }

  send_line(conn_fd, "{\"ok\":false,\"error\":\"unknown-op\"}\n");
}

/* Remove the socket + pidfile so a clean restart can re-bind. */
static void cleanup(void) {
  unlink(g_sock_path);
  unlink(g_pid_path);
}

static void on_signal(int signo) {
  (void)signo;
  cleanup();
  _exit(0);
}

/*
 * Claim the single-instance lock. The pidfile is created O_CREAT|O_EXCL, so the
 * exclusive create IS the lock. If it already exists we check whether the named
 * process is still alive: a live pid means another daemon owns the socket
 * (refuse); a dead pid means a stale file from a crash (reclaim it).
 */
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
  write(fd, buf, (size_t)len);
  close(fd);
  return 0;
}

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

  /* Auto-exit when idle: SIGALRM after idle_seconds with no connection. Each
   * accepted connection resets the countdown; 0 disables it entirely. */
  const char* idle_env = getenv("PROTEUS_IDLE_SECONDS");
  unsigned int idle_seconds =
      idle_env ? (unsigned int)atoi(idle_env) : PROTEUS_DEFAULT_IDLE_SECONDS;

  fprintf(stdout, "daemon started pid=%ld sock=%s\n", (long)getpid(),
          g_sock_path);
  fflush(stdout);

  alarm(idle_seconds);
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
    alarm(idle_seconds);
  }

  cleanup();
  return 0;
}
