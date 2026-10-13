import { createContext, useContext, type ReactNode } from "react";
import type { Permission, Product, RecipientContext } from "../../data/contracts";
import { hasPermission } from "../../data/permissions";

const Ctx = createContext<RecipientContext | null>(null);

export function RecipientProvider({ value, children }: { value: RecipientContext; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecipient() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useRecipient phải nằm trong RecipientProvider");
  const { recipient, permissions } = ctx;
  return {
    ...ctx,
    recipientId: recipient.id,
    can: (p: Permission) => hasPermission(permissions, p),
    enrolled: (product: Product) => recipient.enrollments.some((e) => e.product === product),
  };
}
