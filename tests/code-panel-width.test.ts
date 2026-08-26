import { describe, expect, it } from 'vitest';
import {
  CODE_PANEL_MAX_FRACTION,
  CODE_PANEL_MIN_WIDTH,
  clampCodePanelWidth,
} from '../src/renderer/store/editor-slice';

describe('clampCodePanelWidth', () => {
  it('lets the panel reach 90% of the available space', () => {
    expect(clampCodePanelWidth(99999, 1000)).toBe(900);
    expect(clampCodePanelWidth(99999, 3440)).toBe(3096);
  });

  it('scales with the window instead of stopping at a fixed pixel cap', () => {
    // The regression: a 1000px ceiling made the panel ~26% of a 4K workspace
    // however far it was dragged.
    const wide = clampCodePanelWidth(99999, 3840);
    expect(wide).toBeGreaterThan(1000);
    expect(wide / 3840).toBeCloseTo(CODE_PANEL_MAX_FRACTION, 5);
  });

  it('leaves 10% of the available space for the terminal', () => {
    for (const available of [900, 1440, 2560, 3840]) {
      expect(available - clampCodePanelWidth(99999, available)).toBeCloseTo(available * 0.1, 5);
    }
  });

  it('passes through widths below the ceiling untouched', () => {
    expect(clampCodePanelWidth(640, 3840)).toBe(640);
  });

  it('holds the minimum width floor', () => {
    expect(clampCodePanelWidth(10, 3840)).toBe(CODE_PANEL_MIN_WIDTH);
  });

  it('lets the floor win when 90% of the available space is narrower than it', () => {
    // Very narrow window: MainArea's max-width backstop clips the render.
    expect(clampCodePanelWidth(99999, 300)).toBe(CODE_PANEL_MIN_WIDTH);
  });
});
