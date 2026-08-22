export interface NavLink {
  readonly label: string;
  readonly route: string;
  /** Rendered only when the current user is an admin. */
  readonly adminOnly?: boolean;
}
