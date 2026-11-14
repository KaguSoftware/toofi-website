"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setUserRole } from "@/lib/admin/actions";
import { ROLES, type Role } from "@/lib/auth/roles";
import { inputCls } from "./ui";

export function UserRoleSelect({ userId, role, disabled, label }: { userId: string; role: Role; disabled?: boolean; label: string }) {
  const [value, setValue] = useState<Role>(role);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled || pending}
      className={`${inputCls} !w-auto !py-1`}
      onChange={(e) => {
        const next = e.target.value as Role;
        const prev = value;
        setValue(next);
        start(async () => {
          const res = await setUserRole(userId, next);
          if (res.ok) {
            toast.success(res.message ?? "Role updated");
            router.refresh();
          } else {
            setValue(prev);
            toast.error(res.error);
          }
        });
      }}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}
