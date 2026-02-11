"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, UserCog } from "lucide-react";
import { toast } from "sonner";

interface AdminInfo {
  id: number;
  name: string;
  createdAt: string;
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [adminsList, setAdminsList] = useState<AdminInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", password: "", confirmPassword: "" });

  const loadAdmins = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/admins");
      if (res.ok) {
        const data = await res.json();
        setAdminsList(data.admins || []);
      }
    } catch {
      toast.error("Failed to load admins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAdmins();
  }, [loadAdmins]);

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
    </div>
  );
}
