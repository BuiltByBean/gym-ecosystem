export type Role = 'owner' | 'admin' | 'front_desk' | 'trainer' | 'member';

/** Who is acting, resolved server-side from session + tenant. */
export interface Actor {
  userId: string;
  isPlatformAdmin: boolean;
  /** Staff roles held at the active gym. */
  staffRoles: Exclude<Role, 'member'>[];
  /** The actor's member id at the active gym, if they are a member here. */
  memberId: string | null;
}

/**
 * Facts about the resource, gathered by the service layer. authorize() is pure —
 * it never touches the database, which is what makes the matrix exhaustively testable.
 */
export interface Resource {
  type: string;
  /** Member the resource belongs to (their profile, workout, booking…). */
  memberId?: string | null;
  /** User the resource belongs to (a trainer's own schedule, profile, program…). */
  ownerUserId?: string | null;
  /** Trainer a booking/availability row is for. */
  trainerUserId?: string | null;
  /** Active assigned-trainer user ids for resource.memberId. */
  assignedTrainerUserIds?: string[];
  /** User ids holding an active member-granted scope (health / progress_photos). */
  grantedUserIds?: string[];
  /** Per-gym toggle: do admins see financials? */
  adminFinancials?: boolean;
}

export type Condition =
  | 'self_member'        // actor IS the member the resource belongs to
  | 'assigned_trainer'   // actor is an active assigned trainer of that member
  | 'health_grant'       // actor holds a live member-granted scope
  | 'trainer_self'       // resource is the actor's own (schedule, profile, program)
  | 'financials_enabled';

export type Rule = 'allow' | 'deny' | Condition[];

export interface Decision {
  allowed: boolean;
  /** How it was allowed, for audit metadata (e.g. "trainer:health_grant"). */
  via?: string;
}
