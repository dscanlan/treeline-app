import { useStore } from '../../store';
import { CreateRepoModal } from './CreateRepoModal';
import { CreateWorktreeModal } from './CreateWorktreeModal';
import { DeleteWorktreeModal } from './DeleteWorktreeModal';
import { ConfirmDiscardModal } from './ConfirmDiscardModal';
import { SettingsModal } from './SettingsModal';
import { QuickOpenModal } from './QuickOpenModal';

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
  if (modal.kind === 'quick-open') {
    return <QuickOpenModal root={modal.root} />;
  }
  return null;
}
