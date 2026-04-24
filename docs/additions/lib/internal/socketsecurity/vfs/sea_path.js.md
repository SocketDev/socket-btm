# sea_path.js -- Transparent fs access to Node.js SEA blob assets

## What This File Does

Node.js SEA (Single Executable Application) can embed arbitrary "assets"
(binary blobs) alongside your main script. This file lets you access those
assets using normal fs paths under the `/sea` prefix. For example:
fs.readFileSync('/sea/config.json') -> reads the 'config.json' asset
fs.existsSync('/sea/data.bin') -> checks if 'data.bin' asset exists
fs.readdirSync('/sea') -> lists all asset keys

## How It Fits in the VFS System

fs_shim.js -> THIS FILE (sea_path.js) -- for /sea/_ paths
fs_shim.js -> loader.js -- for /snapshot/_ paths

When fs_shim.js intercepts an fs call, it first checks if the path starts
with '/sea/'. If yes, it delegates to this file. If not, it checks for
VFS paths ('/snapshot/\*'). SEA assets are a separate system from the VFS
TAR archive, but both are accessed through the same fs shim.

## Key Concepts

- SEA (Single Executable Application): A Node.js feature where your app
  is bundled into the Node.js binary itself. SEA supports embedding
  "assets" -- arbitrary files accessible via the `node:sea` module.

- SEA assets vs VFS: SEA assets are a flat key-value store (key='config.json',
  value=<bytes>). VFS is a full virtual filesystem with directories,
  symlinks, and permissions parsed from a TAR archive. They coexist:
  /sea/_ uses SEA assets, /snapshot/_ uses VFS.

- Flat structure: SEA assets don't have real directories. A key like
  'data/config.json' is just a string, not a file inside a 'data' folder.
  However, this module synthesizes directory listings by parsing the '/'
  separators in asset keys.

## Usage

```js
fs.readFileSync('/sea/config.json') // Reads asset with key 'config.json'
fs.existsSync('/sea/data.bin') // Checks if asset exists
fs.readdirSync('/sea') // Lists all asset keys
```

## Limitations

- Read-only (SEA assets are immutable)
- Flat structure (no real directories, though keys can contain '/')
- require('/sea/x.js') NOT supported (use VFS for modules)
