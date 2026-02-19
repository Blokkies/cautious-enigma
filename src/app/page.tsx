"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
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
import { ClipboardList, Shield, Lock, ArrowLeft, MapPin, ArrowRight, BarChart3, Users, Package, Eye, Briefcase } from "lucide-react";

type LoginStep = "choose" | "event" | "credentials" | "admin" | "executive";

interface ListItem {
  id: number;
  name: string;
  members?: string | null;
}

interface EventInfo {
  id: number;
  name: string;
  location: string | null;
  status: string;
  teamCount: number;
  supervisorCount: number;
  auditorCount: number;
}

export default function LoginPage() {
  const { user, loading, login, adminLogin, executiveLogin } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<LoginStep>("choose");
  const [loginType, setLoginType] = useState<"team" | "supervisor" | "auditor">("team");
  const [pin, setPin] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [adminPassword, setAdminPassword] = useState("");
  const [executivePassword, setExecutivePassword] = useState("");
  const [events, setEvents] = useState<EventInfo[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      if (user.type === "team") router.push("/team");
      else if (user.type === "supervisor") router.push("/supervisor");
      else if (user.type === "auditor") router.push("/supervisor");
      else if (user.type === "admin") router.push("/admin/dashboard");
      else if (user.type === "executive") router.push("/executive");
    }
  }, [user, loading, router]);

  const handleModeSelect = async (type: "team" | "supervisor" | "auditor") => {
    setLoginType(type);
    setError("");
    setLoadingEvents(true);

    try {
      const res = await fetch("/api/auth/list?type=events");
      const data = await res.json();
      const eventList: EventInfo[] = data.events || [];

      const relevantEvents = eventList.filter((e) =>
        type === "team" ? e.teamCount > 0 : type === "auditor" ? e.auditorCount > 0 : e.supervisorCount > 0
      );

      if (relevantEvents.length === 0) {
        setError(`No events with ${type === "team" ? "teams" : type === "auditor" ? "auditors" : "supervisors"} available`);
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

    if (step === "executive") {
      const result = await executiveLogin(executivePassword);
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
    setExecutivePassword("");
    setEvents([]);
    setSelectedEventId(null);
    setListItems([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-lg text-slate-400">Loading...</div>
      </div>
    );
  }

  if (user) return null;

  const statusColors: Record<string, string> = {
    setup: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel - branding */}
      <div className="lg:w-[45%] bg-slate-950 text-white p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        {/* Accent gradient */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center">
              <Package className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Rubicon</h1>
              <p className="text-xs text-slate-400 uppercase tracking-widest">Stocktake</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 hidden lg:block">
          <h2 className="text-4xl font-bold tracking-tight leading-tight mb-4">
            Annual Stock<br />Count 2026
          </h2>
          <p className="text-slate-400 text-lg max-w-sm">
            Inventory verification system for warehouse teams and supervisors.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-slate-400">
                <Users className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider">Teams</span>
              </div>
              <p className="text-sm text-slate-500">Bin-based counting with offline support</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-slate-400">
                <Shield className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider">Supervisors</span>
              </div>
              <p className="text-sm text-slate-500">Real-time monitoring and approvals</p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-slate-400">
                <BarChart3 className="h-4 w-4" />
                <span className="text-xs uppercase tracking-wider">Analytics</span>
              </div>
              <p className="text-sm text-slate-500">Variance tracking and audit reports</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 hidden lg:block">
          <div className="border-t border-slate-800 pt-4">
            <p className="text-xs text-slate-600">Rubicon Industrial Tech</p>
          </div>
        </div>

        {/* Mobile: just show subtitle */}
        <div className="relative z-10 lg:hidden mt-4">
          <p className="text-slate-400">Annual Stock Count 2026</p>
        </div>
      </div>

      {/* Right panel - login */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 bg-slate-50">
        <div className="w-full max-w-md">
          {/* Step 1: Choose login type */}
          {step === "choose" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
                <p className="text-slate-500 mt-1">Select your role to continue</p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => handleModeSelect("team")}
                  disabled={loadingEvents}
                  className="w-full group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-md hover:shadow-blue-500/5 transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-blue-500 flex items-center justify-center shrink-0">
                      <ClipboardList className="h-6 w-6 text-white" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-slate-900">
                        {loadingEvents && loginType === "team" ? "Loading..." : "Team Login"}
                      </div>
                      <div className="text-sm text-slate-500">Count items assigned to your team</div>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-blue-500 transition-colors" />
                </button>

                <button
                  onClick={() => handleModeSelect("supervisor")}
                  disabled={loadingEvents}
                  className="w-full group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-xl hover:border-emerald-300 hover:shadow-md hover:shadow-emerald-500/5 transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-emerald-600 flex items-center justify-center shrink-0">
                      <Shield className="h-6 w-6 text-white" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-slate-900">
                        {loadingEvents && loginType === "supervisor" ? "Loading..." : "Supervisor Login"}
                      </div>
                      <div className="text-sm text-slate-500">Monitor progress and review variances</div>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                </button>

                <button
                  onClick={() => handleModeSelect("auditor")}
                  disabled={loadingEvents}
                  className="w-full group flex items-center justify-between p-5 bg-white border border-slate-200 rounded-xl hover:border-amber-300 hover:shadow-md hover:shadow-amber-500/5 transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-12 w-12 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
                      <Eye className="h-6 w-6 text-white" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-slate-900">
                        {loadingEvents && loginType === "auditor" ? "Loading..." : "Auditor Login"}
                      </div>
                      <div className="text-sm text-slate-500">Read-only access to supervisor views</div>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-amber-500 transition-colors" />
                </button>
              </div>

              <div className="pt-2 flex items-center justify-center gap-4">
                <button
                  onClick={() => { setStep("executive"); setError(""); }}
                  className="flex items-center gap-2 py-3 text-sm text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Briefcase className="h-3.5 w-3.5" />
                  Executive Dashboard
                </button>
                <span className="text-slate-300">|</span>
                <button
                  onClick={() => { setStep("admin"); setError(""); }}
                  className="flex items-center gap-2 py-3 text-sm text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Admin Setup
                </button>
              </div>

              {error && (
                <div className="text-red-600 text-center text-sm font-medium bg-red-50 border border-red-100 p-3 rounded-lg">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Event picker */}
          {step === "event" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-white transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 text-slate-600" />
                </button>
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Select Event</h2>
                  <p className="text-slate-500 text-sm">Choose the stocktake event</p>
                </div>
              </div>

              <div className="space-y-2">
                {events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => handleEventSelect(event.id)}
                    className="w-full group text-left p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-md hover:shadow-blue-500/5 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">{event.name}</div>
                        {event.location && (
                          <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {event.location}
                          </div>
                        )}
                        <div className="text-xs text-slate-400 mt-1.5">
                          {loginType === "team"
                            ? `${event.teamCount} team${event.teamCount !== 1 ? "s" : ""}`
                            : loginType === "auditor"
                              ? `${event.auditorCount} auditor${event.auditorCount !== 1 ? "s" : ""}`
                              : `${event.supervisorCount} supervisor${event.supervisorCount !== 1 ? "s" : ""}`}
                        </div>
                      </div>
                      <Badge variant="outline" className={statusColors[event.status] || ""}>
                        {event.status}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>

              {error && (
                <div className="text-red-600 text-center text-sm font-medium bg-red-50 border border-red-100 p-3 rounded-lg">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Credentials */}
          {step === "credentials" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-white transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 text-slate-600" />
                </button>
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    {loginType === "team" ? "Team Login" : loginType === "auditor" ? "Auditor Login" : "Supervisor Login"}
                  </h2>
                  {selectedEventId && events.length > 0 && (
                    <p className="text-slate-500 text-sm">
                      {events.find((e) => e.id === selectedEventId)?.name}
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">
                    {loginType === "team" ? "Select Team" : loginType === "auditor" ? "Select Name" : "Select Name"}
                  </Label>
                  <Select value={selectedId} onValueChange={setSelectedId}>
                    <SelectTrigger className="h-12 text-base bg-slate-50 border-slate-200">
                      <SelectValue
                        placeholder={
                          loginType === "team"
                            ? "Choose your team..."
                            : "Choose your name..."
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {listItems.map((item) => {
                        let displayName = item.name;
                        if (loginType === "team" && item.members) {
                          try {
                            const members = JSON.parse(item.members) as string[];
                            if (members.length > 0) displayName = `${item.name} — ${members.join(", ")}`;
                          } catch { /* ignore parse errors */ }
                        }
                        return (
                          <SelectItem
                            key={item.id}
                            value={String(item.id)}
                            className="text-base py-3"
                          >
                            {displayName}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pin" className="text-sm font-medium text-slate-700">
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
                    placeholder="****"
                    className="h-12 text-2xl text-center tracking-[0.5em] bg-slate-50 border-slate-200"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>

                {error && (
                  <div className="text-red-600 text-center text-sm font-medium bg-red-50 border border-red-100 p-3 rounded-lg">
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleLogin}
                  disabled={submitting}
                  className="w-full h-12 text-base font-medium"
                  size="lg"
                >
                  {submitting ? "Signing in..." : "Sign In"}
                </Button>
              </div>
            </div>
          )}

          {/* Executive login */}
          {step === "executive" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={resetForm}
                  className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-white transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 text-slate-600" />
                </button>
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Executive Login</h2>
                  <p className="text-slate-500 text-sm">Executive dashboard access</p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="exec-password" className="text-sm font-medium text-slate-700">
                    Executive Password
                  </Label>
                  <Input
                    id="exec-password"
                    type="password"
                    value={executivePassword}
                    onChange={(e) => setExecutivePassword(e.target.value)}
                    placeholder="Enter executive password"
                    className="h-12 text-base bg-slate-50 border-slate-200"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>

                {error && (
                  <div className="text-red-600 text-center text-sm font-medium bg-red-50 border border-red-100 p-3 rounded-lg">
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleLogin}
                  disabled={submitting}
                  className="w-full h-12 text-base font-medium"
                  size="lg"
                >
                  {submitting ? "Signing in..." : "Sign In"}
                </Button>
              </div>
            </div>
          )}

          {/* Admin login */}
          {step === "admin" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  onClick={resetForm}
                  className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-white transition-colors"
                >
                  <ArrowLeft className="h-4 w-4 text-slate-600" />
                </button>
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Admin Login</h2>
                  <p className="text-slate-500 text-sm">System administration access</p>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="admin-password" className="text-sm font-medium text-slate-700">
                    Admin Password
                  </Label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="h-12 text-base bg-slate-50 border-slate-200"
                    onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                  />
                </div>

                {error && (
                  <div className="text-red-600 text-center text-sm font-medium bg-red-50 border border-red-100 p-3 rounded-lg">
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleLogin}
                  disabled={submitting}
                  className="w-full h-12 text-base font-medium"
                  size="lg"
                >
                  {submitting ? "Signing in..." : "Sign In"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
