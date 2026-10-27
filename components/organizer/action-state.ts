/** Return shapes of the organizer server actions, shared by the actions and their forms. */

export interface StatusActionState {
  error?: string;
}

export interface ReleaseHoldsState {
  /** How many holds were released by the last run. */
  released?: number;
  error?: string;
}
