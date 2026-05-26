"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel } from "@/components/ui";
import { API_BASE, api, type AdminUser } from "@/lib/api";

const roles: AdminUser["role"][] = ["admin", "owner", "viewer"];

export default function SettingsPage() {
  const [me, setMe] = useState<AdminUser | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminUser["role"]>("admin");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userQuery, setUserQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [userSort, setUserSort] = useState("created_desc");

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setError("");
    setMessage("");
    const currentUser = await api<AdminUser>("/me");
    setMe(currentUser);

    try {
      setUsers(await api<AdminUser[]>("/users"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load admin users");
    } finally {
      setLoadingUsers(false);
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");

    try {
      await api<AdminUser>("/users", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      setEmail("");
      setPassword("");
      setRole("admin");
      setMessage("Account created");
      setUsers(await api<AdminUser[]>("/users"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    }
  }

  async function updateUser(user: AdminUser, nextRole: AdminUser["role"]) {
    setError("");
    setMessage("");

    try {
      const updated = await api<AdminUser>(`/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({ email: user.email, role: nextRole }),
      });
      setUsers((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setMessage("Account updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    }
  }

  async function resetPassword(user: AdminUser) {
    const nextPassword = window.prompt(`New password for ${user.email}`);
    if (!nextPassword) return;

    setError("");
    setMessage("");

    try {
      await api<AdminUser>(`/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({ email: user.email, role: user.role, password: nextPassword }),
      });
      setMessage("Password updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!window.confirm(`Delete ${user.email}?`)) return;

    setError("");
    setMessage("");

    try {
      await api<{ ok: boolean }>(`/users/${user.id}`, { method: "DELETE" });
      setUsers((items) => items.filter((item) => item.id !== user.id));
      setMessage("Account deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
    }
  }

  const canManageUsers = me?.role === "owner";
  const filteredUsers = useMemo(() => {
    const normalizedQuery = userQuery.trim().toLowerCase();
    return [...users]
      .filter((user) => (!normalizedQuery || [user.email, user.role].join(" ").toLowerCase().includes(normalizedQuery))
        && (roleFilter === "all" || user.role === roleFilter))
      .sort((a, b) => {
        if (userSort === "email_asc") return a.email.localeCompare(b.email);
        if (userSort === "role_asc") return a.role.localeCompare(b.role);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [roleFilter, userQuery, userSort, users]);

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Manage API access, storage, and admin accounts.</p>
      </div>

      <div className="grid gap-4">
        <Panel>
          <h2 className="mb-2 font-semibold">API</h2>
          <p className="text-sm text-muted">{API_BASE}</p>
          <p className="mt-2 text-sm text-muted">OpenAPI docs are served by the Rust backend at /docs and /openapi.json.</p>
        </Panel>

        <Panel>
          <h2 className="mb-2 font-semibold">Signed storage</h2>
          <p className="text-sm text-muted">The admin app never connects to Postgres, R2, or MinIO directly. Uploads and playback URLs are mediated by the Rust API.</p>
        </Panel>

        <Panel>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Admin accounts</h2>
              <p className="mt-1 text-sm text-muted">Owners can create, delete, and adjust users that can sign in here.</p>
            </div>
            {me && <span className="rounded-ui border border-border px-2 py-1 text-xs text-muted">{me.email} · {me.role}</span>}
          </div>

          {!canManageUsers && (
            <p className="rounded-ui border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink">
              Owner access is required to manage admin accounts.
            </p>
          )}

          {canManageUsers && (
            <form onSubmit={createUser} className="soft-section mb-5 grid gap-3 p-4 md:grid-cols-[1fr_1fr_160px_auto] md:items-end">
              <Field label="Email">
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" type="email" required />
              </Field>
              <Field label="Password">
                <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" type="password" required minLength={10} />
              </Field>
              <Field label="Role">
                <select value={role} onChange={(e) => setRole(e.target.value as AdminUser["role"])}>
                  {roles.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </Field>
              <Button type="submit" className="w-full md:w-auto">Create account</Button>
            </form>
          )}

          {message && <p className="mb-3 rounded-ui border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">{message}</p>}
          {error && <p className="mb-3 rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

          <div className="mb-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_170px]">
            <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search accounts" />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter accounts">
              <option value="all">All roles</option>
              {roles.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={userSort} onChange={(e) => setUserSort(e.target.value)} aria-label="Sort accounts">
              <option value="created_desc">Newest first</option>
              <option value="email_asc">Email A-Z</option>
              <option value="role_asc">Role A-Z</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-ui border border-border">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="bg-ink/[0.04] text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingUsers && (
                  <tr>
                    <td className="px-3 py-4 text-muted" colSpan={4}>Loading accounts...</td>
                  </tr>
                )}
                {!loadingUsers && filteredUsers.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-muted" colSpan={4}>No matching accounts found.</td>
                  </tr>
                )}
                {filteredUsers.map((user) => (
                  <tr key={user.id} className="border-t border-border">
                    <td className="px-3 py-3 font-medium text-ink">{user.email}</td>
                    <td className="px-3 py-3">
                      <select
                        value={user.role}
                        onChange={(e) => updateUser(user, e.target.value as AdminUser["role"])}
                        disabled={!canManageUsers}
                        className="h-8 py-1"
                      >
                        {roles.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-3 text-muted">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => resetPassword(user)} disabled={!canManageUsers}>Reset password</Button>
                        <Button type="button" variant="danger" onClick={() => deleteUser(user)} disabled={!canManageUsers || user.id === me?.id}>
                          <Trash2 size={15} /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
