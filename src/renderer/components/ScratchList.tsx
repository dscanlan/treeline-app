import { useStore } from '../store';
import { ScratchRow } from './ScratchRow';

/**
 * Renders the list of active scratch terminals at the top of the sidebar.
 * Renders nothing when there are no scratches — the sidebar layout in
 * Sidebar.tsx skips the surrounding separator under the same condition.
 */
export function ScratchList() {
  const scratches = useStore((s) => s.scratches);
  if (scratches.length === 0) return null;
  return (
    <ul className="flex flex-col gap-px px-1">
      {scratches.map((s) => (
        <ScratchRow key={s.id} scratch={s} />
      ))}
    </ul>
  );
}
