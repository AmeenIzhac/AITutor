import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Send, Image as ImageIcon } from 'lucide-react';
import OpenAI from 'openai';
import posthog from 'posthog-js';
import dictionary from './dictionary.json';

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

// Update the highlight style to be fully rounded
const highlightStyle = {
  backgroundColor: '#4a9eff',
  padding: '0 8px',  // Increased horizontal padding
  borderRadius: '999px',  // Fully rounded
  cursor: 'help',
  color: '#000000',
  fontWeight: 500,
  display: 'inline-block',
  lineHeight: '1.5',
};

// Add these new components before the App component
interface TooltipProps {
  content: string;
  imageUrl?: string;
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ content, imageUrl, children }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isPositioned, setIsPositioned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  const updatePosition = () => {
    if (!containerRef.current || !tooltipRef.current) return;
    
    const wordRect = containerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    
    const top = wordRect.top - tooltipRect.height - 8;
    const left = wordRect.left + (wordRect.width / 2);

    setPosition({ top: top + window.scrollY, left });
    setIsPositioned(true);
  };

  // Add scroll event listener
  useEffect(() => {
    if (isVisible) {
      const handleScroll = () => {
        requestAnimationFrame(updatePosition);
      };

      // Listen for scroll events on the chat container and window
      const chatContainer = document.querySelector('.overflow-y-auto');
      if (chatContainer) {
        chatContainer.addEventListener('scroll', handleScroll, { passive: true });
      }
      window.addEventListener('scroll', handleScroll, { passive: true });

      // Initial position
      setIsPositioned(false);
      requestAnimationFrame(updatePosition);

      return () => {
        if (chatContainer) {
          chatContainer.removeEventListener('scroll', handleScroll);
        }
        window.removeEventListener('scroll', handleScroll);
      };
    }
  }, [isVisible]);

  return (
    <span
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => {
        setIsVisible(false);
        setIsPositioned(false);
      }}
    >
      {children}
      {isVisible && (
        <div
          ref={tooltipRef}
          className="fixed z-50 px-4 py-2 text-sm bg-white text-black shadow-lg"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            transform: 'translateX(-50%)',
            maxWidth: imageUrl ? '300px' : '200px',
            border: '1px solid #e2e2e2',
            fontWeight: 400,
            borderRadius: '16px',
            opacity: isPositioned ? 1 : 0,  // Hide until positioned
            transition: 'opacity 0.1s ease-in-out',
            pointerEvents: isPositioned ? 'auto' : 'none', // Prevent interaction until positioned
          }}
        >
          {imageUrl && (
            <div className="mb-2">
              <img 
                src={imageUrl} 
                alt="Term visualization" 
                className="w-full rounded-lg"
                style={{ maxHeight: '150px', objectFit: 'contain' }}
              />
            </div>
          )}
          {content}
          <div
            className="absolute w-2 h-2 bg-white rotate-45"
            style={{
              bottom: '-5px',
              left: '50%',
              transform: 'translateX(-50%)',
              borderRight: '1px solid #e2e2e2',
              borderBottom: '1px solid #e2e2e2',
            }}
          />
        </div>
      )}
    </span>
  );
};

// Update the highlightDefinedTerms function
const highlightDefinedTerms = (text: string): JSX.Element[] => {
  const words = text.split(/(\s+)/);
  return words.map((word, index) => {
    const term = dictionary[word.trim()];
    if (term && word.trim()) {
      return (
        <Tooltip 
          key={index} 
          content={term.definition}
          imageUrl={term.imageUrl}
        >
          <span style={highlightStyle}>
            {word}
          </span>
        </Tooltip>
      );
    }
    return <React.Fragment key={index}>{word}</React.Fragment>;
  });
};

