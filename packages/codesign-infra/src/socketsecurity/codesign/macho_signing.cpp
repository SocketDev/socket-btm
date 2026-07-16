/**
 * macho_signing.cpp — ad-hoc Mach-O code signing (phase 1).
 *
 * Builds the embedded signature Apple's `codesign -s -` produces and lays it into
 * `__LINKEDIT`: a CodeDirectory (per-4KiB-page SHA-256 hashes of the file up to the
 * code limit, the `adhoc` flag set) wrapped in a `CSMAGIC_EMBEDDED_SIGNATURE`
 * SuperBlob, with `LC_CODE_SIGNATURE` pointing at it. Verified end-to-end with
 * Apple's `codesign -v` (the contract).
 *
 * Code-signing on-disk structures are BIG-ENDIAN; Mach-O headers/load commands are
 * host-endian (little, for the 64-bit LE targets this handles). SHA-256 is
 * BoringSSL — never hand-rolled. Port reference: apple-codesign
 * src/code_directory.rs + src/embedded_signature.rs + src/macho_signing.rs.
 */

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <string>
#include <vector>

#include <openssl/bytestring.h>
#include <openssl/digest.h>
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <openssl/pkcs12.h>
#include <openssl/sha.h>
#include <openssl/x509.h>

namespace codesign {

namespace {

// Code Signing magics / constants (see Apple cs_blobs.h).
constexpr uint32_t CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
constexpr uint32_t CSMAGIC_CODEDIRECTORY = 0xfade0c02;
constexpr uint32_t CSMAGIC_BLOBWRAPPER = 0xfade0b01;  // wraps the CMS signature
constexpr uint32_t CSSLOT_CODEDIRECTORY = 0;
constexpr uint32_t CSSLOT_SIGNATURESLOT = 0x10000;
constexpr uint32_t CS_ADHOC = 0x0000'0002;
constexpr uint8_t CS_HASHTYPE_SHA256 = 2;
constexpr uint32_t CD_VERSION = 0x0002'0400;  // supports execSegment fields
constexpr uint8_t CS_PAGE_SHIFT = 12;         // 4096-byte code pages
constexpr size_t CS_PAGE_SIZE = 1u << CS_PAGE_SHIFT;
constexpr size_t SHA256_LEN = 32;

// Mach-O constants.
constexpr uint32_t MH_MAGIC_64 = 0xfeed'facf;
constexpr uint32_t LC_SEGMENT_64 = 0x19;
constexpr uint32_t LC_CODE_SIGNATURE = 0x1d;

uint32_t rd_u32_le(const uint8_t* p) {
  return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24;
}
uint64_t rd_u64_le(const uint8_t* p) {
  uint64_t v = 0;
  for (int i = 7; i >= 0; --i) {
    v = (v << 8) | p[i];
  }
  return v;
}
void wr_u32_le(uint8_t* p, uint32_t v) {
  p[0] = v & 0xff;
  p[1] = (v >> 8) & 0xff;
  p[2] = (v >> 16) & 0xff;
  p[3] = (v >> 24) & 0xff;
}
void wr_u64_le(uint8_t* p, uint64_t v) {
  for (int i = 0; i < 8; ++i) {
    p[i] = (v >> (8 * i)) & 0xff;
  }
}
// Code-signing fields are big-endian. Append helpers onto a byte vector.
void push_be32(std::vector<uint8_t>& v, uint32_t x) {
  v.push_back((x >> 24) & 0xff);
  v.push_back((x >> 16) & 0xff);
  v.push_back((x >> 8) & 0xff);
  v.push_back(x & 0xff);
}
void push_be64(std::vector<uint8_t>& v, uint64_t x) {
  for (int i = 7; i >= 0; --i) {
    v.push_back((x >> (8 * i)) & 0xff);
  }
}

struct Layout {
  size_t linkedit_lc_off = 0;  // byte offset of __LINKEDIT's LC_SEGMENT_64
  uint64_t linkedit_fileoff = 0;
  uint64_t linkedit_vmaddr = 0;
  size_t text_lc_off = SIZE_MAX;
  uint64_t text_filesize = 0;
  size_t sig_lc_off = SIZE_MAX;  // existing LC_CODE_SIGNATURE, if any
  uint64_t sig_dataoff = 0;
  bool have_sig = false;
};

// Walk the load commands recording the anchors the signer needs.
bool read_layout(const uint8_t* m, size_t len, Layout& out, std::string& err) {
  if (len < 32 || rd_u32_le(m) != MH_MAGIC_64) {
    err = "not a 64-bit little-endian Mach-O";
    return false;
  }
  uint32_t ncmds = rd_u32_le(m + 16);
  size_t off = 32;
  bool have_le = false;
  for (uint32_t i = 0; i < ncmds; ++i) {
    if (off + 8 > len) {
      err = "load commands run past end of file";
      return false;
    }
    uint32_t cmd = rd_u32_le(m + off);
    uint32_t cmdsize = rd_u32_le(m + off + 4);
    if (cmdsize < 8 || off + cmdsize > len) {
      err = "malformed load command";
      return false;
    }
    if (cmd == LC_SEGMENT_64) {
      const uint8_t* seg = m + off + 8;  // segname[16]
      if (std::memcmp(seg, "__LINKEDIT", 11) == 0) {
        out.linkedit_lc_off = off;
        out.linkedit_vmaddr = rd_u64_le(m + off + 24);
        out.linkedit_fileoff = rd_u64_le(m + off + 40);
        have_le = true;
      } else if (std::memcmp(seg, "__TEXT", 7) == 0) {
        out.text_lc_off = off;
        out.text_filesize = rd_u64_le(m + off + 48);  // filesize
      }
    } else if (cmd == LC_CODE_SIGNATURE) {
      out.sig_lc_off = off;
      out.sig_dataoff = rd_u32_le(m + off + 8);
      out.have_sig = true;
    }
    off += cmdsize;
  }
  if (!have_le) {
    err = "no __LINKEDIT segment";
    return false;
  }
  return true;
}

// Build the CodeDirectory blob over code[0, code_limit). `flags` is CS_ADHOC for an
// ad-hoc signature, 0 for a certificate signature.
std::vector<uint8_t> build_code_directory(const uint8_t* code, uint64_t code_limit,
                                          const std::string& ident, uint64_t exec_limit,
                                          uint32_t flags) {
  uint32_t n_code_slots = uint32_t((code_limit + CS_PAGE_SIZE - 1) / CS_PAGE_SIZE);
  uint32_t ident_off = 88;  // fixed header size for version 0x20400
  uint32_t hash_off = ident_off + uint32_t(ident.size()) + 1;
  uint32_t length = hash_off + n_code_slots * uint32_t(SHA256_LEN);

  std::vector<uint8_t> cd;
  cd.reserve(length);
  push_be32(cd, CSMAGIC_CODEDIRECTORY);
  push_be32(cd, length);
  push_be32(cd, CD_VERSION);
  push_be32(cd, flags);               // flags
  push_be32(cd, hash_off);            // hashOffset (first code slot)
  push_be32(cd, ident_off);           // identOffset
  push_be32(cd, 0);                   // nSpecialSlots
  push_be32(cd, n_code_slots);        // nCodeSlots
  push_be32(cd, uint32_t(code_limit));// codeLimit
  cd.push_back(uint8_t(SHA256_LEN));  // hashSize
  cd.push_back(CS_HASHTYPE_SHA256);   // hashType
  cd.push_back(0);                    // platform
  cd.push_back(CS_PAGE_SHIFT);        // pageSize (log2)
  push_be32(cd, 0);                   // spare2
  push_be32(cd, 0);                   // scatterOffset (0x20100+)
  push_be32(cd, 0);                   // teamOffset (0x20200+)
  push_be32(cd, 0);                   // spare3 (0x20300+)
  push_be64(cd, 0);                   // codeLimit64
  push_be64(cd, 0);                   // execSegBase (0x20400+)
  push_be64(cd, exec_limit);          // execSegLimit
  push_be64(cd, 0);                   // execSegFlags (0 = not a main executable)
  // identifier (null-terminated)
  cd.insert(cd.end(), ident.begin(), ident.end());
  cd.push_back(0);
  // code page hashes
  for (uint32_t s = 0; s < n_code_slots; ++s) {
    uint64_t start = uint64_t(s) * CS_PAGE_SIZE;
    size_t plen = size_t(std::min<uint64_t>(CS_PAGE_SIZE, code_limit - start));
    uint8_t digest[SHA256_LEN];
    SHA256(code + start, plen, digest);
    cd.insert(cd.end(), digest, digest + SHA256_LEN);
  }
  return cd;
}

}  // namespace

// Ad-hoc sign `macho`; on success `out` holds the freshly signed image.
int adhoc_sign_macho(const uint8_t* macho, size_t len, const std::string& identifier,
                     std::vector<uint8_t>& out, std::string& err) {
  Layout lay;
  if (!read_layout(macho, len, lay, err)) {
    return -1;
  }

  // Sign everything up to where the signature will sit. If one already exists, it
  // sat at sig_dataoff (replace it); otherwise the signature goes at end of file.
  uint64_t code_limit = lay.have_sig ? lay.sig_dataoff : uint64_t(len);
  if (code_limit > len) {
    err = "code signature offset past end of file";
    return -1;
  }

  if (!lay.have_sig) {
    err = "input has no LC_CODE_SIGNATURE; phase 1 re-signs an existing slot "
          "(adding one needs header slack — staged for the binject seam)";
    return -1;
  }

  // The signed image is the bytes up to code_limit plus the appended SuperBlob.
  out.assign(macho, macho + code_limit);

  // Sizes are known before the hashes: the CodeDirectory header is fixed (88), the
  // identifier is null-terminated, and there are nCodeSlots SHA-256 slots. The
  // SuperBlob wraps it with a 12-byte header + one 8-byte index.
  uint32_t n_code_slots = uint32_t((code_limit + CS_PAGE_SIZE - 1) / CS_PAGE_SIZE);
  uint32_t cd_len = 88 + uint32_t(identifier.size()) + 1 + n_code_slots * uint32_t(SHA256_LEN);
  uint32_t sb_header = 12 + 8;
  uint32_t sb_len = sb_header + cd_len;

  // Patch __LINKEDIT to cover the signature and refresh LC_CODE_SIGNATURE BEFORE
  // hashing — the CodeDirectory must hash the FINAL bytes of the code region
  // (these header edits live inside [0, code_limit)), or codesign reports the code
  // as modified.
  uint64_t new_le_filesize = code_limit - lay.linkedit_fileoff + sb_len;
  uint64_t new_le_vmsize = (new_le_filesize + 0x3fff) & ~uint64_t(0x3fff);  // 16K round
  wr_u64_le(out.data() + lay.linkedit_lc_off + 48, new_le_filesize);  // filesize
  wr_u64_le(out.data() + lay.linkedit_lc_off + 32, new_le_vmsize);    // vmsize
  wr_u32_le(out.data() + lay.sig_lc_off + 8, uint32_t(code_limit));   // dataoff
  wr_u32_le(out.data() + lay.sig_lc_off + 12, sb_len);                // datasize

  // Now hash the patched code region and assemble the signature.
  std::vector<uint8_t> cd =
      build_code_directory(out.data(), code_limit, identifier, lay.text_filesize, CS_ADHOC);

  std::vector<uint8_t> sb;
  sb.reserve(sb_len);
  push_be32(sb, CSMAGIC_EMBEDDED_SIGNATURE);
  push_be32(sb, sb_len);
  push_be32(sb, 1);          // count
  push_be32(sb, CSSLOT_CODEDIRECTORY);
  push_be32(sb, sb_header);  // offset to the CD
  sb.insert(sb.end(), cd.begin(), cd.end());

  out.insert(out.end(), sb.begin(), sb.end());
  return 0;
}

namespace {

// OID content octets (the value after the 0x06 tag + length).
const uint8_t OID_SIGNED_DATA[] = {0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02};
const uint8_t OID_DATA[] = {0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01};
const uint8_t OID_SHA256[] = {0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01};
const uint8_t OID_RSA[] = {0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01};
const uint8_t OID_ATTR_CONTENT_TYPE[] = {0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x03};
const uint8_t OID_ATTR_MESSAGE_DIGEST[] = {0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04};
// Apple cdHashes attributes: 1.2.840.113635.100.9.1 (legacy plist of 20-byte
// truncated cdhashes) and .9.2 (DER: SEQUENCE { digestAlg, OCTET STRING }). The
// notary service checks these; codesign also validates them when present.
const uint8_t OID_CD_HASHES_PLIST[] = {0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x09, 0x01};
const uint8_t OID_CD_HASHES[] = {0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x09, 0x02};

// Standard base64 with padding (for the cdhashes plist <data> element).
std::string base64(const uint8_t* d, size_t n) {
  static const char* kT =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string o;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t v = uint32_t(d[i]) << 16;
    if (i + 1 < n) {
      v |= uint32_t(d[i + 1]) << 8;
    }
    if (i + 2 < n) {
      v |= d[i + 2];
    }
    o += kT[(v >> 18) & 63];
    o += kT[(v >> 12) & 63];
    o += (i + 1 < n) ? kT[(v >> 6) & 63] : '=';
    o += (i + 2 < n) ? kT[v & 63] : '=';
  }
  return o;
}

#define CBB_OK(x)              \
  do {                         \
    if (!(x)) {                \
      return false;            \
    }                          \
  } while (0)

// Add an AlgorithmIdentifier SEQUENCE { OID } (params absent, per RFC 5754 for SHA-2).
bool add_alg_id(CBB* parent, const uint8_t* oid, size_t oid_len, bool null_params) {
  CBB alg, oid_cbb;
  CBB_OK(CBB_add_asn1(parent, &alg, CBS_ASN1_SEQUENCE));
  CBB_OK(CBB_add_asn1(&alg, &oid_cbb, CBS_ASN1_OBJECT));
  CBB_OK(CBB_add_bytes(&oid_cbb, oid, oid_len));
  if (null_params) {
    CBB null;
    CBB_OK(CBB_add_asn1(&alg, &null, CBS_ASN1_NULL));
  }
  return CBB_flush(parent) == 1;
}

// One Attribute SEQUENCE { OID, SET { value } } as standalone DER.
bool build_attribute(const uint8_t* oid, size_t oid_len, unsigned val_tag, const uint8_t* val,
                     size_t val_len, std::vector<uint8_t>& der) {
  CBB cbb;
  if (!CBB_init(&cbb, 64)) {
    return false;
  }
  bool ok = [&]() -> bool {
    CBB attr, oid_cbb, set, val_cbb;
    CBB_OK(CBB_add_asn1(&cbb, &attr, CBS_ASN1_SEQUENCE));
    CBB_OK(CBB_add_asn1(&attr, &oid_cbb, CBS_ASN1_OBJECT));
    CBB_OK(CBB_add_bytes(&oid_cbb, oid, oid_len));
    CBB_OK(CBB_add_asn1(&attr, &set, CBS_ASN1_SET));
    CBB_OK(CBB_add_asn1(&set, &val_cbb, val_tag));
    CBB_OK(CBB_add_bytes(&val_cbb, val, val_len));
    return CBB_flush(&cbb) == 1;
  }();
  if (ok) {
    uint8_t* p = nullptr;
    size_t n = 0;
    ok = CBB_finish(&cbb, &p, &n) == 1;
    if (ok) {
      der.assign(p, p + n);
      OPENSSL_free(p);
    }
  }
  if (!ok) {
    CBB_cleanup(&cbb);
  }
  return ok;
}

// Hand-build the detached CMS SignedData over `cd` — BoringSSL's CMS_sign can embed
// neither certs nor signed attributes, both of which Apple requires.
bool build_cms_signature(const std::vector<uint8_t>& cd, X509* cert, EVP_PKEY* pkey,
                         STACK_OF(X509) * chain, std::vector<uint8_t>& out_der, std::string& err) {
  // messageDigest signed attribute = SHA-256 of the primary CodeDirectory.
  uint8_t cd_digest[SHA256_LEN];
  SHA256(cd.data(), cd.size(), cd_digest);

  // The two mandatory signed attributes (RFC 5652 §5.3): contentType=id-data and
  // messageDigest. Sorted as a DER SET OF (ascending by encoded bytes).
  std::vector<uint8_t> a_ct, a_md;
  if (!build_attribute(OID_ATTR_CONTENT_TYPE, sizeof OID_ATTR_CONTENT_TYPE, CBS_ASN1_OBJECT,
                       OID_DATA, sizeof OID_DATA, a_ct) ||
      !build_attribute(OID_ATTR_MESSAGE_DIGEST, sizeof OID_ATTR_MESSAGE_DIGEST,
                       CBS_ASN1_OCTETSTRING, cd_digest, SHA256_LEN, a_md)) {
    err = "building signed attributes failed";
    return false;
  }

  // Apple cdHashes (9.1): OCTET STRING of an XML plist carrying the 20-byte
  // truncated cdhash; the notary service checks it.
  std::string b64 = base64(cd_digest, 20);
  std::string plist =
      "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
      "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" "
      "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
      "<plist version=\"1.0\">\n<dict>\n\t<key>cdhashes</key>\n\t<array>\n\t<data>\n\t" +
      b64 + "\n\t</data>\n\t</array>\n</dict>\n</plist>\n";
  std::vector<uint8_t> a_plist;
  if (!build_attribute(OID_CD_HASHES_PLIST, sizeof OID_CD_HASHES_PLIST, CBS_ASN1_OCTETSTRING,
                       reinterpret_cast<const uint8_t*>(plist.data()), plist.size(), a_plist)) {
    err = "building cdhashes plist attribute failed";
    return false;
  }

  // Apple cdHashes (9.2): SEQUENCE { sha256-OID, OCTET STRING(full CD digest) }.
  std::vector<uint8_t> inner;  // the two elements; build_attribute wraps them in SEQUENCE
  {
    CBB cbb, oid_cbb, oct;
    if (!CBB_init(&cbb, 64)) {
      err = "cdhashes der CBB_init failed";
      return false;
    }
    bool built = CBB_add_asn1(&cbb, &oid_cbb, CBS_ASN1_OBJECT) &&
                 CBB_add_bytes(&oid_cbb, OID_SHA256, sizeof OID_SHA256) &&
                 CBB_add_asn1(&cbb, &oct, CBS_ASN1_OCTETSTRING) &&
                 CBB_add_bytes(&oct, cd_digest, SHA256_LEN) && CBB_flush(&cbb) == 1;
    uint8_t* ip = nullptr;
    size_t in = 0;
    if (!built || CBB_finish(&cbb, &ip, &in) != 1) {
      CBB_cleanup(&cbb);
      err = "cdhashes der inner build failed";
      return false;
    }
    inner.assign(ip, ip + in);
    OPENSSL_free(ip);
  }
  std::vector<uint8_t> a_der;
  if (!build_attribute(OID_CD_HASHES, sizeof OID_CD_HASHES, CBS_ASN1_SEQUENCE, inner.data(),
                       inner.size(), a_der)) {
    err = "building cdhashes der attribute failed";
    return false;
  }

  std::vector<std::vector<uint8_t>> attrs = {a_ct, a_md, a_plist, a_der};
  std::sort(attrs.begin(), attrs.end());

  // The bytes to SIGN: the attributes wrapped in an explicit SET OF (tag 0x31) —
  // the CMS signing form, distinct from the [0] IMPLICIT tag used in the SignerInfo.
  std::vector<uint8_t> to_sign;
  {
    CBB cbb, set;
    if (!CBB_init(&cbb, 256) || !CBB_add_asn1(&cbb, &set, CBS_ASN1_SET)) {
      CBB_cleanup(&cbb);
      err = "attrs SET build failed";
      return false;
    }
    for (const auto& a : attrs) {
      if (!CBB_add_bytes(&set, a.data(), a.size())) {
        CBB_cleanup(&cbb);
        err = "attrs SET append failed";
        return false;
      }
    }
    uint8_t* p = nullptr;
    size_t n = 0;
    if (CBB_finish(&cbb, &p, &n) != 1) {
      err = "attrs SET finish failed";
      return false;
    }
    to_sign.assign(p, p + n);
    OPENSSL_free(p);
  }

  // Sign with SHA-256 (RSA PKCS#1 v1.5 via EVP_DigestSign).
  std::vector<uint8_t> signature;
  {
    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    if (!ctx) {
      err = "EVP_MD_CTX_new failed";
      return false;
    }
    size_t siglen = 0;
    bool ok = EVP_DigestSignInit(ctx, nullptr, EVP_sha256(), nullptr, pkey) == 1 &&
              EVP_DigestSign(ctx, nullptr, &siglen, to_sign.data(), to_sign.size()) == 1;
    if (ok) {
      signature.resize(siglen);
      ok = EVP_DigestSign(ctx, signature.data(), &siglen, to_sign.data(), to_sign.size()) == 1;
      signature.resize(siglen);
    }
    EVP_MD_CTX_free(ctx);
    if (!ok) {
      err = "EVP_DigestSign failed (RSA keys only)";
      return false;
    }
  }

  // Issuer + serial for the SignerInfo sid (full DER elements from the cert).
  uint8_t* issuer_der = nullptr;
  int issuer_len = i2d_X509_NAME(X509_get_issuer_name(cert), &issuer_der);
  uint8_t* serial_der = nullptr;
  int serial_len = i2d_ASN1_INTEGER(X509_get_serialNumber(cert), &serial_der);
  if (issuer_len <= 0 || serial_len <= 0) {
    OPENSSL_free(issuer_der);
    OPENSSL_free(serial_der);
    err = "encoding issuer/serial failed";
    return false;
  }

  // Assemble the ContentInfo { id-signedData, [0] SignedData }.
  CBB cbb;
  if (!CBB_init(&cbb, 4096)) {
    OPENSSL_free(issuer_der);
    OPENSSL_free(serial_der);
    err = "CBB_init failed";
    return false;
  }
  bool ok = [&]() -> bool {
    CBB ci, ci_oid, content, sd;
    CBB_OK(CBB_add_asn1(&cbb, &ci, CBS_ASN1_SEQUENCE));
    CBB_OK(CBB_add_asn1(&ci, &ci_oid, CBS_ASN1_OBJECT));
    CBB_OK(CBB_add_bytes(&ci_oid, OID_SIGNED_DATA, sizeof OID_SIGNED_DATA));
    CBB_OK(CBB_add_asn1(&ci, &content, CBS_ASN1_CONTEXT_SPECIFIC | CBS_ASN1_CONSTRUCTED | 0));
    CBB_OK(CBB_add_asn1(&content, &sd, CBS_ASN1_SEQUENCE));
    // version = 1
    CBB ver;
    CBB_OK(CBB_add_asn1(&sd, &ver, CBS_ASN1_INTEGER));
    CBB_OK(CBB_add_u8(&ver, 1));
    // digestAlgorithms SET { sha256 }
    CBB digs;
    CBB_OK(CBB_add_asn1(&sd, &digs, CBS_ASN1_SET));
    CBB_OK(add_alg_id(&digs, OID_SHA256, sizeof OID_SHA256, /*null_params=*/false));
    // encapContentInfo SEQ { id-data } (detached: no eContent)
    CBB eci, eci_oid;
    CBB_OK(CBB_add_asn1(&sd, &eci, CBS_ASN1_SEQUENCE));
    CBB_OK(CBB_add_asn1(&eci, &eci_oid, CBS_ASN1_OBJECT));
    CBB_OK(CBB_add_bytes(&eci_oid, OID_DATA, sizeof OID_DATA));
    // certificates [0] IMPLICIT SET OF Certificate
    CBB certs;
    CBB_OK(CBB_add_asn1(&sd, &certs, CBS_ASN1_CONTEXT_SPECIFIC | CBS_ASN1_CONSTRUCTED | 0));
    {
      uint8_t* leaf = nullptr;
      int leaf_len = i2d_X509(cert, &leaf);
      if (leaf_len <= 0) {
        return false;
      }
      bool added = CBB_add_bytes(&certs, leaf, size_t(leaf_len)) == 1;
      OPENSSL_free(leaf);
      CBB_OK(added);
      if (chain) {
        for (size_t i = 0; i < size_t(sk_X509_num(chain)); ++i) {
          uint8_t* c = nullptr;
          int cl = i2d_X509(sk_X509_value(chain, int(i)), &c);
          if (cl <= 0) {
            return false;
          }
          bool a = CBB_add_bytes(&certs, c, size_t(cl)) == 1;
          OPENSSL_free(c);
          CBB_OK(a);
        }
      }
    }
    // signerInfos SET { one SignerInfo }
    CBB sis, si;
    CBB_OK(CBB_add_asn1(&sd, &sis, CBS_ASN1_SET));
    CBB_OK(CBB_add_asn1(&sis, &si, CBS_ASN1_SEQUENCE));
    CBB siver;
    CBB_OK(CBB_add_asn1(&si, &siver, CBS_ASN1_INTEGER));
    CBB_OK(CBB_add_u8(&siver, 1));  // version 1 = issuerAndSerialNumber
    // sid = IssuerAndSerialNumber SEQ { issuer Name, serial INTEGER }
    CBB sid;
    CBB_OK(CBB_add_asn1(&si, &sid, CBS_ASN1_SEQUENCE));
    CBB_OK(CBB_add_bytes(&sid, issuer_der, size_t(issuer_len)));
    CBB_OK(CBB_add_bytes(&sid, serial_der, size_t(serial_len)));
    // digestAlgorithm sha256
    CBB_OK(add_alg_id(&si, OID_SHA256, sizeof OID_SHA256, /*null_params=*/false));
    // signedAttrs [0] IMPLICIT (same content as `attrs`, tagged 0xa0)
    CBB sa;
    CBB_OK(CBB_add_asn1(&si, &sa, CBS_ASN1_CONTEXT_SPECIFIC | CBS_ASN1_CONSTRUCTED | 0));
    for (const auto& a : attrs) {
      CBB_OK(CBB_add_bytes(&sa, a.data(), a.size()));
    }
    // signatureAlgorithm rsaEncryption (NULL params). RSA only: BoringSSL's
    // PKCS12_parse can't extract an EC private key (a valid EC .p12 that LibreSSL
    // reads fails PKCS12_parse), so an EC identity can't even be loaded to sign with
    // — ECDSA is blocked upstream at identity load, not in the signing path. See
    // docs/ports/codesign-infra-lockstep.md.
    CBB_OK(add_alg_id(&si, OID_RSA, sizeof OID_RSA, /*null_params=*/true));
    // signature OCTET STRING
    CBB sig;
    CBB_OK(CBB_add_asn1(&si, &sig, CBS_ASN1_OCTETSTRING));
    CBB_OK(CBB_add_bytes(&sig, signature.data(), signature.size()));
    return CBB_flush(&cbb) == 1;
  }();
  OPENSSL_free(issuer_der);
  OPENSSL_free(serial_der);
  if (!ok) {
    CBB_cleanup(&cbb);
    err = "assembling CMS ContentInfo failed";
    return false;
  }
  uint8_t* p = nullptr;
  size_t n = 0;
  if (CBB_finish(&cbb, &p, &n) != 1) {
    err = "CBB_finish failed";
    return false;
  }
  out_der.assign(p, p + n);
  OPENSSL_free(p);
  return true;
}

}  // namespace

