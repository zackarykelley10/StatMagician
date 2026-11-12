import { describe, expect, it } from 'vitest';
import { formatRoster, parseRoster } from '@/ui/roster';

describe('parseRoster', () => {
  it('accepts space, comma, hash and tab separated lines', () => {
    const text = [
      '12 John Smith',
      '13, Mike Jones, QB',
      '#14 Sam Lee QB',
      '15\tTom Brown\tWR',
    ].join('\n');

    expect(parseRoster(text)).toEqual([
      { number: 12, name: 'John Smith' },
      { number: 13, name: 'Mike Jones', position: 'QB' },
      { number: 14, name: 'Sam Lee', position: 'QB' },
      { number: 15, name: 'Tom Brown', position: 'WR' },
    ]);
  });

  it('does not treat an all-caps last name as a position', () => {
    expect(parseRoster('12 JOHN LEE')).toEqual([{ number: 12, name: 'JOHN LEE' }]);
  });

  it('skips blank and invalid lines', () => {
    const text = ['', '   ', 'abc', '100 Too Big', '12', '7, , QB', '-3 Neg Num', '5 Good Player'].join('\n');
    expect(parseRoster(text)).toEqual([{ number: 5, name: 'Good Player' }]);
  });

  it('dedupes by number with the last occurrence winning, sorted by number', () => {
    const text = ['20 Old Name', '3 Third', '20 New Name QB', '0 Zero'].join('\n');
    expect(parseRoster(text)).toEqual([
      { number: 0, name: 'Zero' },
      { number: 3, name: 'Third' },
      { number: 20, name: 'New Name', position: 'QB' },
    ]);
  });

  it('handles Windows line endings', () => {
    expect(parseRoster('1 A B\r\n2 C D')).toEqual([
      { number: 1, name: 'A B' },
      { number: 2, name: 'C D' },
    ]);
  });
});

describe('formatRoster', () => {
  it('formats players as "number, name" with optional position', () => {
    expect(
      formatRoster([
        { number: 12, name: 'John Smith', position: 'QB' },
        { number: 4, name: 'Pat Doe' },
      ]),
    ).toBe('12, John Smith, QB\n4, Pat Doe');
  });

  it('round-trips through parseRoster', () => {
    const players = parseRoster('9, Ann Ray, OLB\n1 Bo Hart');
    expect(parseRoster(formatRoster(players))).toEqual(players);
  });
});
