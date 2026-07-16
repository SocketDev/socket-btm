/*
 * keystore_linux.c — the Linux keystore backend, fronting the freedesktop
 * Secret Service (GNOME Keyring / KWallet) via libsecret. Broker-only: Linux
 * has no biometric gate here, the Secret Service daemon owns keyring unlock.
 * Stores secrets as simple passwords keyed by (service, account), matching the
 * macOS backend's interface so consumers (the proteus daemon, the .node addon,
 * the node:smol-keychain builtin) are platform-agnostic.
 */

#include <libsecret/secret.h>

#include <string.h>

#include "socketsecurity/keystore-infra/keystore.h"

// The lookup schema. SECRET_SCHEMA_NONE: don't match against libsecret's own
// reserved schemas, just our two string attributes. The same schema must be
// used for store/lookup/clear so the attributes line up.
static const SecretSchema kSchema = {
    "dev.socket.keystore",
    SECRET_SCHEMA_NONE,
    {
        {"service", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {"account", SECRET_SCHEMA_ATTRIBUTE_STRING},
        {NULL, 0},
    },
    // Reserved padding fields in the SecretSchema struct.
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
};

int keystore_get(const char* service, const char* account, char* out,
                 size_t out_len) {
  GError* error = NULL;
  gchar* password = secret_password_lookup_sync(
      &kSchema, NULL, &error, "service", service, "account", account, NULL);
  if (error != NULL) {
    g_error_free(error);
    return KEYSTORE_ERR_IO;
  }
  if (password == NULL) {
    return KEYSTORE_ERR_NOT_FOUND;
  }
  size_t len = strlen(password);
  if (len + 1 > out_len) {
    secret_password_free(password);
    return KEYSTORE_ERR_IO;
  }
  memcpy(out, password, len + 1);
  // secret_password_free zeroes the secret memory before freeing it.
  secret_password_free(password);
  return KEYSTORE_OK;
}

int keystore_put(const char* service, const char* account, const char* value) {
  GError* error = NULL;
  gboolean stored = secret_password_store_sync(
      &kSchema, SECRET_COLLECTION_DEFAULT, "Socket credential", value, NULL,
      &error, "service", service, "account", account, NULL);
  if (error != NULL) {
    g_error_free(error);
    return KEYSTORE_ERR_IO;
  }
  return stored ? KEYSTORE_OK : KEYSTORE_ERR_IO;
}

int keystore_delete(const char* service, const char* account) {
  GError* error = NULL;
  // Returns FALSE when nothing matched, which is success for an idempotent
  // delete; only a non-NULL error is a real failure.
  secret_password_clear_sync(&kSchema, NULL, &error, "service", service,
                             "account", account, NULL);
  if (error != NULL) {
    g_error_free(error);
    return KEYSTORE_ERR_IO;
  }
  return KEYSTORE_OK;
}