// Certificate (Developer-ID) sign a 64-bit Mach-O with a PKCS#12 identity. Re-signs
// an existing signature slot; the CodeDirectory carries flags=0 and the hand-built
// CMS SignedData fills CSSLOT_SIGNATURESLOT.
int identity_sign_macho(const uint8_t* macho, size_t len, const std::string& identifier,
                        const uint8_t* p12, size_t p12_len, const char* passphrase,
                        std::vector<uint8_t>& out, std::string& err) {
  Layout lay;
  if (!read_layout(macho, len, lay, err)) {
    return -1;
  }
  if (!lay.have_sig) {
    err = "input has no LC_CODE_SIGNATURE slot to re-sign";
    return -1;
  }

  const uint8_t* pp = p12;
  PKCS12* p = d2i_PKCS12(nullptr, &pp, long(p12_len));
  if (!p) {
    err = "d2i_PKCS12 failed (not a PKCS#12 blob)";
    return -1;
  }
  EVP_PKEY* pkey = nullptr;
  X509* cert = nullptr;
  STACK_OF(X509)* chain = nullptr;
  int parsed = PKCS12_parse(p, passphrase ? passphrase : "", &pkey, &cert, &chain);
  PKCS12_free(p);
  if (!parsed || !pkey || !cert) {
    err = "PKCS12_parse failed (wrong passphrase or no key/cert)";
    return -1;
  }

  uint64_t code_limit = lay.sig_dataoff;
  out.assign(macho, macho + code_limit);

  // Reserve a generous, fixed signature size (the SuperBlob + the variable CMS).
  uint32_t n_code_slots = uint32_t((code_limit + CS_PAGE_SIZE - 1) / CS_PAGE_SIZE);
  uint32_t cd_len = 88 + uint32_t(identifier.size()) + 1 + n_code_slots * uint32_t(SHA256_LEN);
  size_t cert_bytes = size_t(i2d_X509(cert, nullptr) > 0 ? i2d_X509(cert, nullptr) : 0);
  if (chain) {
    for (size_t i = 0; i < size_t(sk_X509_num(chain)); ++i) {
      int n = i2d_X509(sk_X509_value(chain, int(i)), nullptr);
      if (n > 0) {
        cert_bytes += size_t(n);
      }
    }
  }
  uint32_t cms_reserve = uint32_t((cert_bytes + 4096 + 15) & ~size_t(15));
  uint32_t sig_reserved = 12 + 16 + cd_len + 8 + cms_reserve;

  uint64_t new_le_filesize = code_limit - lay.linkedit_fileoff + sig_reserved;
  uint64_t new_le_vmsize = (new_le_filesize + 0x3fff) & ~uint64_t(0x3fff);
  wr_u64_le(out.data() + lay.linkedit_lc_off + 48, new_le_filesize);
  wr_u64_le(out.data() + lay.linkedit_lc_off + 32, new_le_vmsize);
  wr_u32_le(out.data() + lay.sig_lc_off + 8, uint32_t(code_limit));
  wr_u32_le(out.data() + lay.sig_lc_off + 12, sig_reserved);

  std::vector<uint8_t> cd =
      build_code_directory(out.data(), code_limit, identifier, lay.text_filesize, 0);

  std::vector<uint8_t> cms_der;
  bool ok = build_cms_signature(cd, cert, pkey, chain, cms_der, err);
  EVP_PKEY_free(pkey);
  X509_free(cert);
  if (chain) {
    sk_X509_pop_free(chain, X509_free);
  }
  if (!ok) {
    return -1;
  }

  std::vector<uint8_t> sigblob;
  push_be32(sigblob, CSMAGIC_BLOBWRAPPER);
  push_be32(sigblob, uint32_t(8 + cms_der.size()));
  sigblob.insert(sigblob.end(), cms_der.begin(), cms_der.end());

  uint32_t sb_header = 12 + 2 * 8;
  uint32_t cd_off = sb_header;
  uint32_t sig_off = sb_header + uint32_t(cd.size());
  uint32_t sb_len = sig_off + uint32_t(sigblob.size());
  if (sb_len > sig_reserved) {
    err = "signature larger than the reserved size";
    return -1;
  }
  std::vector<uint8_t> sb;
  push_be32(sb, CSMAGIC_EMBEDDED_SIGNATURE);
  push_be32(sb, sb_len);
  push_be32(sb, 2);
  push_be32(sb, CSSLOT_CODEDIRECTORY);
  push_be32(sb, cd_off);
  push_be32(sb, CSSLOT_SIGNATURESLOT);
  push_be32(sb, sig_off);
  sb.insert(sb.end(), cd.begin(), cd.end());
  sb.insert(sb.end(), sigblob.begin(), sigblob.end());

  out.insert(out.end(), sb.begin(), sb.end());
  out.resize(out.size() + (sig_reserved - sb_len), 0);
  return 0;
}

