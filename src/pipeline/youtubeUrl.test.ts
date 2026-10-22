import { describe, expect, it } from 'vitest';
import { parseVideoId } from './youtubeUrl';

describe('parseVideoId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL123'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ'],
    ['  https://youtu.be/dQw4w9WgXcQ  '],
  ])('extracts the id from %s', (url) => {
    expect(parseVideoId(url)).toBe('dQw4w9WgXcQ');
  });

  it.each([
    ['https://vimeo.com/123456'],
    ['https://www.youtube.com/watch?v=short'],
    ['https://www.youtube.com/channel/UC1234567890'],
    ['https://evil.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ'],
    ['not a url'],
    [''],
  ])('rejects %s', (url) => {
    expect(parseVideoId(url)).toBeNull();
  });
});
