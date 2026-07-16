# Releasing the Keychain addon

The Keychain addon is one N-API binary built for several operating systems. A
release must contain every supported asset because fleet setup chooses the file
that matches the developer's machine.

## Asset contract

For version `1.2.3`, the release tag is `keychain-addon-v1.2.3` and the assets
are:

- `keychain-addon-1.2.3-darwin-arm64.node`
- `keychain-addon-1.2.3-darwin-x64.node`
- `keychain-addon-1.2.3-linux-arm64.node`
- `keychain-addon-1.2.3-linux-x64.node`
- `keychain-addon-1.2.3-win32-x64.node`
- `checksums.txt`

The workflow validates each binary's file format and CPU before uploading it.
This catches a common release mistake where a correctly named asset contains a
binary for the wrong target.

## Dry run

1. Open the `Keychain addon` workflow in GitHub Actions.
2. Enter the version chosen by the maintainer.
3. Leave `Dry run` enabled.
4. Confirm all five build jobs load the addon and pass the missing-item probe.
5. Download the workflow artifacts if you need to inspect them locally.

A dry run never creates a tag or GitHub Release.

## Release gate

After the dry run is green, a maintainer can run the workflow again with
`Dry run` disabled. The release job uses the repository's protected `release`
environment and publishes with the immutable three-step flow: create a draft,
upload every asset, then publish the draft.

After publishing, copy the release tag and each asset's pinned integrity into
the wheelhouse external-tools manifest. Fleet setup must not download a
floating `latest` asset.
