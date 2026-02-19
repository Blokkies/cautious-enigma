"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, UserCog, Briefcase } from "lucide-react";
import { toast } from "sonner";

interface AdminInfo {
  id: number;
  name: string;
  createdAt: string;
}

interface ExecInfo {
  id: number;
  name: string;
  createdAt: string;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [adminsList, setAdminsList] = useState<AdminInfo[]>([]);
  const [execsList, setExecsList] = useState<ExecInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", password: "", confirmPassword: "" });
  const [creatingExec, setCreatingExec] = useState(false);
  const [showExecForm, setShowExecForm] = useState(false);
  const [execForm, setExecForm] = useState({ name: "", password: "", confirmPassword: "" });

  const loadAdmins = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/admins");
      if (res.ok) {
        const data = await res.json();
        setAdminsList(data.admins || []);
      }
    } catch {
      toast.error("Failed to load admins");
    }
  }, []);

  const loadExecs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/executives");
      if (res.ok) {
        const data = await res.json();
        setExecsList(data.executives || []);
      }
    } catch {
      toast.error("Failed to load executives");
    }
  }, []);

  useEffect(() => {
    Promise.all([loadAdmins(), loadExecs()]).finally(() => setLoading(false));
  }, [loadAdmins, loadExecs]);

  const handleCreate = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), password: form.password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Admin "${form.name.trim()}" created`);
        setForm({ name: "", password: "", confirmPassword: "" });
        setShowForm(false);
        loadAdmins();
      } else {
        toast.error(data.error || "Failed to create admin");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (admin: AdminInfo) => {
    if (!confirm(`Delete admin "${admin.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch("/api/admin/admins", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: admin.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Admin "${admin.name}" deleted`);
        loadAdmins();
      } else {
        toast.error(data.error || "Failed to delete admin");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleCreateExec = async () => {
    if (!execForm.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (execForm.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (execForm.password !== execForm.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setCreatingExec(true);
    try {
      const res = await fetch("/api/admin/executives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: execForm.name.trim(), password: execForm.password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Executive "${execForm.name.trim()}" created`);
        setExecForm({ name: "", password: "", confirmPassword: "" });
        setShowExecForm(false);
        loadExecs();
      } else {
        toast.error(data.error || "Failed to create executive");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setCreatingExec(false);
    }
  };

  const handleDeleteExec = async (exec: ExecInfo) => {
    if (!confirm(`Delete executive "${exec.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch("/api/admin/executives", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: exec.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Executive "${exec.name}" deleted`);
        loadExecs();
      } else {
        toast.error(data.error || "Failed to delete executive");
      }
    } catch {
      toast.error("Network error");
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <UserCog className="h-5 w-5" />
              Admin Accounts
            </CardTitle>
            {!showForm && (
              <Button size="sm" onClick={() => setShowForm(true)} className="gap-1">
                <Plus className="h-4 w-4" />
                Add Admin
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {adminsList.map((admin) => {
            const isSelf = user?.id === admin.id;
            const isLast = adminsList.length <= 1;
            return (
              <div
                key={admin.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <div className="font-medium">
                    {admin.name}
                    {isSelf && (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(admin.createdAt + "Z").toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isSelf || isLast}
                  onClick={() => handleDelete(admin)}
                  title={
                    isSelf
                      ? "Cannot delete yourself"
                      : isLast
                        ? "Cannot delete last admin"
                        : `Delete ${admin.name}`
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            );
          })}

          {/* Add Admin Form */}
          {showForm && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="font-medium text-sm">New Admin</div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Admin name"
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Min 6 characters"
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm Password</Label>
                <Input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                  placeholder="Confirm password"
                  className="h-10"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={creating} size="sm">
                  {creating ? "Creating..." : "Create Admin"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowForm(false);
                    setForm({ name: "", password: "", confirmPassword: "" });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Executive Accounts
            </CardTitle>
            {!showExecForm && (
              <Button size="sm" onClick={() => setShowExecForm(true)} className="gap-1">
                <Plus className="h-4 w-4" />
                Add Executive
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {execsList.length === 0 && !showExecForm && (
            <p className="text-sm text-muted-foreground">No executive accounts yet.</p>
          )}
          {execsList.map((exec) => {
            const isLast = execsList.length <= 1;
            return (
              <div
                key={exec.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div>
                  <div className="font-medium">{exec.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Created {new Date(exec.createdAt + "Z").toLocaleDateString()}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isLast}
                  onClick={() => handleDeleteExec(exec)}
                  title={isLast ? "Cannot delete last executive" : `Delete ${exec.name}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            );
          })}

          {showExecForm && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="font-medium text-sm">New Executive</div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={execForm.name}
                  onChange={(e) => setExecForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Executive name"
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={execForm.password}
                  onChange={(e) => setExecForm((p) => ({ ...p, password: e.target.value }))}
                  placeholder="Min 6 characters"
                  className="h-10"
                />
              </div>
              <div className="space-y-2">
                <Label>Confirm Password</Label>
                <Input
                  type="password"
                  value={execForm.confirmPassword}
                  onChange={(e) => setExecForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                  placeholder="Confirm password"
                  className="h-10"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateExec()}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleCreateExec} disabled={creatingExec} size="sm">
                  {creatingExec ? "Creating..." : "Create Executive"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowExecForm(false);
                    setExecForm({ name: "", password: "", confirmPassword: "" });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
