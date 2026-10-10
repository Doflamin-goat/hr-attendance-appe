import type { HrScope } from "../context/AuthContext";

const MAIN_INFORMED_PEOPLE = [
  "HR Marj",
  "Ma'am Jen",
  "Ma'am Alexis",
  "Ma'am Arielle",
  "Ma'am Reina",
  "Sir Marc",
] as const;

const ITC_INFORMED_PEOPLE = ["Sir Gatch", "Ma'am Chona", "HR Louissa"] as const;

export function informedPeopleForScope(scope: HrScope | null): string[] {
  return scope === "MAIN" ? [...MAIN_INFORMED_PEOPLE] : [...ITC_INFORMED_PEOPLE];
}

export const mainInformedPeople = MAIN_INFORMED_PEOPLE;
export const itcInformedPeople = ITC_INFORMED_PEOPLE;
