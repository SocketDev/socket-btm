/**
 * @fileoverview Tests for model-build-helpers utilities (pure helpers).
 */

import { extractPythonPackages } from '../lib/model-build-helpers.mts'

describe('model-build-helpers', () => {
  describe(extractPythonPackages, () => {
    it('should return Python packages from packageManager shape', () => {
      const packages = extractPythonPackages({
        torch: { packageManager: 'pip', version: '2.10.0' },
        transformers: { packageManager: 'pip', version: '4.53.3' },
        pnpm: { packageManager: 'pnpm', version: '11.0.0-rc.0' },
      })
      expect(packages).toStrictEqual(['torch', 'transformers'])
    })

    it('should return Python packages from type: python / versions.pip shape', () => {
      const packages = extractPythonPackages({
        torch: {
          type: 'python',
          versions: { __proto__: null, pip: '2.10.0' },
        },
        numpy: {
          versions: { __proto__: null, pip: '2.0.0' },
        },
        zig: { versions: { __proto__: null, apt: '0.13.0' } },
      })
      expect(packages).toStrictEqual(['torch', 'numpy'])
    })

    it('should skip pip itself (bootstrap tool, dpkg-owned on Ubuntu)', () => {
      const packages = extractPythonPackages({
        pip: { packageManager: 'pip', version: '24.3.1' },
        torch: { packageManager: 'pip', version: '2.10.0' },
      })
      // pip refuses to uninstall dpkg-owned pip even with
      // --break-system-packages (no RECORD file), so we can't pip-install
      // pip itself. Ship whatever the distro provides.
      expect(packages).toStrictEqual(['torch'])
    })

    it('should annotate onnxruntime with its import name', () => {
      const packages = extractPythonPackages({
        onnxruntime: { packageManager: 'pip', version: '1.24.4' },
      })
      expect(packages).toStrictEqual([
        { importName: 'onnxruntime', name: 'onnxruntime' },
      ])
    })
  })
})
