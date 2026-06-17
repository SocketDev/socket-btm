node:smol-versions - High-Performance Version Parsing and Comparison
Multi-ecosystem support: npm, Maven, PyPI, NuGet, Cargo, Go, etc.

Usage:
import { parse, compare, satisfies } from 'node:smol-versions';

// Parse version
const v = parse('1.2.3-beta.1', 'npm');

// Compare versions
compare('1.0.0', '2.0.0', 'npm'); // -1
compare('2.0.0', '1.0.0', 'npm'); // 1
compare('1.0.0', '1.0.0', 'npm'); // 0

// Range matching
satisfies('1.5.0', '^1.0.0', 'npm'); // true
satisfies('2.0.0', '^1.0.0', 'npm'); // false
