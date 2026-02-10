"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardList, Shield, Lock, ArrowLeft } from "lucide-react";

type LoginMode = "choose" | "team" | "supervisor" | "admin";

interface ListItem {
  id: number;
  name: string;
}

export default function LoginPage() {
  const { user, loading, login, adminLogin } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<LoginMode>("choose");
  const [pin, setPin] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [adminPassword, setAdminPassword] = useState("");

  useEffect(() => {
    if (!loading && user) {
      if (user.type === "team") router.push("/team");
      else if (user.type === "supervisor") router.push("/supervisor");
      else if (user.type === "admin") router.push("/admin/setup");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (mode === "team" || mode === "supervisor") {
      fetch(`/api/auth/list?type=${mode}`)
        .then((r) => r.json())
        .then((data) => {
          setListItems(data.items || []);
        })
        .catch(() => {});
    }
  }, [mode]);

  const handleLogin = async () => {
    setError("");
    setSubmitting(true);

    if (mode === "admin") {
      const result = await adminLogin(adminPassword);
      setSubmitting(false);
      if (!result.success) {
        setError(result.error || "Invalid password");
      }
      return;
    }

    if (!selectedId) {
      setError("Please select your name");
      setSubmitting(false);
      return;
    }
    if (!pin || pin.length < 4) {
      setError("Please enter your 4-digit PIN");
      setSubmitting(false);
      return;
    }

    const result = await login(mode, Number(selectedId), pin);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || "Login failed");
    }
  };

  const resetForm = () => {
    setMode("choose");
    setPin("");
    setSelectedId("");
    setError("");
    setAdminPassword("");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (user) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-blue-50 to-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">Rubicon Stocktake</h1>
          <p className="text-muted-foreground mt-2">Annual Stock Count 2026</p>
        </div>

        {mode === "choose" && (
          <div className="space-y-4">
            <Button
              onClick={() => setMode("team")}
              className="w-full h-20 text-xl gap-3"
              size="lg"
            >
              <ClipboardList className="h-8 w-8" />
              Team Login
            </Button>
            <Button
              onClick={() => setMode("supervisor")}
              variant="outline"
              className="w-full h-20 text-xl gap-3 border-2"
              size="lg"
            >
              <Shield className="h-8 w-8" />
              Supervisor Login
            </Button>
            <Button
              onClick={() => setMode("admin")}
              variant="ghost"
              className="w-full h-12 text-sm text-muted-foreground gap-2"
            >
              <Lock className="h-4 w-4" />
              Admin Setup
            </Button>
          </div>
        )}

        {mode !== "choose" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetForm}
                  className="touch-target"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <CardTitle className="text-xl">
                  {mode === "team"
                    ? "Team Login"
                    : mode === "supervisor"
                    ? "Supervisor Login"
                    : "Admin Login"}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {mode === "admin" ? (
                <div className="space-y-2">
                  <Label htmlFor="admin-password" className="text-base">
                    Admin Password
                  </Label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="h-14 text-lg"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-base">
                      {mode === "team" ? "Select Team" : "Select Name"}
                    </Label>
                    <Select value={selectedId} onValueChange={setSelectedId}>
                      <SelectTrigger className="h-14 text-lg">
                        <SelectValue
                          placeholder={
                            mode === "team"
                              ? "Choose your team..."
                              : "Choose your name..."
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {listItems.map((item) => (
                          <SelectItem
                            key={item.id}
                            value={String(item.id)}
                            className="text-lg py-3"
                          >
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pin" className="text-base">
                      Enter PIN
                    </Label>
                    <Input
                      id="pin"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={pin}
                      onChange={(e) =>
                        setPin(e.target.value.replace(/\D/g, ""))
                      }
                      placeholder="Enter your PIN"
                      className="h-14 text-2xl text-center tracking-[0.5em]"
                      onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                    />
                  </div>
                </>
              )}

              {error && (
                <div className="text-destructive text-center font-medium bg-destructive/10 p-3 rounded-lg">
                  {error}
                </div>
              )}

              <Button
                onClick={handleLogin}
                disabled={submitting}
                className="w-full h-14 text-lg"
                size="lg"
              >
                {submitting ? "Logging in..." : "Login"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
