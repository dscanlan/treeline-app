import type { StateCreator } from 'zustand';

/**
 * Dev-only slice — exists solely so the screenshot harness can render a
 * tooltip-styled overlay during the 18-add-button-tooltip scenario. The OS
 * native HTML title tooltip is rendered outside the renderer's bitmap and
 * therefore invisible to `webContents.capturePage()`. This in-renderer
 * stand-in is the only tooltip the harness can capture.
 *
 * Stays inert in production: nothing ever sets `forceTooltip`, and the
 * `ScreenshotForceTooltip` component renders null when it's unset.
 */
export interface ScreenshotSlice {
  forceTooltip: { selector: string; text: string } | null;
  setForceTooltip: (v: { selector: string; text: string } | null) => void;
}

export const createScreenshotSlice: StateCreator<
  ScreenshotSlice,
  [],
  [],
  ScreenshotSlice
> = (set) => ({
  forceTooltip: null,
  setForceTooltip: (v) => set({ forceTooltip: v }),
});
