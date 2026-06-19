import type { AuthUserInfo } from '@/lib/auth/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@seeflow/canvas';
import { FolderOpen, LogOut, UserRound } from 'lucide-react';

export interface UserMenuProps {
  user: AuthUserInfo;
  onOpenProfile: () => void;
  onMyProjects: () => void;
  onSignOut: () => void;
}

/** Initials fallback when the user has no avatar image. */
export const userInitials = (user: AuthUserInfo): string => {
  const source = user.name?.trim() || user.email?.trim() || '';
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const second = parts[1]?.[0] ?? '';
    return (first + second).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
};

/**
 * Signed-in avatar + account menu. Cloud-only — the Header renders it solely
 * when `isCloud && user`. Presentational: identity actions are passed in.
 */
export function UserMenu({ user, onOpenProfile, onMyProjects, onSignOut }: UserMenuProps) {
  const label = user.name || user.email || 'Account';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          data-testid="user-menu-trigger"
          className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xs font-semibold text-foreground transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {user.imageUrl ? (
            <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>{userInitials(user)}</span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56" data-testid="user-menu">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="truncate text-sm font-medium">{label}</span>
            {user.name && user.email ? (
              <span className="truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            ) : null}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenProfile} data-testid="user-menu-profile">
          <UserRound className="mr-2 h-4 w-4" />
          My profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMyProjects} data-testid="user-menu-projects">
          <FolderOpen className="mr-2 h-4 w-4" />
          My projects
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} data-testid="user-menu-signout">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
