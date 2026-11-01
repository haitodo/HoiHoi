import { describe, expect, it } from 'vitest';
import { buildSafeDownloadFilename } from '../filename-utils';

describe('filename-utils', () => {
  describe('buildSafeDownloadFilename', () => {
    it('extracts basename and extension from standard URL', () => {
      const name = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/assets/sample-photo.jpg',
      });
      expect(name).toBe('sample-photo.jpg');
    });

    it('decodes percent-encoded filenames', () => {
      const name = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/images/%E7%8C%AB.png',
      });
      expect(name).toBe('猫.png');
    });

    it('sanitizes illegal Windows/POSIX characters', () => {
      const name = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/images/bad:name*with%3Fchars".webp',
      });
      expect(name).toBe('bad_name_with_chars_.webp');
    });

    it('prefixes Windows reserved device names', () => {
      const name1 = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/download/con.png',
      });
      expect(name1).toBe('_con.png');

      const name2 = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/download/NUL.jpg',
      });
      expect(name2).toBe('_NUL.jpg');
    });

    it('falls back to domain and zero-padded index for data: URLs', () => {
      const name = buildSafeDownloadFilename({
        targetUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
        domain: 'example.com',
        itemIndex: 42,
      });
      expect(name).toBe('example.com_0042.jpg');
    });

    it('truncates excessively long filename stems while preserving extension', () => {
      const longStem = 'a'.repeat(150);
      const name = buildSafeDownloadFilename({
        targetUrl: `https://example.com/${longStem}.gif`,
      });
      expect(name.endsWith('.gif')).toBe(true);
      expect(name.length).toBe(100 + '.gif'.length);
    });
  });
});
