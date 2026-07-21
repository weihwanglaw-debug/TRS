import type { AdminUser } from "@/types/config";
import { exportWorkbookSheet } from "@/lib/exportRegistrationPaymentsWorkbook";

const HEADERS = [
  "Name",
  "Email",
  "Role",
  "Last Login",
];

function roleLabel(role: AdminUser["role"]): string {
  return role === "superadmin" ? "Super Admin" : "Event Admin";
}

export async function exportUserAccessWorkbook(users: AdminUser[]) {
  await exportWorkbookSheet({
    filename: "User Access",
    headers: HEADERS,
    rows: users.map(user => [
      user.name,
      user.email,
      roleLabel(user.role),
      user.lastLogin || "Never",
    ]),
    columns: [
      { width: 30 },
      { width: 36 },
      { width: 18 },
      { width: 28 },
    ],
  });
}
