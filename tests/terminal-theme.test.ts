import { describe, expect, it } from 'vitest';
import {
  APP_PALETTE_SLOTS,
  appPaletteForId,
  colorSchemeForId,
  themeForId,
} from '../src/shared/terminal-theme';

describe('terminal theme presets', () => {
  it('marks only Graphite Light as a light color scheme', () => {
    expect(colorSchemeForId('graphite-light')).toBe('light');
    expect(colorSchemeForId('graphite')).toBe('dark');
    expect(colorSchemeForId('midnight')).toBe('dark');
    expect(colorSchemeForId('not-a-theme')).toBe('dark');
  });

  it('gives light chrome distinct canvas, panel, border, and selected surfaces', () => {
    const palette = appPaletteForId('graphite-light');
    expect(
      new Set([
        palette.surface,
        palette.chrome,
        palette.panel,
        palette.border,
        palette.highlight,
      ]).size,
    ).toBe(5);
    expect(APP_PALETTE_SLOTS.every((slot) => palette[slot].startsWith('#'))).toBe(true);
  });

  it('keeps ANSI black and white distinguishable for inverse-video TUI rows', () => {
    const theme = themeForId('graphite-light');
    expect(contrast(theme.black, theme.white)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.black, theme.brightWhite)).toBeGreaterThanOrEqual(4.5);
  });
});

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