// Add this helper function before the App component
const splitMessageIntoParts = (content: string): string[] => {
  return content.split('|||').map(part => part.trim()).filter(part => part.length > 0);
};

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Hello! How can I help you today m9? Feel free to send messages, or paste images (Ctrl+V).',
    },
  ]);
  const [clickedMessageIds, setClickedMessageIds] = useState<Set<string>>(new Set());
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

      // First, add a system message to guide responses
      const systemMessage = {
        role: "system",
        content: "You are a helpful AI GCSE maths assistant. Use simple language unless necessary. For example don't say 'Open a compass to a reasonable radius' but say 'Open your compass a bit'. Break your response into steps if necessary and between each step add ||| to separate the steps."
      };

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
            systemMessage,
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
            systemMessage,
            ...conversationHistory,
            { role: "user", content }
          ],
          max_tokens: 500,
          stream: true,
        });
      }

      let fullContent = '';
      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content || '';
        const definition = getTermDefinition(content);
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
    <div className="h-screen bg-[#212121] flex items-center justify-center">
      <div className="w-full h-full bg-[#212121] flex flex-col">
        <div 
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto px-96 py-4 space-y-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent hover:scrollbar-thumb-gray-500"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex flex-col ${
                message.type === 'user' ? 'items-end' : 'items-start'
              } space-y-2`}
            >
              {message.image && (
                <div className="mb-2 w-full flex justify-end">
                  <img
                    src={message.image}
                    alt="Uploaded content"
                    className="max-w-[70%] rounded-lg"
                  />
                </div>
              )}
              {message.type === 'user' ? (
                // User message - single bubble
                <div
                  className="max-w-[70%] bg-[#303030] text-[#ECECEC] ml-auto rounded-3xl px-5 py-3"
                >
                  <p className="text-[15px] leading-relaxed">
                    {message.content}
                  </p>
                </div>
              ) : (
                // Bot message - potentially multiple bubbles
                splitMessageIntoParts(message.content).map((part, index) => (
                  <div
                    key={`${message.id}-${index}`}
                    className={`max-w-[70%] bg-white text-black rounded-3xl px-5 py-3 shadow-sm transition-colors duration-200 
                      ${clickedMessageIds.has(`${message.id}-${index}`) 
                        ? 'bg-green-300' 
                        : 'hover:bg-green-100'
                      } cursor-pointer`}
                    onClick={() => {
                      setClickedMessageIds(prev => {
                        const newSet = new Set(prev);
                        const messageKey = `${message.id}-${index}`;
                        if (newSet.has(messageKey)) {
                          newSet.delete(messageKey);
                        } else {
                          newSet.add(messageKey);
                        }
                        return newSet;
                      });
                    }}
                  >
                    <p className="text-[15px] leading-relaxed">
                      {highlightDefinedTerms(part)}
                    </p>
                  </div>
                ))
              )}
              {message.streaming && message.type === 'bot' && (
                <div className="max-w-[70%] bg-white text-black rounded-3xl px-5 py-3 shadow-sm">
                  <p className="text-[15px] leading-relaxed">▊</p>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="px-96 pb-1 pt-4">
          <div className="bg-[#2C2C2C] rounded-3xl overflow-hidden">
            {tempImage && (
              <div className="relative p-4 pl-6">
                <div className="relative inline-block">
                  <img
                    src={tempImage}
                    alt="Preview"
                    className="h-16 w-16 object-cover rounded-lg"
                  />
                  <button
                    onClick={handleRemoveImage}
                    className="absolute -top-1.5 -right-1.5 bg-gray-700 text-gray-300 rounded-full p-0.5 hover:bg-gray-600 hover:text-white"
                    title="Remove image"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3"
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
              </div>
            )}
            <div className="flex items-center p-3">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask anything"
                className="w-full bg-transparent text-white focus:outline-none focus:ring-0 placeholder-[#9B9B9B] pl-4"
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
          <div className="text-center mt-1">
            <span className="text-[11px] text-[#9B9B9B]">ChatGPT can make mistakes. Check important info.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;