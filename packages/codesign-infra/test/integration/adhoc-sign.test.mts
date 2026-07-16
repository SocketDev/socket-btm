/**
 * @file Codesign-infra signing oracle: compile the port against BoringSSL, sign a
 *   real Mach-O (ad-hoc AND certificate), and assert Apple's own `codesign -v`
 *   accepts each. That round-trip IS the contract. Gated on darwin + the
 *   boringssl-builder artifacts + openssl (skips elsewhere — only macOS has
 *   `codesign`, and the port needs libcrypto built).
 */

import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterAll, describe, expect, it } from 'vitest'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  CODESIGN_INCLUDE_ROOT,
  CODESIGN_SRC_DIR,
  PACKAGE_ROOT,
} from '../../lib/paths.mts'

const repoRoot = path.resolve(PACKAGE_ROOT, '..', '..')
const bsslRoot = path.join(
  repoRoot,
  'packages',
  'boringssl-builder',
  'build',
  'dev',
  'darwin-arm64',
)
const libcrypto = path.join(bsslRoot, 'cmake', 'libcrypto.a')
const bsslInclude = path.join(bsslRoot, 'out', 'Final', 'include')

const canRun =
  process.platform === 'darwin' &&
  existsSync(libcrypto) &&
  existsSync(bsslInclude)
const maybe = canRun ? describe : describe.skip

let workDir: string | undefined

afterAll(async () => {
  if (workDir) {
    const { safeDelete } = await import('@socketsecurity/lib-stable/fs/safe')
    await safeDelete(workDir, { force: true })
  }
})

// A signtool exercising the public ABI: `signtool <in> <out> [<p12> <pass>]` —
// ad-hoc with no identity, certificate signing with one.
const DRIVER = `#include "socketsecurity/codesign/codesign.h"
#include <cstdio>
#include <cstdlib>
#include <vector>
static std::vector<unsigned char> slurp(const char* p){FILE*f=fopen(p,"rb");fseek(f,0,SEEK_END);long n=ftell(f);fseek(f,0,SEEK_SET);std::vector<unsigned char>b(n);fread(b.data(),1,n,f);fclose(f);return b;}
#include <cstring>
int main(int c,char**v){
  if(c>=3 && !strcmp(v[1],"--verify")){auto m=slurp(v[2]); int rc=codesign_macho_verify(m.data(),m.size()); if(rc)fprintf(stderr,"%s\\n",codesign_last_error()); return rc?1:0;}
  auto m=slurp(v[1]); unsigned char*o=nullptr; size_t ol=0; int rc;
  if(c>=5){auto p=slurp(v[3]); rc=codesign_macho_identity(m.data(),m.size(),"dev.socket.codesign-infra.test",p.data(),p.size(),v[4],&o,&ol);}
  else { rc=codesign_macho_adhoc(m.data(),m.size(),"dev.socket.codesign-infra.test",&o,&ol); }
  if(rc){fprintf(stderr,"rc=%d: %s\\n",rc,codesign_last_error());return 1;}
  FILE*x=fopen(v[2],"wb");fwrite(o,1,ol,x);fclose(x);codesign_free(o);return 0;}
`

function runOrThrow(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: 'pipe' })
  if (result.status !== 0) {
    throw new Error(
      `${cmd} exited ${result.status}: ${result.stderr || result.stdout}`,
    )
  }
}

async function setup(): Promise<{ signtool: string; sample: string }> {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'codesign-infra-'))
  const driver = path.join(workDir, 'driver.cpp')
  await writeFile(driver, DRIVER)
  const signtool = path.join(workDir, 'signtool')
  runOrThrow('/usr/bin/clang++', [
    '-std=c++17',
    '-DBORINGSSL_PREFIX=smol',
    '-I',
    CODESIGN_INCLUDE_ROOT,
    '-I',
    bsslInclude,
    path.join(CODESIGN_SRC_DIR, 'codesign.cpp'),
    path.join(CODESIGN_SRC_DIR, 'macho_signing.cpp'),
    driver,
    libcrypto,
    '-o',
    signtool,
  ])
  // A real Mach-O with a signature slot (the linker ad-hoc-signs bundles on arm64).
  const src = path.join(workDir, 's.c')
  await writeFile(src, 'int codesign_sample(int a){return a+1;}\n')
  const sample = path.join(workDir, 'sample.node')
  runOrThrow('/usr/bin/clang', ['-bundle', '-o', sample, '-x', 'c', src])
  return { signtool, sample }
}

maybe('codesign-infra signing', () => {
  it('ad-hoc: produces a signature Apple codesign -v accepts', async () => {
    const { sample, signtool } = await setup()
    const signed = path.join(workDir!, 'adhoc.node')
    runOrThrow(signtool, [sample, signed])
    const result = spawnSync('/usr/bin/codesign', ['-v', signed], {
      stdio: 'pipe',
    })
    expect(result.status).toBe(0)
  })

  it('certificate: CMS-signs with a PKCS#12 identity; codesign -v accepts', async () => {
    const { sample, signtool } = await setup()
    // Self-signed identity with the attributes codesign's policy requires.
    const cnf = path.join(workDir!, 'cert.cnf')
    await writeFile(
      cnf,
      '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=codesign-infra-test\n' +
        '[v3]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' +
        'extendedKeyUsage=critical,codeSigning\n',
    )
    const key = path.join(workDir!, 'key.pem')
    const cert = path.join(workDir!, 'cert.pem')
    const p12 = path.join(workDir!, 'id.p12')
    runOrThrow('/usr/bin/openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-nodes',
      '-config',
      cnf,
    ])
    runOrThrow('/usr/bin/openssl', [
      'pkcs12',
      '-export',
      '-inkey',
      key,
      '-in',
      cert,
      '-out',
      p12,
      '-passout',
      'pass:test',
    ])

    const signed = path.join(workDir!, 'cert.node')
    runOrThrow(signtool, [sample, signed, p12, 'test'])
    const result = spawnSync('/usr/bin/codesign', ['-v', signed], {
      stdio: 'pipe',
    })
    expect(result.status).toBe(0)
  })

  it('verify: accepts a sealed binary, rejects a tampered one', async () => {
    const { sample, signtool } = await setup()
    const signed = path.join(workDir!, 'verify.node')
    runOrThrow(signtool, [sample, signed])
    // Our own verify accepts what we signed.
    const verifyOk = spawnSync(signtool, ['--verify', signed], {
      stdio: 'pipe',
    })
    expect(verifyOk.status).toBe(0)
    // Flip a code byte → verify must reject (the seal is broken).
    const { readFile, writeFile: wf } = await import('node:fs/promises')
    const bytes = await readFile(signed)
    bytes[1000] = bytes[1000]! ^ 0xff
    const tampered = path.join(workDir!, 'tampered.node')
    await wf(tampered, bytes)
    const verifyBad = spawnSync(signtool, ['--verify', tampered], {
      stdio: 'pipe',
    })
    expect(verifyBad.status).not.toBe(0)
  })
})
