"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardList, Shield, Lock, ArrowLeft, MapPin } from "lucide-react";

type LoginStep = "choose" | "event" | "credentials" | "admin";

interface ListItem {
  id: number;
  name: string;
}

interface EventInfo {
  id: number;
  name: string;
  location: string | null;
  status: string;
  teamCount: number;
  supervisorCount: number;
}

export default function LoginPage() {
  const { user, loading, login, adminLogin } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>("choose");
  const [loginType, setLoginType] = useState<"team" | "supervisor">("team");
  const [pin, setPin] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [adminPassword, setAdminPassword] = useState("");
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (user.type === "team") router.push("/team");
      else if (user.type === "supervisor") router.push("/supervisor");
      else if (user.type === "admin") router.push("/admin/setup");
    }
  }, [user, loading, router]);

  const handleModeSelect = async (type: "team" | "supervisor") => {
    setLoginType(type);
    setError("");
    setLoadingEvents(true);

    try {
      const res = await fetch("/api/auth/list?type=events");
      const data = await res.json();
      const eventList: EventInfo[] = data.events || [];

      // Filter events that have teams/supervisors based on login type
      const relevantEvents = eventList.filter((e) =>
        type === "team" ? e.teamCount > 0 : e.supervisorCount > 0
      );

      if (relevantEvents.length === 0) {
        setError(`No events with ${type === "team" ? "teams" : "supervisors"} available`);
        setLoadingEvents(false);
        return;
      }

      setEvents(relevantEvents);
      setStep("event");
    } catch {
      setError("Failed to load events");
    } finally {
      setLoadingEvents(false);
    }
  };

  const loadListItems = async (type: string, eventId: number) => {
    const res = await fetch(`/api/auth/list?type=${type}&eventId=${eventId}`);
    const data = await res.json();
    setListItems(data.items || []);
  };

  const handleEventSelect = async (eventId: number) => {
    setSelectedEventId(eventId);
    setError("");
    try {
      await loadListItems(loginType, eventId);
      setStep("credentials");
    } catch {
      setError("Failed to load teams");
    }
  };

  const handleLogin = async () => {
    setError("");
    setSubmitting(true);

    if (step === "admin") {
      const result = await adminLogin(adminPassword);
      setSubmitting(false);
      if (!result.success) {
        setError(result.error || "Invalid password");
      }
      return;
    }

    if (!selectedId) {
      setError(`Please select your ${loginType === "team" ? "team" : "name"}`);
      setSubmitting(false);
      return;
    }
    if (!pin || pin.length < 4) {
      setError("Please enter your 4-digit PIN");
      setSubmitting(false);
      return;
    }

    const result = await login(loginType, Number(selectedId), pin, selectedEventId ?? undefined);
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || "Login failed");
    }
  };

  const handleBack = () => {
    setError("");
    if (step === "credentials" && events.length > 1) {
      setSelectedId("");
      setPin("");
      setStep("event");
    } else {
      resetForm();
    }
  };

  const resetForm = () => {
    setStep("choose");
    setPin("");
    setSelectedId("");
    setError("");
    setAdminPassword("");
    setEvents([]);
    setSelectedEventId(null);
    setListItems([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (user) return null;

  const statusColors: Record<string, string> = {
    setup: "bg-blue-100 text-blue-800",
    active: "bg-green-100 text-green-800",
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-blue-50 to-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-primary">Rubicon Stocktake</h1>
          <p className="text-muted-foreground mt-2">Annual Stock Count 2026</p>
        </div>

        {/* Step 1: Choose login type */}
        {step === "choose" && (
          <div className="space-y-4">
            <Button
              onClick={() => handleModeSelect("team")}
              disabled={loadingEvents}
              className="w-full h-20 text-xl gap-3"
              size="lg"
            >
              <ClipboardList className="h-8 w-8" />
              {loadingEvents && loginType === "team" ? "Loading..." : "Team Login"}
            </Button>
            <Button
              onClick={() => handleModeSelect("supervisor")}
              disabled={loadingEvents}
              variant="outline"
              className="w-full h-20 text-xl gap-3 border-2"
              size="lg"
            >
              <Shield className="h-8 w-8" />
              {loadingEvents && loginType === "supervisor" ? "Loading..." : "Supervisor Login"}
            </Button>
            <Button
              onClick={() => { setStep("admin"); setError(""); }}
              variant="ghost"
              className="w-full h-12 text-sm text-muted-foreground gap-2"
            >
              <Lock className="h-4 w-4" />
              Admin Setup
            </Button>
            {error && (
              <div className="text-destructive text-center font-medium bg-destructive/10 p-3 rounded-lg">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Event picker (only shown when multiple events) */}
        {step === "event" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="touch-target"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <CardTitle className="text-xl">Select Event</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {events.map((event) => (
                <button
                  key={event.id}
                  onClick={() => handleEventSelect(event.id)}
                  className="w-full text-left p-4 border rounded-lg hover:bg-accent transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold">{event.name}</div>
                      {event.location && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3" />
                          {event.location}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">
                        {loginType === "team"
                          ? `${event.teamCount} team${event.teamCount !== 1 ? "s" : ""}`
                          : `${event.supervisorCount} supervisor${event.supervisorCount !== 1 ? "s" : ""}`}
                      </div>
                    </div>
                    <Badge className={statusColors[event.status] || ""}>
                      {event.status}
                    </Badge>
                  </div>
                </button>
              ))}
              {error && (
                <div className="text-destructive text-center font-medium bg-destructive/10 p-3 rounded-lg">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 3: Credentials (team/supervisor selection + PIN) */}
        {step === "credentials" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleBack}
                  className="touch-target"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                  <CardTitle className="text-xl">
                    {loginType === "team" ? "Team Login" : "Supervisor Login"}
                  </CardTitle>
                  {selectedEventId && events.length > 0 && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {events.find((e) => e.id === selectedEventId)?.name}
                    </p>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-base">
                  {loginType === "team" ? "Select Team" : "Select Name"}
                </Label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger className="h-14 text-lg">
                    <SelectValue
                      placeholder={
                        loginType === "team"
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

        {/* Admin login */}
        {step === "admin" && (
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
                <CardTitle className="text-xl">Admin Login</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
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
