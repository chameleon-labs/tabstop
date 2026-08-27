// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {emailInitials} from './email-initials';

describe('emailInitials', () => {
  it('takes one letter from each end of a separated local part', () => {
    expect(emailInitials('ada.lovelace@example.test')).toBe('AL');
    expect(emailInitials('ada-lovelace@example.test')).toBe('AL');
    expect(emailInitials('ada_lovelace@example.test')).toBe('AL');
  });

  it('skips the middle of a longer name rather than growing', () => {
    expect(emailInitials('ada.byron.lovelace@example.test')).toBe('AL');
  });

  it('gives one letter when there is only one segment', () => {
    expect(emailInitials('ada@example.test')).toBe('A');
  });

  it('discards a plus tag, which is routing rather than name', () => {
    expect(emailInitials('ada.lovelace+tabstop@example.test')).toBe('AL');
    expect(emailInitials('ada+tabstop@example.test')).toBe('A');
  });

  it('reads the local part only, never the domain', () => {
    expect(emailInitials('ada@lovelace.example.test')).toBe('A');
  });

  it('holds the shape when separators are doubled or dangling', () => {
    expect(emailInitials('ada..lovelace@example.test')).toBe('AL');
    expect(emailInitials('.ada.lovelace.@example.test')).toBe('AL');
  });

  it('falls back to a placeholder rather than rendering an empty circle', () => {
    for (const address of ['', '@example.test', '...@example.test', '+tag@example.test']) {
      expect(emailInitials(address)).toBe('?');
    }
  });

  it('splits on code points, so an astral character stays whole', () => {
    expect(emailInitials('𝒜da.lovelace@example.test')).toBe('𝒜L');
  });

  it('cases without a locale, so a Turkish host renders what everyone else does', () => {
    expect(emailInitials('ilkay.iris@example.test')).toBe('II');
  });
});
