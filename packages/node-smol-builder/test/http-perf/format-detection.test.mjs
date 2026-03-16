
import { describe, it, expect, beforeEach } from 'vitest';
import { FormatDetector, formatDetector } from '../../additions/source-patched/lib/internal/socketsecurity/http-perf/format-detection';

describe('FormatDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new FormatDetector();
  });

  describe('User-Agent Detection', () => {
    it('should detect npm from User-Agent', () => {
      const req = { headers: { 'user-agent': 'npm/10.2.0' }, url: '/' };
      expect(detector.detect(req)).toBe('npm');
    });

    it('should detect pnpm from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pnpm/8.0.0' }, url: '/' };
      expect(detector.detect(req)).toBe('pnpm');
    });

    it('should detect yarn from User-Agent', () => {
      const req = { headers: { 'user-agent': 'yarn/1.22.0' }, url: '/' };
      expect(detector.detect(req)).toBe('yarn');
    });

    it('should detect pip from User-Agent', () => {
      const req = { headers: { 'user-agent': 'pip/23.0' }, url: '/' };
      expect(detector.detect(req)).toBe('pip');
    });

    it('should detect Maven from User-Agent', () => {
      const req = { headers: { 'user-agent': 'Apache-Maven/3.9.0' }, url: '/' };
      expect(detector.detect(req)).toBe('maven');
    });

    it('should detect Gradle from User-Agent', () => {
      const req = { headers: { 'user-agent': 'Gradle/8.0' }, url: '/' };
      expect(detector.detect(req)).toBe('gradle');
    });

    it('should detect Cargo from User-Agent', () => {
      const req = { headers: { 'user-agent': 'cargo 1.70.0' }, url: '/' };
      expect(detector.detect(req)).toBe('cargo');
    });

    it('should detect Bundler from User-Agent', () => {
      const req = { headers: { 'user-agent': 'bundler/2.4.0' }, url: '/' };
      expect(detector.detect(req)).toBe('bundler');
    });

    it('should detect NuGet from User-Agent', () => {
      const req = { headers: { 'user-agent': 'NuGet/6.0.0' }, url: '/' };
      expect(detector.detect(req)).toBe('nuget');
    });

    it('should detect Composer from User-Agent', () => {
      const req = { headers: { 'user-agent': 'Composer/2.5.0' }, url: '/' };
      expect(detector.detect(req)).toBe('composer');
    });

    it('should detect Go modules from User-Agent', () => {
      const req = { headers: { 'user-agent': 'Go-http-client/1.1' }, url: '/golang.org/x/net' };
      expect(detector.detect(req)).toBe('go');
    });
  });

  describe('Path-Based Detection', () => {
    it('should detect Maven from path', () => {
      const req = { url: '/maven2/org/example/artifact/1.0.0', headers: {} };
      expect(detector.detect(req)).toBe('maven');
    });

    it('should detect Python from pypi path', () => {
      const req = { url: '/pypi/numpy/1.24.0', headers: {} };
      expect(detector.detect(req)).toBe('pip');
    });

    it('should detect NuGet from path', () => {
      const req = { url: '/v3/registration/newtonsoft.json/index.json', headers: {} };
      expect(detector.detect(req)).toBe('nuget');
    });

    it('should detect RubyGems from path', () => {
      const req = { url: '/gems/rails-7.0.0.gem', headers: {} };
      expect(detector.detect(req)).toBe('bundler');
    });

    it('should detect Cargo from crates.io path', () => {
      const req = { url: '/api/v1/crates/serde/1.0.0', headers: {} };
      expect(detector.detect(req)).toBe('cargo');
    });

    it('should detect Composer from packagist path', () => {
      const req = { url: '/p2/vendor/package.json', headers: {} };
      expect(detector.detect(req)).toBe('composer');
    });
  });

  describe('Default Behavior', () => {
    it('should default to npm for unknown formats', () => {
      const req = { url: '/', headers: {} };
      expect(detector.detect(req)).toBe('npm');
    });

    it('should default to npm for unknown User-Agent', () => {
      const req = { url: '/', headers: { 'user-agent': 'UnknownClient/1.0' } };
      expect(detector.detect(req)).toBe('npm');
    });

    it('should handle missing headers gracefully', () => {
      const req = { url: '/', headers: undefined };
      expect(detector.detect(req)).toBe('npm');
    });

    it('should handle missing url gracefully', () => {
      const req = { headers: {} };
      expect(detector.detect(req)).toBe('npm');
    });
  });

  describe('Statistics Tracking', () => {
    it('should track detection counts', () => {
      detector.detect({ headers: { 'user-agent': 'npm/10.0.0' }, url: '/' });
      detector.detect({ headers: { 'user-agent': 'pip/23.0' }, url: '/' });
      detector.detect({ headers: { 'user-agent': 'npm/10.0.0' }, url: '/' });

      const stats = detector.getStats();
      expect(stats.npm_detections).toBe(2);
      expect(stats.pip_detections).toBe(1);
      expect(stats.total_detections).toBe(3);
    });

    it('should track user-agent detections separately from path detections', () => {
      detector.detect({ headers: { 'user-agent': 'npm/10.0.0' }, url: '/' });
      detector.detect({ url: '/maven2/org/example/artifact/1.0.0', headers: {} });

      const stats = detector.getStats();
      expect(stats.user_agent_detections).toBe(1);
      expect(stats.path_detections).toBe(1);
    });

    it('should clear statistics', () => {
      detector.detect({ headers: { 'user-agent': 'npm/10.0.0' }, url: '/' });
      detector.clearStats();

      const stats = detector.getStats();
      expect(stats.total_detections).toBe(0);
      expect(stats.npm_detections).toBe(0);
    });
  });

  describe('Global Instance', () => {
    it('should provide a global formatDetector instance', () => {
      expect(formatDetector).toBeInstanceOf(FormatDetector);
    });

    it('should maintain state across calls', () => {
      formatDetector.clearStats();
      formatDetector.detect({ headers: { 'user-agent': 'npm/10.0.0' }, url: '/' });

      const stats = formatDetector.getStats();
      expect(stats.total_detections).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle case-insensitive User-Agent matching', () => {
      const req = { headers: { 'user-agent': 'NPM/10.0.0' }, url: '/' };
      expect(detector.detect(req)).toBe('npm');
    });

    it('should handle mixed case in paths', () => {
      const req = { url: '/Maven2/org/example/artifact/1.0.0', headers: {} };
      expect(detector.detect(req)).toBe('maven');
    });

    it('should prioritize User-Agent over path when both present', () => {
      const req = {
        headers: { 'user-agent': 'pip/23.0' },
        url: '/maven2/org/example/artifact/1.0.0',
      };
      expect(detector.detect(req)).toBe('pip');
    });

    it('should handle empty User-Agent', () => {
      const req = { headers: { 'user-agent': '' }, url: '/' };
      expect(detector.detect(req)).toBe('npm');
    });

    it('should handle null request gracefully', () => {
      expect(() => detector.detect(null)).not.toThrow();
    });
  });
});
