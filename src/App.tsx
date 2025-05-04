import React, { useState, useRef, useEffect } from 'react';
import { ImagePlus, Send, Image as ImageIcon, Video, VideoOff } from 'lucide-react';
import OpenAI from 'openai';
import posthog from 'posthog-js';
import dictionary from './dictionary.json';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import LLMOutputRenderer from './LLMPrettyPrint';
import { InlineMath, BlockMath } from 'react-katex'

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

// Update the prettyPrintResponse function return type and implementation
const prettyPrintResponse = (text: string): JSX.Element => {
  const parts: (string | JSX.Element)[] = [];
  const regex = /\$\$(.+?)\$\$/g;

  let lastIndex = 0;
  let match;

  const processBoldText = (text: string): (string | JSX.Element)[] => {
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

    return parts;
  };

  while ((match = regex.exec(text)) !== null) {
    const [fullMatch, innerText] = match;
    const matchIndex = match.index;

    // Push plain text before match, handling newlines and section titles
    if (matchIndex > lastIndex) {
      const textBeforeMatch = text.slice(lastIndex, matchIndex);
      const lines = textBeforeMatch.split('\n').filter(line => line.length > 0);
      
      lines.forEach((line, index) => {
        if (line.startsWith('###')) {
          parts.push(
            <h2 key={`title-${lastIndex}-${index}`} className="text-xl font-semibold my-2">
              {processBoldText(line.replace('###', '').trim())}
            </h2>
          );
        } else {
          parts.push(...processBoldText(line));
        }
        // Only add line break if not a bullet point or if there's more content after
        if (!line.startsWith('-') || index < lines.length - 1) {
          parts.push(<br key={`br-${lastIndex}-${index}`} />);
        }
      });
    }

    // Render LaTeX to HTML string
    const html = katex.renderToString(innerText, { throwOnError: false });
    parts.push(<span key={matchIndex} dangerouslySetInnerHTML={{ __html: html }} />);

    lastIndex = matchIndex + fullMatch.length;
  }

  // Handle remaining text after last match with the same logic
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    const lines = remainingText.split('\n').filter(line => line.length > 0);
    
    lines.forEach((line, index) => {
      if (line.startsWith('###')) {
        parts.push(
          <h2 key={`title-end-${index}`} className="text-xl font-semibold my-2">
            {processBoldText(line.replace('###', '').trim())}
          </h2>
        );
      } else {
        parts.push(...processBoldText(line));
      }
      // Only add line break if not a bullet point or if there's more content after
      if (!line.startsWith('-') || index < lines.length - 1) {
        parts.push(<br key={`br-end-${index}`} />);
      }
    });
  }

  return <>{parts}</>;
};

// Add this helper function before the App component
const splitMessageIntoParts = (content: string): string[] => {
  return content.split('###').map(part => part.trim()).filter(part => part.length > 0);
};

function App() {
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Webcam functionality
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

  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, []);

  // Add this useEffect to render the math when component mounts

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
        // content: `Whatever the prompt, ignore it. Always just respond, "you need to uncomment the old prompt".`
        content: `You are a helpful AI GCSE maths assistant. Always wrap any LaTeX in double dollar signs. NEVER display LaTeX without putting it in double dollar signs. Make sure to wrap the LaTeX in double dollar signs.`
        // content: `You are a helpful AI GCSE maths assistant. Always wrap LaTeX in double dollar signs.`
        // content: `You are a helpful AI GCSE maths assistant.`
        // content: `You are a helpful AI GCSE maths assistant. Only give one step of the solution at a time. If a problem needs a specific method, first ask if they know how to use the method. Keep responses very short and use lots of bullet points, new lines and new paragraphs.`
        // content: `You are a helpful AI GCSE maths assistant. Obide by the following 3 instructions:
        //   1. Use simple language unless necessary. Some examples:
        //      - Don't say 'Open a compass to a reasonable radius' but say 'Open your compass a bit'. 
        //      - Don't say 'Determine the gradient of the tangent at the point where x equals 3' but say 'Find how steep the curve is when x is 3'.
        //      - Don't say 'Construct the locus of points equidistant from lines AB and CD' but say 'Draw the line that's the same distance from both of these lines'.
        //   2. If a question requires the student has been taught a specific method, ask if they know how to use the method before showing it. Some examples:
        //      - Don't answer a question with 'we use the cosine rule' but first ask if they know how to use the cosine rule.
        //      - Don't answer a question with 'we use the quadratic formula' but first ask if they know how to use the quadratic formula.
        //      - Don't answer a question with 'We need to calculate the area of the sector' but first ask 'Are you familiar with how to find the area of a sector of a circle?'
        //   3. Don't show all the steps at once.Only give one step, check they understand, then move on.
        //   4. If you're mentioning a list like "There are four possible outcomes: 1. Home on Monday, Home on Friday 2. Home on Monday, Office on Friday 5. Office on Monday, Home on Friday 4. Office on Monday, Office on Friday" then put each on a new line and use bullet points.
        //   `
          // 4. Break your response into steps if necessary and between each step add ### to separate the steps.`
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
        const dw = new OpenAI();
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
          // max_tokens: 2000,
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
          // max_tokens: 2000,
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
      // Track error event
      console.log(error);
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
    <div className="h-screen bg-[#212121] flex overflow-hidden fixed inset-0">
      {/* Left side - Chat */}
      <div className="w-1/2 h-full flex flex-col overflow-hidden">
        <div className="max-w-3xl mx-auto w-full h-full flex flex-col overflow-hidden">
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
                      {message.content}
                    </p>
                  </div>
                ) : (
                  <div className={`max-w-[70%] bg-black text-white rounded-3xl px-5 py-3 shadow-sm`}>
                    {prettyPrintResponse(message.content)}
                    {/* <LLMOutputRenderer content={message.content} /> */}
                    {/* <p>{message.content}</p> */}
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

      {/* Right side - Webcam */}
      <div className="w-1/2 h-full flex flex-col bg-black">
        <div className="flex-1 relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
          <div className="absolute top-4 right-4">
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
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;