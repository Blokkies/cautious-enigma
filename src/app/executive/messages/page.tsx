"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, ArrowLeft, MessageSquare, Users, Search, X } from "lucide-react";
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

function formatTime(dateStr: string): string {
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export default function ExecutiveMessages() {
  const [groups, setGroups] = useState<SupervisorGroup[]>([]);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedSupervisor, setSelectedSupervisor] = useState<{ id: number; name: string; eventId: number; eventName: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [showSupervisorList, setShowSupervisorList] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    setSearchQuery("");
  };

  const selectThread = (thread: Thread) => {
    setSelectedSupervisor({
      id: thread.supervisor_id,
      name: thread.supervisor_name,
      eventId: thread.event_id,
      eventName: thread.event_name,
    });
  };

  // Filter supervisors by search
  const filteredGroups = groups.map((g) => ({
    ...g,
    supervisors: g.supervisors.filter(
      (s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        g.eventName.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter((g) => g.supervisors.length > 0);

  // Group messages by date
  const messagesByDate: { date: string; messages: Message[] }[] = [];
  let currentDateStr = "";
  for (const msg of messages) {
    const dateStr = formatDate(msg.createdAt);
    if (dateStr !== currentDateStr) {
      currentDateStr = dateStr;
      messagesByDate.push({ date: dateStr, messages: [] });
    }
    messagesByDate[messagesByDate.length - 1].messages.push(msg);
  }

  const showingThread = selectedSupervisor !== null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Messages</h1>
        {!showSupervisorList && (
          <Button
            variant="default"
            size="sm"
            onClick={() => { setShowSupervisorList(true); setTimeout(() => inputRef.current?.focus(), 100); }}
            className="gap-1.5"
          >
            <Users className="h-4 w-4" />
            New Message
          </Button>
        )}
      </div>

      {/* Supervisor picker overlay */}
      {showSupervisorList && (
        <Card className="border-primary/20 shadow-md">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Select Supervisor</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => { setShowSupervisorList(false); setSearchQuery(""); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search supervisors..."
                className="pl-9"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-3">
              {filteredGroups.map((group) => (
                <div key={group.eventId}>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
                    {group.eventName}
                  </div>
                  <div className="space-y-0.5">
                    {group.supervisors.map((sup) => {
                      const existingThread = threads.find((t) => t.supervisor_id === sup.id);
                      return (
                        <button
                          key={sup.id}
                          onClick={() => selectSupervisor(sup, group.eventId, group.eventName)}
                          className="w-full text-left px-3 py-2 rounded-md hover:bg-muted transition-colors text-sm flex items-center justify-between"
                        >
                          <span className="font-medium">{sup.name}</span>
                          {existingThread && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {existingThread.message_count} msgs
                            </Badge>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {filteredGroups.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {searchQuery ? "No supervisors match your search." : "No supervisors available."}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4 h-[calc(100vh-220px)] min-h-[400px]">
        {/* Thread list */}
        <div className={cn(
          "w-full md:w-80 md:shrink-0 flex flex-col border rounded-lg overflow-hidden bg-card",
          showingThread ? "hidden md:flex" : "flex"
        )}>
          <div className="p-3 border-b bg-muted/30">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Conversations</h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 && !showSupervisorList && (
              <div className="text-center py-12 px-4">
                <MessageSquare className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No conversations yet</p>
                <p className="text-xs text-muted-foreground mt-1">Click &quot;New Message&quot; to start one</p>
              </div>
            )}
            {threads.map((thread) => {
              const isActive = selectedSupervisor?.id === thread.supervisor_id;
              return (
                <button
                  key={thread.supervisor_id}
                  onClick={() => selectThread(thread)}
                  className={cn(
                    "w-full text-left p-3 border-b transition-colors",
                    isActive
                      ? "bg-primary/5 border-l-2 border-l-primary"
                      : "hover:bg-muted/50 border-l-2 border-l-transparent"
                  )}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={cn("font-medium text-sm", isActive && "text-primary")}>{thread.supervisor_name}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(thread.last_message_at)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium">{thread.event_name}</div>
                  <div className="text-xs text-muted-foreground truncate mt-1">
                    {thread.last_sender_type === "supervisor" ? (
                      <><span className="font-medium">{thread.supervisor_name}:</span> {thread.last_message}</>
                    ) : (
                      <><span className="font-medium">You:</span> {thread.last_message}</>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Chat panel */}
        <div className={cn(
          "flex-1 flex flex-col border rounded-lg overflow-hidden bg-card",
          !showingThread ? "hidden md:flex" : "flex"
        )}>
          {selectedSupervisor ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/30">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden h-8 w-8 shrink-0"
                  onClick={() => setSelectedSupervisor(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm truncate">{selectedSupervisor.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{selectedSupervisor.eventName}</div>
                </div>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {messages.length === 0 && (
                  <div className="text-center py-12">
                    <MessageSquare className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">Start the conversation</p>
                  </div>
                )}

                {messagesByDate.map((group) => (
                  <div key={group.date}>
                    <div className="flex items-center gap-3 my-4">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted-foreground font-medium px-2">{group.date}</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    <div className="space-y-2">
                      {group.messages.map((msg) => {
                        const isSupervisor = msg.senderType === "supervisor";
                        return (
                          <div
                            key={msg.id}
                            className={cn("flex", isSupervisor ? "justify-start" : "justify-end")}
                          >
                            <div className={cn(
                              "max-w-[75%] rounded-2xl px-3.5 py-2",
                              isSupervisor
                                ? "bg-muted text-foreground rounded-bl-sm"
                                : "bg-primary text-primary-foreground rounded-br-sm"
                            )}>
                              {!isSupervisor && msg.senderType !== "executive" && (
                                <div className="text-[10px] opacity-70 mb-0.5">
                                  {msg.senderName} ({msg.senderType})
                                </div>
                              )}
                              <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.message}</div>
                              <div className={cn(
                                "text-[10px] mt-1",
                                isSupervisor ? "text-muted-foreground" : "opacity-60"
                              )}>
                                {formatTime(msg.createdAt)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              <div className="px-4 py-3 border-t bg-muted/10">
                <div className="flex gap-2">
                  <Input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                    className="flex-1 bg-background"
                  />
                  <Button
                    onClick={handleSend}
                    disabled={sending || !newMessage.trim()}
                    size="icon"
                    className="shrink-0"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <MessageSquare className="h-10 w-10 mx-auto mb-3 text-muted-foreground/20" />
                <p className="text-sm font-medium text-muted-foreground">No conversation selected</p>
                <p className="text-xs text-muted-foreground mt-1">Choose a thread or start a new message</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
