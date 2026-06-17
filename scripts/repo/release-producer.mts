/**
 * @file Repo-local release-checksums producer for the fleet-canonical
 *   scripts/fleet/publish-release.mts orchestrator. publish-release.mts
 *   dynamically loads THIS file (loadProducer) so it stays layout-agnostic —
 *   it never hard-codes a monorepo `packages/` path. socket-btm is a monorepo
 *   producer, so this re-exports the build-infra implementation. A
 *   single-package producer would point at its own impl instead. Repo-local
 *   (not cascaded from the wheelhouse template).
 */

export {
  updateReleaseAssets,
  writeChecksumsFile,
} from '../../packages/build-infra/lib/release-checksums/producer.mts'
