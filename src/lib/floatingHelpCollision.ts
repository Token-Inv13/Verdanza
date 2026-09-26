export type FloatingHelpRectangle = Readonly<{
  top: number;
  right: number;
  bottom: number;
  left: number;
}>;

export const FLOATING_HELP_SAFETY_MARGIN = 10;
export const FLOATING_HELP_RELEASE_MARGIN = 12;

/** A two-pixel release band prevents toggling at the edge without a time delay. */
export function hasFloatingHelpCollision(
  footprint: FloatingHelpRectangle,
  surfaces: readonly FloatingHelpRectangle[],
  alreadyHidden = false,
) {
  const margin = alreadyHidden ? FLOATING_HELP_RELEASE_MARGIN : FLOATING_HELP_SAFETY_MARGIN;
  if (footprint.right <= footprint.left || footprint.bottom <= footprint.top) return false;

  return surfaces.some((surface) =>
    surface.right > surface.left && surface.bottom > surface.top &&
    footprint.left - margin < surface.right && footprint.right + margin > surface.left &&
    footprint.top - margin < surface.bottom && footprint.bottom + margin > surface.top,
  );
}
