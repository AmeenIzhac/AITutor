import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Send, Image as ImageIcon, Video, VideoOff } from 'lucide-react';
import OpenAI from 'openai';
import posthog from 'posthog-js';
import dictionary from './dictionary.json';
import LLMOutputRenderer from './LLMPrettyPrint';
import renderMathInElement from 'katex/contrib/auto-render';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import ChatPage from './pages/ChatPage';

// Initialize PostHog
posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
  loaded: (posthog) => {
    if (import.meta.env.DEV) posthog.debug();
  },
  capture_pageview: true, // Tracks pageviews automatically
  capture_performance: true, // Tracks performance
  disable_session_recording: false, // Enables session recording
  session_recording: {
    maskAllInputs: false,
    maskInputOptions: {
        password: true
    }
  }
});

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
});

type Message = {
  id: string;
  type: 'user' | 'bot';
  content: string;
  image?: string;
  loading?: boolean;
  streaming?: boolean;
};

const getTermDefinition = (content: string): string | null => {
  if (content in dictionary) {
    return dictionary[content]["definition"] || null;
  }
  return null;
};

// Update the prettyPrintResponse function to only handle bold text
const prettyPrintResponse = (text: string): JSX.Element => {
  const parts: (string | JSX.Element)[] = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let boldMatch;

  while ((boldMatch = boldRegex.exec(text)) !== null) {
    const [fullMatch, innerText] = boldMatch;
    const matchIdx = boldMatch.index;

    // Add text before the bold section
    if (matchIdx > lastIdx) {
      parts.push(text.slice(lastIdx, matchIdx));
    }

    // Add bold text
    parts.push(<strong key={`bold-${matchIdx}`}>{innerText}</strong>);

    lastIdx = matchIdx + fullMatch.length;
  }

  // Add any remaining text
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return <>{parts}</>;
};

// Add this helper function before the App component
const splitMessageIntoParts = (content: string): string[] => {
  return content.split('###').map(part => part.trim()).filter(part => part.length > 0);
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/chat" element={<ChatPage />} />
      </Routes>
    </Router>
  );
}

export default App;