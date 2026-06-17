import { useStore } from '../../store';
import { CreateRepoModal } from './CreateRepoModal';
import { CreateWorktreeModal } from './CreateWorktreeModal';
import { DeleteWorktreeModal } from './DeleteWorktreeModal';
import { ConfirmDiscardModal } from './ConfirmDiscardModal';
import { SettingsModal } from './SettingsModal';

export function Modals() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  if (modal.kind === 'create-worktree') {
    return <CreateWorktreeModal repoPath={modal.repoPath} />;
  }
  if (modal.kind === 'delete-worktree') {
    return (
      <DeleteWorktreeModal
        repoPath={modal.repoPath}
        worktreePath={modal.worktreePath}
        branch={modal.branch}
      />
    );
  }
  if (modal.kind === 'create-repo') {
    return <CreateRepoModal />;
  }
  if (modal.kind === 'confirm-discard') {
    return <ConfirmDiscardModal filename={modal.filename} then={modal.then} />;
  }
  if (modal.kind === 'settings') {
    return <SettingsModal />;
  }
  return null;
}
