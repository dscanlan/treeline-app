import { useStore } from '../../store';
import type { DiscardThen } from '../../store/modal-slice';
import { ModalShell } from './ModalShell';
import { confirmDiscardAndContinue } from '../../actions/editor';

interface Props {
  filename: string;
  then: DiscardThen;
}

/**
 * Confirms discarding unsaved edits before closing a dirty file tab or leaving
 * its edit mode. Cancel/Escape keeps editing; Discard drops the targeted draft
 * and runs the pending `then` action.
 */
export function ConfirmDiscardModal({ filename, then }: Props) {
  const closeModal = useStore((s) => s.closeModal);

  return (
    <ModalShell title="Discard unsaved changes?" onClose={closeModal}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          You have unsaved changes to{' '}
          <span className="text-treeline-magenta">{filename}</span>. Discard them?
        </p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeModal}
            className="rounded px-3 py-1 text-treeline-dim hover:text-treeline-text"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => confirmDiscardAndContinue(then)}
            className="rounded bg-treeline-red px-3 py-1 text-treeline-surface"
          >
            Discard
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
