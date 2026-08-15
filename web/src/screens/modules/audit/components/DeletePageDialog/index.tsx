import {Button, Dialog, DialogDismiss, DialogHeading, DialogProvider} from '@chameleon-labs/lattice-react';
import {useEffect, useId, useRef, useState} from 'react';
import type {PageSummary} from '@tabstop/contract';
import {AlertTriangle} from '@/screens/components/Icons';
import './delete-page-dialog.css';

export type DeletePageDialogProps = {
  open: boolean;
  target: PageSummary | null;
  /** The Remove button that opened it, for ordinary focus restoration. */
  trigger: HTMLElement | null;
  /**
   * Why the last attempt failed, shown in the dialog rather than only as a
   * toast: a modal aria-hides the rest of the page, so a notification raised
   * behind it reaches nobody until it closes.
   */
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  /** Resolves true when the page is gone, false when it is still there. */
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

  useEffect(() => {
    setSucceeded(false);
    setPending(false);
  }, [target?.id]);

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
        // A removal that is already running cannot be walked away from: the
        // request lands either way, and the dialog is the only thing that will
        // report which.
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
        // On success the trigger has gone with its row, so Ariakit is told to
        // restore nothing; the dashboard decides where focus lands once the
        // new list has rendered.
        finalFocus={succeeded ? null : trigger}
      >
        {/* h2 rather than the default h1, which would compete with the
            dashboard's. The text sits in the render element so it is visible
            to both Ariakit and the heading-has-content rule. */}
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
