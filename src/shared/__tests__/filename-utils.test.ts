import { describe, expect, it } from 'vitest';
import {
  buildSafeDownloadFilename,
  buildSafeFolderName,
  extractFilenameForSort,
} from '../filename-utils';

describe('filename-utils', () => {
  describe('buildSafeFolderName', () => {
    it('preserves clean titles', () => {
      const folder = buildSafeFolderName('My Vacation Photos 2026');
      expect(folder).toBe('My Vacation Photos 2026');
    });

    it('sanitizes illegal Windows/POSIX characters', () => {
      const folder = buildSafeFolderName('Photos: Summer / Fall * 2026 <Special> | "Quote"?');
      expect(folder).toBe('Photos_Summer_Fall_2026_Special_Quote');
      expect(folder).not.toMatch(/[\\/:*?"<>|]/);
    });

    it('normalizes newlines, carriage returns, and tabs to spaces', () => {
      const folder = buildSafeFolderName("Line 1\r\n\tLine 2\nEnd");
      expect(folder).toBe('Line 1 Line 2 End');
    });

    it('strips leading and trailing dots, spaces, full-width spaces, and underscores', () => {
      const folder = buildSafeFolderName('  ...__My Album__..  \u3000');
      expect(folder).toBe('My Album');
    });

    it('escapes Windows reserved device names with an underscore prefix', () => {
      expect(buildSafeFolderName('CON')).toBe('_CON');
      expect(buildSafeFolderName('con')).toBe('_con');
      expect(buildSafeFolderName('PRN')).toBe('_PRN');
      expect(buildSafeFolderName('AUX')).toBe('_AUX');
      expect(buildSafeFolderName('NUL')).toBe('_NUL');
      expect(buildSafeFolderName('COM1')).toBe('_COM1');
      expect(buildSafeFolderName('LPT9')).toBe('_LPT9');
    });

    it('falls back to domain when title is empty, whitespace, or invalid characters only', () => {
      expect(buildSafeFolderName('', 'example.com')).toBe('example.com');
      expect(buildSafeFolderName('   \t\n  ', 'example.com')).toBe('example.com');
      expect(buildSafeFolderName('***???///:::', 'example.com')).toBe('example.com');
    });

    it('falls back to "images" when both title and domain are absent or empty', () => {
      expect(buildSafeFolderName('')).toBe('images');
      expect(buildSafeFolderName('   ')).toBe('images');
      expect(buildSafeFolderName(':::***???')).toBe('images');
    });

    it('truncates excessively long titles to safe length (MAX_FOLDER_NAME_LENGTH) and trims trailing chars', () => {
      const longTitle = 'a'.repeat(60) + ' ' + 'b'.repeat(60);
      const folder = buildSafeFolderName(longTitle);
      expect(folder.length).toBeLessThanOrEqual(80);
      expect(folder.endsWith(' ')).toBe(false);
      expect(folder.endsWith('.')).toBe(false);
      expect(folder.endsWith('_')).toBe(false);
    });
  });

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

    it('prepends safe folder name when pageTitle is provided', () => {
      const name = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/gallery/landscape.jpg',
        pageTitle: 'Beautiful Nature & Landscapes',
        domain: 'example.com',
      });
      expect(name).toBe('Beautiful Nature & Landscapes/landscape.jpg');
    });

    it('falls back to domain folder when pageTitle is empty', () => {
      const name = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/gallery/landscape.jpg',
        pageTitle: '',
        domain: 'example.com',
      });
      expect(name).toBe('example.com/landscape.jpg');
    });

    it('sanitizes folder name containing Windows prohibited characters', () => {
      const name = buildSafeDownloadFilename({
        targetUrl: 'https://example.com/images/item.png',
        pageTitle: 'Search: "Cat / Dog" *cute* ?',
        domain: 'example.com',
      });
      expect(name).toBe('Search_Cat_Dog_cute/item.png');
      expect(name.split('/')[0]).not.toMatch(/[:*?"<>|\\]/);
    });
  });

  describe('extractFilenameForSort', () => {
    it('extracts filename from standard URL with query string', () => {
      const name = extractFilenameForSort('https://example.com/gallery/photo_01.jpg?w=800');
      expect(name).toBe('photo_01.jpg');
    });

    it('decodes percent-encoded filenames', () => {
      const name = extractFilenameForSort('https://example.com/images/%E3%83%8D%E3%82%B3_02.png');
      expect(name).toBe('ネコ_02.png');
    });

    it('returns raw URL for data: and blob: URLs', () => {
      expect(extractFilenameForSort('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
      expect(extractFilenameForSort('blob:https://example.com/uuid')).toBe('blob:https://example.com/uuid');
    });

    it('sorts natural numbers correctly when combined with localeCompare', () => {
      const urls = [
        'https://example.com/img10.jpg',
        'https://example.com/img2.jpg',
        'https://example.com/img1.jpg',
      ];
      const sorted = urls.map(extractFilenameForSort).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      expect(sorted).toEqual(['img1.jpg', 'img2.jpg', 'img10.jpg']);
    });
  });
});