// Verify the embedded CodeDirectory hashes match the file (phase 3): parse the
// SuperBlob → CodeDirectory, re-hash each code page, compare to the stored slot
// hashes. A structural seal check (no CMS signature-chain trust — that is
// `codesign -v`'s job for cert signatures). Returns 0 if the seal holds.
int verify_macho(const uint8_t* macho, size_t len, std::string& err) {
  Layout lay;
  if (!read_layout(macho, len, lay, err)) {
    return -1;
  }
  if (!lay.have_sig) {
    err = "no code signature to verify";
    return -1;
  }
  auto be32 = [&](size_t o) -> uint32_t {
    return uint32_t(macho[o]) << 24 | uint32_t(macho[o + 1]) << 16 | uint32_t(macho[o + 2]) << 8 |
           uint32_t(macho[o + 3]);
  };
  size_t sb = size_t(lay.sig_dataoff);
  if (sb + 12 > len || be32(sb) != CSMAGIC_EMBEDDED_SIGNATURE) {
    err = "not an embedded-signature SuperBlob at LC_CODE_SIGNATURE";
    return -1;
  }
  uint32_t count = be32(sb + 8);
  size_t cd_off = 0;
  for (uint32_t i = 0; i < count; ++i) {
    size_t idx = sb + 12 + size_t(i) * 8;
    if (idx + 8 > len) {
      err = "truncated SuperBlob index";
      return -1;
    }
    if (be32(idx) == CSSLOT_CODEDIRECTORY) {
      cd_off = sb + be32(idx + 4);
      break;
    }
  }
  if (!cd_off || cd_off + 44 > len || be32(cd_off) != CSMAGIC_CODEDIRECTORY) {
    err = "no CodeDirectory in the signature";
    return -1;
  }
  uint32_t hash_off = be32(cd_off + 16);
  uint32_t n_code = be32(cd_off + 28);
  uint32_t code_limit = be32(cd_off + 32);
  uint8_t hash_size = macho[cd_off + 36];
  uint8_t hash_type = macho[cd_off + 37];
  uint8_t page_shift = macho[cd_off + 39];
  if (hash_type != CS_HASHTYPE_SHA256 || hash_size != SHA256_LEN) {
    err = "unsupported hash type (SHA-256 only)";
    return -1;
  }
  if (code_limit > len || page_shift == 0 || page_shift > 30) {
    err = "CodeDirectory codeLimit/pageSize out of range";
    return -1;
  }
  size_t page = size_t(1) << page_shift;
  for (uint32_t s = 0; s < n_code; ++s) {
    size_t start = size_t(s) * page;
    if (start > code_limit) {
      err = "code slot past code limit";
      return -1;
    }
    size_t plen = std::min(page, size_t(code_limit) - start);
    uint8_t dg[SHA256_LEN];
    SHA256(macho + start, plen, dg);
    size_t hpos = cd_off + hash_off + size_t(s) * hash_size;
    if (hpos + hash_size > len || std::memcmp(dg, macho + hpos, hash_size) != 0) {
      err = "code hash mismatch (the file was modified after signing)";
      return -1;
    }
  }
  return 0;
}

}  // namespace codesign
