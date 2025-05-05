import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Send, Image as ImageIcon, Video, VideoOff } from 'lucide-react';
import OpenAI from 'openai';
import posthog from 'posthog-js';
import dictionary from '../dictionary.json';
import LLMOutputRenderer from '../LLMPrettyPrint';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';
import Latex from 'react-latex-next';

// Initialize PostHog
posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
  loaded: (posthog) => {
    if (import.meta.env.DEV) posthog.debug();
  },
  capture_pageview: true,
  capture_performance: true,
  disable_session_recording: false,
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

type Dictionary = {
  [key: string]: {
    definition: string;
  };
};

const getTermDefinition = (content: string): string | null => {
  const dict = dictionary as Dictionary;
  if (content in dict) {
    return dict[content].definition || null;
  }
  return null;
};

const prettyPrintResponse = (text: string): JSX.Element => {
  const parts: (string | JSX.Element)[] = [];
  const boldRegex = /\*\*(.+?)\*\*/g;
  let lastIdx = 0;
  let boldMatch;

  while ((boldMatch = boldRegex.exec(text)) !== null) {
    const [fullMatch, innerText] = boldMatch;
    const matchIdx = boldMatch.index;

    if (matchIdx > lastIdx) {
      parts.push(text.slice(lastIdx, matchIdx));
    }

    parts.push(<strong key={`bold-${matchIdx}`}>{innerText}</strong>);

    lastIdx = matchIdx + fullMatch.length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return <>{parts}</>;
};

const renderText = (content: string): JSX.Element => {
  // Look for patterns like "###title:", "###title\n", or "1.title:" and format them as markdown headings
  // Using a more robust pattern for splitting that ensures multi-digit numbers work
  const parts = content.split(/(?=###[^:\n]+(?:[:|\n])|(?:\b\d+\.)[^:]+:)/);
  // const parts = content.split(/(?=###[^:\n]+(?:[:|\n])|(?:\d+\.)[^:]+:)/);
  
  return (
    <>
      {parts.map((part, index) => {
        // Check if this part starts with the ### pattern
        if (part.startsWith('###')) {
          // Match both formats: ###heading: and ###heading\n
          const match = part.match(/^###([^:\n]+)(?::|\n)(.*)/s);
          if (match) {
            const [_, heading, remainingText] = match;
            // For heading sections, remove asterisks instead of converting to bold
            const cleanedHeading = heading.trim().replace(/\*\*(.*?)\*\*/g, '$1');
            const cleanedText = remainingText.trim().replace(/\*\*(.*?)\*\*/g, '$1');
            return (
              <div key={index}>
                <h3 className="font-bold text-lg mt-2 mb-1">
                  <Latex>{cleanedHeading}</Latex>
                </h3>
                <Latex>{cleanedText}</Latex>
              </div>
            );
          }
        }
        
        // Check if this part starts with a numbered title pattern (e.g., 1.title:, 10.title:, 100.title:)
        // Using a pattern that will match any number of digits followed by a period
        const numberedMatch = part.match(/^\s*(\d+\.)([^:]+):(.*)/s);
        if (numberedMatch) {
          const [_, number, heading, remainingText] = numberedMatch;
          // For numbered title sections, remove asterisks from both heading and content
          const cleanedHeading = heading.trim().replace(/\*\*(.*?)\*\*/g, '$1');
          const cleanedText = remainingText.trim().replace(/\*\*(.*?)\*\*/g, '$1');
          return (
            <div key={index}>
              <h4 className="font-bold text-base mt-1.5 mb-0.5">
                {number} <Latex>{cleanedHeading}</Latex>
              </h4>
              <Latex>{cleanedText}</Latex>
            </div>
          );
        }
        
        // Default case: render with Latex and process bold text
        return <Latex key={index}>{processBoldText(part)}</Latex>;
      })}
    </>
  );
};

// Helper function to process bold text (** **) in content
const processBoldText = (text: string): string => {
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
};

const ChatPage: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'bot',
      content: 'Hello! How can I help you today?',
    },
  ]);
  const [clickedMessageIds, setClickedMessageIds] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  const [tempImage, setTempImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsWebcamActive(true);
      }
    } catch (err) {
      console.error('Error accessing webcam:', err);
    }
  };

  const stopWebcam = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsWebcamActive(false);
    }
  };

  const captureImage = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const imageData = canvas.toDataURL('image/png');
        
        // Automatically download the image
        const link = document.createElement('a');
        link.href = imageData;
        link.download = `webcam-capture-${new Date().toISOString()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }
  };

  const processMessageWithOpenAI = async (content: string, imageUrl?: string) => {
    try {
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

      const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
        role: "system",
        content: `You are a helpful AI GCSE maths assistant. Behave like a real tutor. A real tutor doesn't give the entire solution at once, they ask the student small questions and guide them to the answer. Leave out redundant sentences like "Let's think step by step" or "I'm going to solve this question step by step".`
        // content: `You are a helpful AI GCSE maths assistant. Always wrap any LaTeX in double dollar signs. NEVER display LaTeX without putting it in double dollar signs. Make sure to wrap the LaTeX in double dollar signs.`
      };

      const conversationHistory = messages
        .filter(msg => !msg.streaming)
        .map(msg => {
          if (msg.type === 'user' && msg.image) {
            return {
              role: "user" as const,
              content: [
                { type: "text" as const, text: msg.content },
                {
                  type: "image_url" as const,
                  image_url: {
                    url: msg.image,
                  },
                },
              ],
            };
          }
          return {
            role: msg.type === 'user' ? "user" as const : "assistant" as const,
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
              role: "user" as const,
              content: [
                { type: "text" as const, text: content },
                {
                  type: "image_url" as const,
                  image_url: {
                    url: imageUrl,
                  },
                },
              ],
            },
          ],
          stream: true,
        });
      } else {
        response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            systemMessage,
            ...conversationHistory,
            { role: "user" as const, content }
          ],
          stream: true,
        });
      }

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
      console.log('Full content:');
      console.log(fullContent);
      setMessages(prev => prev.map(msg => 
        msg.id === messageId && msg.type === 'bot'
          ? { ...msg, streaming: false }
          : msg
      ));

    } catch (error) {
      console.log(error);
      posthog.capture('api_error', {
        error: error instanceof Error ? error.message : 'Unknown error'
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

  useEffect(() => {
    posthog.capture('app_opened');
  }, []);

  const containerRef = useRef(null);

  useEffect(() => {
    if (containerRef.current) {
      renderMathInElement(containerRef.current, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
      });
    }
  }, []);

  return (
    <div ref={containerRef} className="h-screen bg-[#212121] flex overflow-hidden fixed inset-0">
      {/* Main container with flex layout */}
      <div className="flex w-full h-full">
        {/* Chat area */}
        <div className={`${isWebcamActive ? 'w-1/2' : 'w-full'} h-full flex flex-col overflow-hidden transition-all duration-300`}>
          <div className="relative h-full">
            {/* Camera toggle button */}
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              <button
                onClick={isWebcamActive ? stopWebcam : startWebcam}
                className={`p-3 rounded-full transition-colors ${
                  isWebcamActive 
                    ? 'bg-red-600 hover:bg-red-700' 
                    : 'bg-gray-800 hover:bg-gray-700'
                }`}
              >
                {isWebcamActive ? (
                  <VideoOff className="w-6 h-6 text-white" />
                ) : (
                  <Video className="w-6 h-6 text-white" />
                )}
              </button>
              {isWebcamActive && (
                <button
                  onClick={captureImage}
                  className="p-3 rounded-full bg-blue-600 hover:bg-blue-700 transition-colors"
                  title="Take picture"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              )}
            </div>

            {/* Chat content */}
            <div className="h-full flex flex-col">
              <div 
                ref={chatContainerRef}
                className="flex-1 py-4 pl-4 pr-6 space-y-4 overflow-y-auto
                  scrollbar scrollbar-w-2 scrollbar-track-transparent scrollbar-thumb-[#4a4a4a] hover:scrollbar-thumb-[#5a5a5a]
                  [&::-webkit-scrollbar]:w-[6px]
                  [&::-webkit-scrollbar-track]:bg-transparent
                  [&::-webkit-scrollbar-thumb]:bg-[#4a4a4a]
                  [&::-webkit-scrollbar-thumb]:rounded-full
                  [&::-webkit-scrollbar-thumb]:hover:bg-[#5a5a5a]
                  [&::-webkit-scrollbar]:hover:w-[6px]"
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
                      <div className="max-w-[70%] bg-[#303030] text-[#ECECEC] ml-auto rounded-3xl px-5 py-3">
                        <p className="text-[15px] leading-relaxed">
                          {renderText(message.content)}
                        </p>
                      </div>
                    ) : (
                      <div className={`max-w-[70%] bg-black text-white rounded-3xl px-5 py-3 shadow-sm`}>
                        {renderText(message.content)}
                        {message.streaming && '▊'}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="pb-1 pt-4 flex-shrink-0 bg-[#212121]">
                <div className="bg-[#2C2C2C] rounded-3xl overflow-hidden mx-4">
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
        </div>

        {/* Camera view - conditionally shown */}
        <div className={`${isWebcamActive ? 'w-1/2' : 'w-0'} h-full flex flex-col bg-black transition-all duration-300 overflow-hidden`}>
          <div className="flex-1 relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPage; 