import {Button, Dialog, DialogDismiss, DialogHeading, DialogProvider} from '@chameleon-labs/lattice-react';
import {useId, useRef, useState} from 'react';
import type {PageSummary} from '@tabstop/contract';
import {AlertTriangle} from '@/screens/components/Icons';
import './delete-page-dialog.css';

export type DeletePageDialogProps = {
  open: boolean;
  target: PageSummary | null;
  trigger: HTMLElement | null;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (page: PageSummary) => Promise<boolean>;
};

export const DeletePageDialog = ({
  open,
  target,
  trigger,
  error = null,
  onOpenChange,
  onConfirm,
}: DeletePageDialogProps): React.JSX.Element => {
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const [tracked, setTracked] = useState(target?.id);

  if (tracked !== target?.id) {
    setTracked(target?.id);
    setSucceeded(false);
    setPending(false);
  }

  const confirm = async (): Promise<void> => {
    if (target === null) {
      return;
    }

    setPending(true);
    try {
      const removed = await onConfirm(target);
      if (!removed) {
        return;
      }

      setSucceeded(true);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <DialogProvider
      open={open && target !== null}
      setOpen={(next) => {
        if (pending) {
          return;
        }
        onOpenChange(next);
      }}
    >
      <Dialog
        className="delete-page-dialog"
        aria-describedby={descriptionId}
        initialFocus={cancelRef}
        finalFocus={succeeded ? null : trigger}
      >
        <DialogHeading className="delete-page-dialog__heading" render={<h2>Remove monitored page?</h2>} />
        <div className="delete-page-dialog__body">
          <span className="delete-page-dialog__icon" aria-hidden="true">
            <AlertTriangle size="md" />
          </span>
          <p id={descriptionId}>
            {target?.url} will stop being monitored. Its audit history and any public share links are permanently
            removed, and this cannot be undone.
          </p>
        </div>
        {error !== null && (
          <p className="delete-page-dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="delete-page-dialog__actions">
          <DialogDismiss ref={cancelRef} disabled={pending} render={<Button variant="secondary" />}>
            Cancel
          </DialogDismiss>
          <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>
            {pending ? 'Removing…' : 'Remove page'}
          </Button>
        </div>
      </Dialog>
    </DialogProvider>
  );
};
