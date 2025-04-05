import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Send, Image as ImageIcon } from 'lucide-react';
import OpenAI from 'openai';
import posthog from 'posthog-js';

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

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Hello! How can I help you today? Feel free to send messages, share images, or paste images (Ctrl+V).',
    },
  ]);
  const [input, setInput] = useState('');
  const [tempImage, setTempImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processMessageWithOpenAI = async (content: string, imageUrl?: string) => {
    try {
      // Track message sent event
      posthog.capture('message_sent', {
        has_image: !!imageUrl,
        content_length: content.length
      });

      setIsLoading(true);
      const messageId = Date.now().toString();
      
      const streamingMessage: Message = {
        id: messageId,
        type: 'bot',
        content: '',
        streaming: true
      };
      setMessages(prev => [...prev, streamingMessage]);

      // Create conversation history from previous messages
      const conversationHistory = messages
        .filter(msg => !msg.streaming) // Exclude any currently streaming message
        .map(msg => {
          if (msg.type === 'user' && msg.image) {
            return {
              role: 'user',
              content: [
                { type: "text", text: msg.content },
                {
                  type: "image_url",
                  image_url: {
                    url: msg.image,
                  },
                },
              ],
            };
          }
          return {
            role: msg.type === 'user' ? 'user' : 'assistant',
            content: msg.content
          };
        });

      let response;
      if (imageUrl) {
        response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            ...conversationHistory,
            {
              role: "user",
              content: [
                { type: "text", text: content },
                {
                  type: "image_url",
                  image_url: {
                    url: imageUrl,
                  },
                },
              ],
            },
          ],
          max_tokens: 500,
          stream: true,
        });
      } else {
        response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            ...conversationHistory,
            { role: "user", content }
          ],
          max_tokens: 500,
          stream: true,
        });
      }
      console.log(messages)

      let fullContent = '';
      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || '';
        fullContent += content;
        
        setMessages(prev => prev.map(msg => 
          msg.id === messageId && msg.type === 'bot'
            ? { ...msg, content: fullContent }
            : msg
        ));
      }

      setMessages(prev => prev.map(msg => 
        msg.id === messageId && msg.type === 'bot'
          ? { ...msg, streaming: false }
          : msg
      ));

    } catch (error) {
      // Track error event
      posthog.capture('api_error', {
        error: error.message
      });
      console.error('Error processing message:', error);
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'bot',
        content: 'I apologize, but I encountered an error processing your request. Please try again.',
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (input.trim() || tempImage) {
      const newMessage: Message = {
        id: Date.now().toString(),
        type: 'user',
        content: input.trim() || '',
        image: tempImage || undefined,
      };
      setMessages(prev => [...prev, newMessage]);
      const currentInput = input;
      setInput('');
      setTempImage(null);
      
      await processMessageWithOpenAI(currentInput, tempImage || undefined);
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Track image upload event
      posthog.capture('image_uploaded', {
        file_type: file.type,
        file_size: file.size
      });
      const reader = new FileReader();
      reader.onload = async (e) => {
        const imageData = e.target?.result as string;
        setTempImage(imageData);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = async (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        // Track image paste event
        posthog.capture('image_pasted', {
          file_type: item.type
        });
        event.preventDefault();
        
        const file = item.getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = async (e) => {
          const imageData = e.target?.result as string;
          setTempImage(imageData);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleRemoveImage = () => {
    setTempImage(null);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.addEventListener('paste', handlePaste);
      return () => input.removeEventListener('paste', handlePaste);
    }
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Track page view on component mount
  useEffect(() => {
    posthog.capture('app_opened');
  }, []);

  return (
    <div className="h-screen bg-[#1A1A1A] flex items-center justify-center">
      <div className="w-full h-full bg-[#1A1A1A] flex flex-col">
        <div 
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto px-96 py-4 space-y-4"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex flex-col ${
                message.type === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {message.image && (
                <div className="mb-2">
                  <img
                    src={message.image}
                    alt="Uploaded content"
                    className="max-w-[70%] rounded-lg"
                  />
                </div>
              )}
              {(message.content || message.streaming) && (
                <div
                  className={`max-w-[70%] rounded-2xl p-3 ${
                    message.type === 'user'
                      ? 'bg-[#3E3F4B] text-white'
                      : 'text-white'
                  }`}
                >
                  <p className="text-sm">
                    {message.content}
                    {message.streaming && message.type === 'bot' && '▊'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-96 py-4">
          {tempImage && (
            <div className="mb-4 relative inline-block">
              <img
                src={tempImage}
                alt="Preview"
                className="max-h-32 w-auto object-contain rounded-lg"
              />
              <button
                onClick={handleRemoveImage}
                className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                title="Remove image"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask anything"
              className="w-full p-4 bg-[#2C2C2C] text-white rounded-full focus:outline-none focus:ring-0 placeholder-gray-400"
              disabled={isLoading}
            />
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;