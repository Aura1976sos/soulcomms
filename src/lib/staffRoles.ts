export type StaffRoleValue =
  | "admin"
  | "event_admin"
  | "checkin_officer"
  | "activity_coordinator"
  | "crew_manager"
  | "sp_manager"
  | "viewer";

export interface StaffRoleDef {
  value: StaffRoleValue;
  label: string;
  desc: string;
  color: string;
}

export const STAFF_ROLES: StaffRoleDef[] = [
  { value: "admin",                label: "Super Admin",              desc: "Full access to all features",              color: "hsl(0 85% 52%)"    },
  { value: "event_admin",          label: "Event Admin",              desc: "Manage a specific event",                  color: "hsl(25 100% 55%)"  },
  { value: "checkin_officer",      label: "Check-In Officer",         desc: "Can check in participants",                color: "hsl(200 100% 55%)" },
  { value: "activity_coordinator", label: "Activity Coordinator",     desc: "Can record experiences",                   color: "hsl(150 80% 45%)"  },
  { value: "crew_manager",         label: "Crew Manager",             desc: "Manage crew members",                      color: "hsl(280 100% 65%)" },
  { value: "sp_manager",           label: "Service Provider Manager", desc: "Manage service providers",                 color: "hsl(180 100% 45%)" },
  { value: "viewer",               label: "Viewer",                   desc: "Read-only access",                         color: "hsl(0 0% 55%)"     },
];

export const getRoleDef = (value: string): StaffRoleDef | undefined =>
  STAFF_ROLES.find(r => r.value === value);

export const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "Active",    color: "text-success",      bg: "bg-success/10 border-success/30"     },
  disabled:  { label: "Disabled",  color: "text-destructive",  bg: "bg-destructive/10 border-destructive/30" },
  suspended: { label: "Suspended", color: "text-amber-400",    bg: "bg-amber-400/10 border-amber-400/30" },
};
