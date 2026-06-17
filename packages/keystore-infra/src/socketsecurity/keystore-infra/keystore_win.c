/*
 * keystore_win.c — the Windows keystore backend, fronting the Windows
 * Credential Manager via the Cred* API. Broker-only (no biometric here; Windows
 * Hello integration is a later step). Stores secrets as generic credentials
 * keyed by a "service/account" target name, behind the shared keystore.h
 * interface so consumers stay platform-agnostic.
 *
 * Wide-string note: the Cred*W APIs take a UTF-16 TargetName, so we convert the
 * UTF-8 service/account inputs with MultiByteToWideChar. The secret VALUE is
 * stored as raw UTF-8 bytes in the credential blob (no conversion), and read
 * back the same way.
 */

#include <windows.h>
#include <wincred.h>

#include <stdlib.h>
#include <string.h>

#include "socketsecurity/keystore-infra/keystore.h"

// Build the UTF-16 target name "service/account" from UTF-8 inputs. Returns a
// heap buffer the caller frees, or NULL on allocation/conversion failure.
static wchar_t* buildTargetName(const char* service, const char* account) {
  size_t serviceLen = strlen(service);
  size_t accountLen = strlen(account);
  char* combined = (char*)malloc(serviceLen + 1 + accountLen + 1);
  if (!combined) {
    return NULL;
  }
  memcpy(combined, service, serviceLen);
  combined[serviceLen] = '/';
  memcpy(combined + serviceLen + 1, account, accountLen);
  combined[serviceLen + 1 + accountLen] = '\0';

  int wideLen = MultiByteToWideChar(CP_UTF8, 0, combined, -1, NULL, 0);
  if (wideLen <= 0) {
    free(combined);
    return NULL;
  }
  wchar_t* wide = (wchar_t*)malloc((size_t)wideLen * sizeof(wchar_t));
  if (wide) {
    MultiByteToWideChar(CP_UTF8, 0, combined, -1, wide, wideLen);
  }
  free(combined);
  return wide;
}

int keystore_get(const char* service, const char* account, char* out,
                 size_t out_len) {
  wchar_t* target = buildTargetName(service, account);
  if (!target) {
    return KEYSTORE_ERR_IO;
  }
  PCREDENTIALW cred = NULL;
  BOOL ok = CredReadW(target, CRED_TYPE_GENERIC, 0, &cred);
  free(target);
  if (!ok) {
    return GetLastError() == ERROR_NOT_FOUND ? KEYSTORE_ERR_NOT_FOUND
                                             : KEYSTORE_ERR_IO;
  }
  DWORD size = cred->CredentialBlobSize;
  if ((size_t)size + 1 > out_len) {
    CredFree(cred);
    return KEYSTORE_ERR_IO;
  }
  memcpy(out, cred->CredentialBlob, size);
  out[size] = '\0';
  CredFree(cred);
  return KEYSTORE_OK;
}

int keystore_put(const char* service, const char* account, const char* value) {
  wchar_t* target = buildTargetName(service, account);
  if (!target) {
    return KEYSTORE_ERR_IO;
  }
  CREDENTIALW cred;
  memset(&cred, 0, sizeof(cred));
  cred.Type = CRED_TYPE_GENERIC;
  cred.TargetName = target;
  cred.CredentialBlobSize = (DWORD)strlen(value);
  // The API takes a non-const blob pointer but does not modify it.
  cred.CredentialBlob = (LPBYTE)value;
  cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
  BOOL ok = CredWriteW(&cred, 0);
  free(target);
  return ok ? KEYSTORE_OK : KEYSTORE_ERR_IO;
}

int keystore_delete(const char* service, const char* account) {
  wchar_t* target = buildTargetName(service, account);
  if (!target) {
    return KEYSTORE_ERR_IO;
  }
  BOOL ok = CredDeleteW(target, CRED_TYPE_GENERIC, 0);
  DWORD err = ok ? 0 : GetLastError();
  free(target);
  // Absent item is success for an idempotent delete.
  if (ok || err == ERROR_NOT_FOUND) {
    return KEYSTORE_OK;
  }
  return KEYSTORE_ERR_IO;
}
