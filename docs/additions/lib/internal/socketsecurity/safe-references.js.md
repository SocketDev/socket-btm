# Safe References to Module APIs

Captures early references to Buffer, path, fs, process, and crypto methods
before any user code can overwrite them. This provides defense-in-depth
protection beyond traditional primordials.

## Why This Is Needed

While these aren't prototype methods (not traditional prototype pollution vectors),
users can still overwrite module methods:

- Buffer.prototype.slice = () => 'hacked'
- path.join = () => 'hacked'
- fs.readFileSync = () => 'hacked'

By capturing references during early bootstrap (before user code runs),
we ensure our code uses the original, untampered implementations.

## Usage

Instead of: buffer.slice(0, 10)
Use: BufferPrototypeSlice(buffer, 0, 10)

Instead of: path.join(a, b)
Use: PathJoin(a, b)

## History: Why Primordials Exist

Node.js introduced primordials in v12.1.0 (2019, PR #27398) to prevent a
class of attacks where user code monkey-patches built-in prototypes before
internal modules run. For example, if someone does
`Array.prototype.map = evilFn`, any Node.js internal that calls `.map()`
would execute attacker code. Primordials cache the original built-in methods
at startup -- before any user code runs -- so internal modules always call the
real Array.prototype.map, not whatever the user replaced it with.
See PR #38248 for later performance tradeoff discussions around primordials
in hot paths.
