"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "@clerk/nextjs";
import { BotIcon } from "lucide-react";

interface MessageBubbleProps {
  content: string;
  isUser?: boolean;
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Lightweight markdown so answers don't display raw ** and * characters. */
const markdownToHtml = (text: string): string => {
  let html = escapeHtml(text);

  html = html
    .replace(/^### (.+)$/gm, '<h3 class="font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="font-semibold text-base mt-3 mb-1">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[\*\-]\s+(.+)$/gm, '<div class="pl-4">• $1</div>')
    .replace(/^(\d+)\.\s+(.+)$/gm, '<div class="pl-4">$1. $2</div>');

  html = html
    .replace(/\n+/g, "<br/>")
    .replace(/<\/div><br\/>/g, "</div>")
    .replace(/<br\/><h([23])/g, "<h$1");

  return html;
};

/** Remove tool activity saved by older versions so only the answer remains. */
const stripToolArtifacts = (text: string): string =>
  text
    .replace(/<div class="tool-card[\s\S]*?<!--\/tool-card-->/g, "")
    .replace(/---START---[\s\S]*?---END---/g, "");

const formatMessage = (content: string): string => {
  // Normalise escapes produced by older saved messages.
  content = content.replace(/\\\\/g, "\\").replace(/\\n/g, "\n");

  // Hide tool cards/terminal logs from previous chats too.
  content = stripToolArtifacts(content).trim();

  return content ? markdownToHtml(content) : "";
};

export function MessageBubble({ content, isUser }: MessageBubbleProps) {
  const { user } = useUser();

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`rounded-2xl px-4 py-2.5 max-w-[85%] md:max-w-[75%] shadow-sm ring-1 ring-inset relative ${
          isUser
            ? "bg-blue-600 text-white rounded-br-none ring-blue-700"
            : "bg-white text-gray-900 rounded-bl-none ring-gray-200"
        }`}
      >
        <div className="text-[15px] leading-relaxed break-words">
          <div dangerouslySetInnerHTML={{ __html: formatMessage(content) }} />
        </div>
        <div
          className={`absolute bottom-0 ${
            isUser
              ? "right-0 translate-x-1/2 translate-y-1/2"
              : "left-0 -translate-x-1/2 translate-y-1/2"
          }`}
        >
          <div
            className={`w-8 h-8 rounded-full border-2 ${
              isUser ? "bg-white border-gray-100" : "bg-blue-600 border-white"
            } flex items-center justify-center shadow-sm`}
          >
            {isUser ? (
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.imageUrl} />
                <AvatarFallback>
                  {user?.firstName?.charAt(0)}
                  {user?.lastName?.charAt(0)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <BotIcon className="h-5 w-5 text-white" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
