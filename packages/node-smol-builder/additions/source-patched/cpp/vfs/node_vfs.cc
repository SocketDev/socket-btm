#include "node_vfs.h"

#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "util-inl.h"

// Use the same sentinel fuse as SEA for compatibility
#define POSTJECT_SENTINEL_FUSE "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
#include "postject-api.h"
#undef POSTJECT_SENTINEL_FUSE

#include <memory>
#include <string_view>

using v8::ArrayBuffer;
using v8::BackingStore;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;

namespace node {
namespace smol_vfs {

// Find SOCKSEC_VFS_BLOB resource injected via binject
// Note: Mach-O section names are limited to 16 characters
// VFS data is stored in NODE_SEA segment's __NODE_VFS_BLOB section
static std::string_view FindVFSBlob() {
  static const auto result = []() -> std::string_view {
    size_t size = 0;

    // Configure postject to look in NODE_SEA segment (not default __POSTJECT)
    postject_options options;
    postject_options_init(&options);
    options.macho_segment_name = "NODE_SEA";
    options.macho_section_name = "__NODE_VFS_BLOB";

    const char* blob = static_cast<const char*>(
        postject_find_resource("SOCKSEC_VFS_BLOB",
                               &size,
                               &options));
    if (blob == nullptr || size == 0) {
      return {};
    }

    return {blob, size};
  }();

  return result;
}

bool HasVFSBlob() {
  return !FindVFSBlob().empty();
}

// JavaScript binding: internalBinding('vfs').getVFSBlob()
static void GetVFSBlob(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  std::string_view blob = FindVFSBlob();
  if (blob.empty()) {
    return;  // Return undefined if no VFS blob
  }

  // Create ArrayBuffer with VFS blob data
  std::unique_ptr<BackingStore> backing = ArrayBuffer::NewBackingStore(
      const_cast<char*>(blob.data()),
      blob.size(),
      [](void*, size_t, void*) {
        // No-op deleter since data is static
      },
      nullptr);

  Local<ArrayBuffer> array_buffer = ArrayBuffer::New(isolate, std::move(backing));
  args.GetReturnValue().Set(array_buffer);
}

// JavaScript binding: internalBinding('vfs').hasVFSBlob()
static void HasVFSBlobBinding(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(HasVFSBlob());
}

static void Initialize(Local<Object> target,
                      Local<Value> unused,
                      Local<Context> context,
                      void* priv) {
  SetMethod(context, target, "getVFSBlob", GetVFSBlob);
  SetMethod(context, target, "hasVFSBlob", HasVFSBlobBinding);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(GetVFSBlob);
  registry->Register(HasVFSBlobBinding);
}

}  // namespace smol_vfs
}  // namespace node

// Register as internal binding (like all Node.js bindings)
// Access via process.binding() is enabled by adding to processBindingAllowList
NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_vfs, node::smol_vfs::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(smol_vfs, node::smol_vfs::RegisterExternalReferences)
