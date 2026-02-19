"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { markNotificationSeen } from "@/hooks/use-notifications";

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

export default function SupervisorMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/supervisor/exec-messages");
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchMessages();
    markNotificationSeen("supervisorExecMessages");
    const interval = setInterval(fetchMessages, 5000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;

    setSending(true);
    try {
      const res = await fetch("/api/supervisor/exec-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: newMessage.trim() }),
      });
      if (res.ok) {
        setNewMessage("");
        fetchMessages();
      }
    } catch {}
    setSending(false);
  };

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground">Loading messages...</div>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Executive Messages</h1>

      <Card className="flex flex-col h-[calc(100vh-220px)] min-h-[400px]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Conversation with Executives
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col overflow-hidden p-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No messages yet. Executives or admins can start a conversation with you.</p>
              </div>
            )}
            {messages.map((msg) => {
              const isMine = msg.senderType === "supervisor";
              return (
                <div
                  key={msg.id}
                  className={cn("flex", isMine ? "justify-end" : "justify-start")}
                >
                  <div className={cn(
                    "max-w-[80%] rounded-lg px-3 py-2",
                    isMine
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}>
                    {!isMine && (
                      <div className={cn("text-[10px] mb-0.5", isMine ? "opacity-70" : "text-muted-foreground")}>
                        {msg.senderName} ({msg.senderType})
                      </div>
                    )}
                    <div className="text-sm whitespace-pre-wrap">{msg.message}</div>
                    <div className={cn(
                      "text-[10px] mt-1",
                      isMine ? "opacity-70" : "text-muted-foreground"
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
              placeholder="Type a reply..."
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={sending || !newMessage.trim()} size="icon">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
