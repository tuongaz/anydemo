import { type Grant, type Role, addGrant, fetchGrants, removeGrant } from '@/lib/cloud-members-api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@seeflow/canvas';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

// Host-owned "share with people" dialog for the studio editor running in cloud.
// The canvas ShareMenu fires `onShareWithMembers`; the host (App) opens this.
// Invite by email, list who has access, change roles, and revoke — all against
// the cloud grants API via apiFetch. Styled with the studio's shadcn tokens.

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; grants: Grant[] };

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
];

const inputClass =
  'rounded-md border bg-background px-3 py-2 text-sm outline-hidden ring-offset-background focus:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export interface MembersShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Internal cloud project id the grants API keys on. */
  projectId: string;
}

export function MembersShareDialog({ open, onOpenChange, projectId }: MembersShareDialogProps) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [submitting, setSubmitting] = useState(false);
  // Inline, non-destructive error surface — never wipes the loaded list.
  const [error, setError] = useState<string | null>(null);

  const refetch = async () => {
    try {
      const grants = await fetchGrants(projectId);
      setState({ status: 'done', grants });
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setRole('viewer');
    setSubmitting(false);
    setError(null);
    setState({ status: 'loading' });
    // Load inline (not via `refetch`) so the effect's deps are honest: it
    // re-runs exactly when the dialog opens or the target project changes.
    // The mutation handlers reuse `refetch`.
    fetchGrants(projectId)
      .then((grants) => setState({ status: 'done', grants }))
      .catch((err) =>
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) }),
      );
  }, [open, projectId]);

  const canSubmit = email.includes('@') && !submitting;

  const onAdd = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await addGrant(projectId, email, role);
      setEmail('');
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const onChangeRole = async (granteeEmail: string, newRole: Role) => {
    setError(null);
    try {
      await addGrant(projectId, granteeEmail, newRole);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const onRemove = async (granteeEmail: string) => {
    setError(null);
    try {
      await removeGrant(projectId, granteeEmail);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const grants = state.status === 'done' ? state.grants : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="members-share-dialog">
        <DialogHeader>
          <DialogTitle>Share project</DialogTitle>
          <DialogDescription>Invite people by email and manage who has access.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Invite row */}
          <div className="flex gap-2">
            <input
              data-testid="member-invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-label="Invite by email"
              className={`${inputClass} flex-1`}
            />
            <select
              data-testid="member-invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              aria-label="Invite role"
              className={`${inputClass} cursor-pointer`}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              data-testid="member-invite-add"
              onClick={onAdd}
              disabled={!canSubmit}
            >
              {submitting ? 'Adding…' : 'Add'}
            </Button>
          </div>

          {error ? (
            <div role="alert" data-testid="member-error" className="text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {/* People list */}
          {state.status === 'loading' ? (
            <div className="text-sm text-muted-foreground">Loading people…</div>
          ) : state.status === 'error' ? (
            <div role="alert" className="text-sm text-destructive">
              {state.message}
            </div>
          ) : grants.length === 0 ? (
            <div data-testid="member-empty" className="text-sm text-muted-foreground">
              Only you have access yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {grants.map((g) => (
                <div key={g.email} data-testid="member-row" className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">{g.email}</span>
                  <select
                    data-testid={`member-role-${g.email}`}
                    value={g.role}
                    onChange={(e) => onChangeRole(g.email, e.target.value as Role)}
                    aria-label={`Role for ${g.email}`}
                    className={`${inputClass} cursor-pointer`}
                  >
                    {ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    data-testid={`member-remove-${g.email}`}
                    onClick={() => onRemove(g.email)}
                    aria-label={`Remove ${g.email}`}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Editor access is read-only until live editing ships.
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-testid="member-done"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
