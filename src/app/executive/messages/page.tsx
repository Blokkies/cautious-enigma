"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, ArrowLeft, MessageSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface SupervisorGroup {
  eventId: number;
  eventName: string;
  supervisors: { id: number; name: string }[];
}

interface Thread {
  supervisor_id: number;
  supervisor_name: string;
  event_name: string;
  event_id: number;
  last_message: string;
  last_sender_type: string;
  last_message_at: string;
  message_count: number;
}

interface Message {
  id: number;
  senderId: number;
  senderType: string;
  senderName: string;
  message: string;
  createdAt: string;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function ExecutiveMessages() {
  const [groups, setGroups] = useState<SupervisorGroup[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedSupervisor, setSelectedSupervisor] = useState<{ id: number; name: string; eventId: number; eventName: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showSupervisorList, setShowSupervisorList] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/executive/messages");
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
      }
    } catch {}
  }, []);

  const fetchSupervisors = useCallback(async () => {
    try {
      const res = await fetch("/api/executive/supervisors");
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch {}
  }, []);

  const fetchMessages = useCallback(async (supervisorId: number) => {
    try {
      const res = await fetch(`/api/executive/messages?supervisorId=${supervisorId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchThreads();
    fetchSupervisors();
  }, [fetchThreads, fetchSupervisors]);

  useEffect(() => {
    if (selectedSupervisor) {
      fetchMessages(selectedSupervisor.id);
      const interval = setInterval(() => fetchMessages(selectedSupervisor.id), 5000);
      return () => clearInterval(interval);
    }
  }, [selectedSupervisor, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedSupervisor || sending) return;

    setSending(true);
    try {
      const res = await fetch("/api/executive/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supervisorId: selectedSupervisor.id,
          eventId: selectedSupervisor.eventId,
          message: newMessage.trim(),
        }),
      });
      if (res.ok) {
        setNewMessage("");
        fetchMessages(selectedSupervisor.id);
        fetchThreads();
      }
    } catch {}
    setSending(false);
  };

  const selectSupervisor = (sup: { id: number; name: string }, eventId: number, eventName: string) => {
    setSelectedSupervisor({ id: sup.id, name: sup.name, eventId, eventName });
    setShowSupervisorList(false);
  };

  const selectThread = (thread: Thread) => {
    setSelectedSupervisor({
      id: thread.supervisor_id,
      name: thread.supervisor_name,
      eventId: thread.event_id,
      eventName: thread.event_name,
    });
  };

  // Mobile: show thread or list
  const showingThread = selectedSupervisor !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Messages</h1>
        {!showSupervisorList && (
          <Button variant="outline" size="sm" onClick={() => setShowSupervisorList(true)} className="gap-1">
            <Users className="h-4 w-4" />
            New Message
          </Button>
        )}
      </div>

      {/* Supervisor picker overlay */}
      {showSupervisorList && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Select Supervisor</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowSupervisorList(false)}>Cancel</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.map((group) => (
              <div key={group.eventId}>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  {group.eventName}
                </div>
                <div className="space-y-1">
                  {group.supervisors.map((sup) => (
                    <button
                      key={sup.id}
                      onClick={() => selectSupervisor(sup, group.eventId, group.eventName)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm"
                    >
                      {sup.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">No supervisors available.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[400px]">
        {/* Thread list (desktop always, mobile when no thread selected) */}
        <div className={cn(
          "w-full md:w-80 md:shrink-0 overflow-y-auto",
          showingThread ? "hidden md:block" : "block"
        )}>
          <div className="space-y-1">
            {threads.length === 0 && !showSupervisorList && (
              <p className="text-sm text-muted-foreground p-4 text-center">
                No conversations yet. Click &quot;New Message&quot; to start one.
              </p>
            )}
            {threads.map((thread) => {
              const isActive = selectedSupervisor?.id === thread.supervisor_id;
              return (
                <button
                  key={thread.supervisor_id}
                  onClick={() => selectThread(thread)}
                  className={cn(
                    "w-full text-left p-3 rounded-lg transition-colors",
                    isActive ? "bg-primary/10 border border-primary/20" : "hover:bg-muted border border-transparent"
                  )}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium text-sm">{thread.supervisor_name}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(thread.last_message_at)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{thread.event_name}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {thread.last_sender_type === "supervisor" ? `${thread.supervisor_name}: ` : "You: "}
                    {thread.last_message}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat thread (desktop always, mobile when thread selected) */}
        <div className={cn(
          "flex-1 flex flex-col border rounded-lg bg-white",
          !showingThread ? "hidden md:flex" : "flex"
        )}>
          {selectedSupervisor ? (
            <>
              <div className="flex items-center gap-2 p-3 border-b">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-8 w-8"
                  onClick={() => setSelectedSupervisor(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                  <div className="font-medium text-sm">{selectedSupervisor.name}</div>
                  <div className="text-xs text-muted-foreground">{selectedSupervisor.eventName}</div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map((msg) => {
                  const isSupervisor = msg.senderType === "supervisor";
                  return (
                    <div
                      key={msg.id}
                      className={cn("flex", isSupervisor ? "justify-start" : "justify-end")}
                    >
                      <div className={cn(
                        "max-w-[80%] rounded-lg px-3 py-2",
                        isSupervisor
                          ? "bg-muted text-foreground"
                          : "bg-primary text-primary-foreground"
                      )}>
                        {!isSupervisor && msg.senderType !== "executive" && (
                          <div className="text-[10px] opacity-70 mb-0.5">
                            {msg.senderName} ({msg.senderType})
                          </div>
                        )}
                        <div className="text-sm whitespace-pre-wrap">{msg.message}</div>
                        <div className={cn(
                          "text-[10px] mt-1",
                          isSupervisor ? "text-muted-foreground" : "opacity-70"
                        )}>
                          {timeAgo(msg.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="p-3 border-t flex gap-2">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                  className="flex-1"
                />
                <Button onClick={handleSend} disabled={sending || !newMessage.trim()} size="icon">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Select a conversation or start a new one</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
