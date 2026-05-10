import { useStore } from '../store';

/**
 * Sidebar button that opens the CreateRepoModal. The modal itself owns the
 * submit lifecycle (validation, IPC, post-create selection) — this is just
 * an entry point.
 */
export function NewRepoButton() {
  const openModal = useStore((s) => s.openModal);
  return (
    <button
      type="button"
      onClick={() => openModal({ kind: 'create-repo' })}
      title="Create a new git repository"
      className="rounded border border-treeline-highlight px-2 py-1 text-treeline-text hover:bg-treeline-highlight"
    >
      ✱ New repo
    </button>
  );
}
