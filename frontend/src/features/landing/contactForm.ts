/**
 * Logic of the contact / purchase-request form (A43), separate from the markup so it can be unit-tested.
 * One shared value object backs all four variants: switching group or action never discards what was typed, shared
 * fields (name, phone, e-mail, organisation…) carry over, and each variant keeps its own editable message.
 * Limits mirror backend/care-monitoring/worker/src/contact.ts; the server validates again and is authoritative.
 */
import type { ContactCategory } from "../../data/contact/contactClient";
import { CONTACT } from "./content";

export type Group = "individual" | "facility";
export type Variant = ContactCategory;

export const GROUP_OF: Record<Variant, Group> = {
  individual_consultation: "individual",
  individual_purchase: "individual",
  facility_consultation: "facility",
  facility_purchase: "facility",
};

export interface ContactValues {
  full_name: string;
  phone: string;
  email: string;
  relationship: string;
  interests: string[];
  product_interest: string;
  quantity: string;
  recipient_name: string;
  recipient_phone: string;
  delivery_address: string;
  delivery_notes: string;
  organization: string;
  facility_type: string;
  job_title: string;
  address: string;
  care_recipients_estimate: string;
  timeline: string;
  device_quantity: string;
  integration_requirements: string;
  consent: boolean;
  /** Honeypot, never shown to people. */
  website: string;
}

export type FieldName = Exclude<keyof ContactValues, "website"> | "message";

export const EMPTY_VALUES: ContactValues = {
  full_name: "",
  phone: "",
  email: "",
  relationship: "",
  interests: [],
  product_interest: "",
  quantity: "1",
  recipient_name: "",
  recipient_phone: "",
  delivery_address: "",
  delivery_notes: "",
  organization: "",
  facility_type: "",
  job_title: "",
  address: "",
  care_recipients_estimate: "",
  timeline: "",
  device_quantity: "",
  integration_requirements: "",
  consent: false,
  website: "",
};

export const defaultMessages = (): Record<Variant, string> => ({ ...CONTACT.defaultMessage });

type Kind = "line" | "multi" | "email" | "phone" | "count" | "enum" | "multiEnum" | "consent";
export interface FieldSpec {
  name: FieldName;
  kind: Kind;
  required: boolean;
  max?: number;
}

const f = (name: FieldName, kind: Kind, required: boolean, max?: number): FieldSpec => ({ name, kind, required, max });

/** Fields of each variant, in display order. `required` matches the server schema. */
export const FIELDS: Record<Variant, FieldSpec[]> = {
  individual_consultation: [
    f("full_name", "line", true, 120),
    f("phone", "phone", true),
    f("email", "email", true),
    f("relationship", "enum", false),
    f("interests", "multiEnum", false),
    f("message", "multi", true, 2000),
    f("consent", "consent", true),
  ],
  individual_purchase: [
    f("full_name", "line", true, 120),
    f("phone", "phone", true),
    f("email", "email", true),
    f("product_interest", "line", false, 200),
    f("quantity", "count", true, 20),
    f("recipient_name", "line", true, 120),
    f("recipient_phone", "phone", true),
    f("delivery_address", "line", true, 300),
    f("delivery_notes", "multi", false, 500),
    f("message", "multi", false, 2000),
    f("consent", "consent", true),
  ],
  facility_consultation: [
    f("organization", "line", true, 200),
    f("full_name", "line", true, 120),
    f("email", "email", true),
    f("phone", "phone", true),
    f("facility_type", "enum", false),
    f("job_title", "line", false, 120),
    f("address", "line", false, 300),
    f("care_recipients_estimate", "count", false, 100_000),
    f("timeline", "enum", false),
    f("message", "multi", true, 2000),
    f("consent", "consent", true),
  ],
  facility_purchase: [
    f("organization", "line", true, 200),
    f("full_name", "line", true, 120),
    f("email", "email", true),
    f("phone", "phone", true),
    f("address", "line", true, 300),
    f("device_quantity", "count", true, 10_000),
    f("job_title", "line", false, 120),
    f("timeline", "enum", false),
    f("integration_requirements", "multi", false, 1000),
    f("message", "multi", false, 2000),
    f("consent", "consent", true),
  ],
};

export const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[^\s@<>()[\]\\,;:"'.]{2,}$/;

export function phoneOk(s: string): boolean {
  const v = s.trim();
  if (!/^\+?[0-9 ().-]{8,24}$/.test(v)) return false;
  const digits = v.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15;
}

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

function rawValue(values: ContactValues, message: string, name: FieldName): string | string[] | boolean {
  return name === "message" ? message : values[name];
}

/** Returns an error message per invalid field of the variant (empty object = valid). */
export function validate(variant: Variant, values: ContactValues, message: string): Partial<Record<FieldName, string>> {
  const errors: Partial<Record<FieldName, string>> = {};
  const E = CONTACT.errors;
  for (const spec of FIELDS[variant]) {
    const raw = rawValue(values, message, spec.name);
    if (spec.kind === "consent") {
      if (raw !== true) errors[spec.name] = E.consent;
      continue;
    }
    if (spec.kind === "multiEnum") continue;
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) {
      if (spec.required) errors[spec.name] = spec.kind === "enum" ? E.choose : E.required;
      continue;
    }
    if (spec.kind === "email" && (v.length > 254 || !EMAIL_PATTERN.test(v))) errors[spec.name] = E.email;
    else if (spec.kind === "phone" && !phoneOk(v)) errors[spec.name] = E.phone;
    else if (spec.kind === "count") {
      const n = /^\d{1,6}$/.test(v) ? Number(v) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > (spec.max ?? 1)) errors[spec.name] = fill(E.count, { max: (spec.max ?? 1).toLocaleString("vi-VN") });
    } else if (spec.max && v.length > spec.max) errors[spec.name] = fill(E.tooLong, { max: spec.max });
  }
  return errors;
}

/** The request body for the variant: only its own fields, blanks as null, counts as numbers. */
export function buildPayload(variant: Variant, values: ContactValues, message: string): Record<string, unknown> {
  const body: Record<string, unknown> = { category: variant, website: values.website, privacy_notice_version: CONTACT.privacyNoticeVersion };
  for (const spec of FIELDS[variant]) {
    const raw = rawValue(values, message, spec.name);
    if (spec.kind === "consent") body[spec.name] = raw === true;
    else if (spec.kind === "multiEnum") body[spec.name] = Array.isArray(raw) ? raw : [];
    else {
      const v = typeof raw === "string" ? raw.trim() : "";
      body[spec.name] = v === "" ? null : spec.kind === "count" ? Number(v) : v;
    }
  }
  return body;
}

/** Maps server field names from a 422 to the variant's fields (unknown names are ignored). */
export function serverFieldErrors(variant: Variant, fields: string[]): Partial<Record<FieldName, string>> {
  const known = new Set(FIELDS[variant].map((s) => s.name as string));
  const out: Partial<Record<FieldName, string>> = {};
  for (const name of fields) if (known.has(name)) out[name as FieldName] = CONTACT.failure.invalid;
  return out;
}
